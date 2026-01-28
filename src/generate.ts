/**
 * PRD Generator for Loop
 * Uses Claude Agent SDK to generate structured PRD files from natural language descriptions
 */

import {
  query,
  type SDKResultMessage,
  type Options,
} from '@anthropic-ai/claude-agent-sdk'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'fs'
import { join } from 'path'
import type { PrdJson, RalphConfig } from './types.ts'
import { savePrd } from './prd.ts'
import { findClaudeCodePath } from './utils.ts'

/**
 * System prompt for PRD generation
 * Based on Matt Pocock's Ralph Wiggum article recommendations
 */
const PRD_GENERATION_PROMPT = `You are a PRD (Product Requirements Document) generator for an autonomous AI coding agent.

Your job is to take a natural language description of what needs to be built and create a structured PRD that the agent can work through.

## PRD Format

Generate a Markdown PRD with this structure:

# Project Name

Brief description of the project

## High Priority

# Feature: Clear Feature Name

## Requirements
- Specific requirement 1
- Specific requirement 2

## Acceptance Criteria
- [ ] Testable criterion that defines "done"
- [ ] Another verifiable criterion
- [ ] Tests pass

# Feature: Another Feature

## Requirements
- What this feature needs

## Acceptance Criteria
- [ ] How we know it's complete

## Medium Priority

# Feature: Standard Feature

## Requirements
- Implementation details

## Acceptance Criteria
- [ ] Verification steps

## Low Priority

# Feature: Polish Task

## Requirements
- What needs polishing

## Acceptance Criteria
- [ ] Definition of done

## Guidelines

1. **Prioritize by type:**
   - HIGH: Architecture, core abstractions, integration points
   - MEDIUM: Standard features, implementation
   - LOW: Polish, documentation, cleanup

2. **Requirements vs Acceptance Criteria:**
   - Requirements: What needs to be built (implementation details)
   - Acceptance Criteria: How we verify it's done (testable checkboxes)
   - Good criterion: "User can log in with email and password"
   - Bad criterion: "Auth works"

3. **Keep features atomic:**
   - Each feature should be completable in one iteration
   - If a feature is too large, break it into multiple features
   - One logical change per feature

4. **Format rules:**
   - Use \`# Feature: Name\` for each feature (single # with Feature: prefix)
   - Use \`## Requirements\` section with plain bullet points
   - Use \`## Acceptance Criteria\` section with checkbox bullets \`- [ ]\`
   - DO NOT include completion markers or promise tags

## Output

Return ONLY the Markdown content. No code blocks, no explanations, just the PRD in Markdown format.`

/**
 * System prompt for AGENTS.md generation
 */
const AGENTS_GENERATION_PROMPT = `Generate an AGENTS.md file for AI coding agents.

## Required Sections

# AGENTS.md

## Project overview
[One sentence: what this project does]

## Setup commands
- Install: \`[command]\`
- Build: \`[command]\`
- Run: \`[command]\`

## Back pressure (required checks before commit)
- Build: \`[command]\`
- Typecheck: \`[command]\`
- Lint: \`[command]\`
- Test: \`[command]\`

## Testing instructions
- [How to run tests]
- All tests must pass before merge

## Code style
- [Key conventions for this language/framework]

## What NOT to do
- Don't skip tests
- Don't commit with failing checks
- [Project-specific anti-patterns]

## Rules

1. Output ONLY Markdown - no code block wrappers
2. Include ALL sections above
3. Use actual commands for the detected project type
4. Back pressure section is critical - always include real commands
5. NEVER hardcode specific paths, project names, or scheme names in commands`

/**
 * Generate content using Claude Agent SDK
 */
async function generateWithAgent(
  prompt: string,
  systemPrompt: string,
  config: RalphConfig,
  options: {
    useTools?: boolean
    verbose?: boolean
  } = {},
): Promise<string> {
  const claudeCodePath = findClaudeCodePath()
  if (!claudeCodePath) {
    throw new Error(
      'Claude Code CLI not found. Install it with: curl -fsSL https://claude.ai/install.sh | bash',
    )
  }

  const queryOptions: Options = {
    cwd: config.workingDir,
    model: config.model,
    maxTurns: options.useTools ? 20 : 1,
    pathToClaudeCodeExecutable: claudeCodePath,
    // Use tools for codebase analysis if requested
    tools: options.useTools ? ['Read', 'Glob', 'Grep'] : [],
    systemPrompt: systemPrompt,
    // Auto-allow read-only tools
    allowedTools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'default',
  }

  let result = ''

  for await (const message of query({ prompt, options: queryOptions })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          result += block.text
        }
      }
    }

    if (message.type === 'result') {
      const resultMsg = message as SDKResultMessage
      if (resultMsg.subtype === 'success' && 'result' in resultMsg) {
        // Use the final result if available
        if (resultMsg.result) {
          result = resultMsg.result
        }
      } else if ('errors' in resultMsg && resultMsg.errors.length > 0) {
        throw new Error(resultMsg.errors.join(', '))
      }
    }
  }

  return result.trim()
}

/**
 * Generate a PRD from a natural language description
 */
export async function generatePrd(
  description: string,
  config: RalphConfig,
  options: {
    analyzeCodebase?: boolean
    existingFiles?: string[]
  } = {},
): Promise<PrdJson> {
  // Build the prompt
  let prompt = `Generate a PRD for the following project:\n\n## Project Description\n${description}\n\n`

  if (options.analyzeCodebase) {
    prompt += `Please use the Glob and Read tools to analyze the codebase structure and understand the existing code before generating the PRD.\n\n`
  }

  if (options.existingFiles && options.existingFiles.length > 0) {
    prompt += `## Existing Files\n${options.existingFiles.slice(0, 50).join('\n')}\n\n`
  }

  prompt += `Now generate the PRD in Markdown format.`

  const markdown = await generateWithAgent(
    prompt,
    PRD_GENERATION_PROMPT,
    config,
    { useTools: options.analyzeCodebase },
  )

  // Clean up markdown
  let cleanMarkdown = markdown
  const mdMatch = markdown.match(/```(?:markdown|md)?\s*([\s\S]*?)```/)
  if (mdMatch) {
    cleanMarkdown = mdMatch[1].trim()
  }

  // Write to temp file and parse it
  const tempPath = join(config.workingDir, '.prd.tmp.md')
  writeFileSync(tempPath, cleanMarkdown, 'utf-8')

  // Import loadPrd to parse the markdown
  const { loadPrd } = await import('./prd.ts')
  const prd = loadPrd(tempPath)

  // Clean up temp file
  try {
    unlinkSync(tempPath)
  } catch {
    // Ignore cleanup errors
  }

  if (!prd) {
    throw new Error('Failed to parse generated PRD Markdown')
  }

  return prd
}

/**
 * Normalize PRD to ensure all fields exist
 */
function normalizePrd(prd: Partial<PrdJson>): PrdJson {
  return {
    name: prd.name || 'PRD',
    description: prd.description,
    items: (prd.items || []).map((item, index) => {
      const passes = item.passes || false
      const status = item.status || (passes ? 'done' : 'pending')
      return {
        id: item.id || String(index + 1),
        category: item.category || 'functional',
        description: item.description || '',
        requirements: item.requirements || [],
        acceptanceCriteria: item.acceptanceCriteria || [],
        steps: item.steps || [],
        priority: item.priority || 'medium',
        passes,
        status,
      }
    }),
  }
}

/**
 * Analyze codebase to get context for PRD generation
 */
export function analyzeCodebase(workingDir: string): string[] {
  const files: string[] = []
  const ignoreDirs = ['node_modules', '.git', 'dist', '.build', 'coverage']
  const ignoreFiles = ['.DS_Store', 'bun.lockb', 'package-lock.json']

  function walkDir(dir: string, prefix: string = '') {
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (ignoreDirs.includes(entry) || ignoreFiles.includes(entry)) continue
        if (entry.startsWith('.') && entry !== '.env.example') continue

        const fullPath = join(dir, entry)
        const relativePath = prefix ? `${prefix}/${entry}` : entry

        try {
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            files.push(`${relativePath}/`)
            walkDir(fullPath, relativePath)
          } else {
            files.push(relativePath)
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walkDir(workingDir)
  return files
}

/**
 * Read README or other documentation for context
 */
export function readProjectDocs(workingDir: string): string | null {
  const docFiles = [
    'README.md',
    'readme.md',
    'README',
    'SPEC.md',
    'REQUIREMENTS.md',
  ]

  for (const file of docFiles) {
    const path = join(workingDir, file)
    if (existsSync(path)) {
      try {
        return readFileSync(path, 'utf-8')
      } catch {
        continue
      }
    }
  }

  return null
}

/**
 * Interactive PRD refinement
 */
export async function refinePrd(
  prd: PrdJson,
  feedback: string,
  config: RalphConfig,
): Promise<PrdJson> {
  const prompt = `Here is an existing PRD:\n\n${JSON.stringify(
    prd,
    null,
    2,
  )}\n\nPlease refine it based on this feedback:\n${feedback}\n\nReturn the updated PRD as JSON.`

  const result = await generateWithAgent(prompt, PRD_GENERATION_PROMPT, config)

  try {
    return normalizePrd(JSON.parse(result))
  } catch {
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return normalizePrd(JSON.parse(jsonMatch[1].trim()))
    }
    throw new Error('Failed to parse refined PRD')
  }
}

/**
 * Generate and save PRD to file
 */
export async function generateAndSavePrd(
  description: string,
  config: RalphConfig,
  outputPath: string,
  options: {
    analyzeCodebase?: boolean
    verbose?: boolean
  } = {},
): Promise<PrdJson> {
  if (options.verbose) {
    console.log('🔍 Analyzing project...')
  }

  const existingFiles = options.analyzeCodebase
    ? analyzeCodebase(config.workingDir)
    : undefined

  if (options.verbose && existingFiles) {
    console.log(`   Found ${existingFiles.length} files`)
  }

  if (options.verbose) {
    console.log('🤖 Generating PRD...')
  }

  const prd = await generatePrd(description, config, {
    analyzeCodebase: options.analyzeCodebase,
    existingFiles,
  })

  if (options.verbose) {
    console.log(`   Generated ${prd.items.length} tasks`)
  }

  savePrd(outputPath, prd)

  if (options.verbose) {
    console.log(`✅ PRD saved to ${outputPath}`)
  }

  return prd
}

/**
 * Detect project type from files
 */
function detectProjectType(files: string[]): string {
  if (
    files.some(
      (f) => f.endsWith('Package.swift') || f.includes('Package.swift'),
    )
  ) {
    return 'Swift (Package.swift detected)'
  }
  if (files.some((f) => f.endsWith('Cargo.toml') || f.includes('Cargo.toml'))) {
    return 'Rust (Cargo.toml detected)'
  }
  if (
    files.some((f) => f.endsWith('package.json') || f.includes('package.json'))
  ) {
    const hasTsConfig = files.some(
      (f) => f.endsWith('tsconfig.json') || f.includes('tsconfig.json'),
    )
    return hasTsConfig
      ? 'TypeScript/Node.js (package.json + tsconfig.json detected)'
      : 'JavaScript/Node.js (package.json detected)'
  }
  if (files.some((f) => f.endsWith('go.mod') || f.includes('go.mod'))) {
    return 'Go (go.mod detected)'
  }
  if (
    files.some(
      (f) =>
        f.endsWith('pyproject.toml') ||
        f.includes('pyproject.toml') ||
        f.endsWith('requirements.txt') ||
        f.includes('requirements.txt'),
    )
  ) {
    return 'Python (pyproject.toml or requirements.txt detected)'
  }
  if (
    files.some(
      (f) =>
        f.endsWith('CMakeLists.txt') ||
        f.includes('CMakeLists.txt') ||
        f.endsWith('Makefile') ||
        f.includes('Makefile'),
    )
  ) {
    return 'C/C++ (CMakeLists.txt or Makefile detected)'
  }

  // Check by file extensions
  if (files.some((f) => f.endsWith('.swift'))) return 'Swift'
  if (files.some((f) => f.endsWith('.rs'))) return 'Rust'
  if (files.some((f) => f.endsWith('.ts') || f.endsWith('.tsx')))
    return 'TypeScript'
  if (files.some((f) => f.endsWith('.js') || f.endsWith('.jsx')))
    return 'JavaScript'
  if (files.some((f) => f.endsWith('.go'))) return 'Go'
  if (files.some((f) => f.endsWith('.py'))) return 'Python'
  if (files.some((f) => f.endsWith('.c') || f.endsWith('.cpp'))) return 'C/C++'

  return 'Unknown'
}

/**
 * Generate AGENTS.md from project description
 */
export async function generateAgentsMd(
  description: string,
  config: RalphConfig,
  options: {
    existingFiles?: string[]
    projectDocs?: string
    analyzeCodebase?: boolean
  } = {},
): Promise<string> {
  // Detect project type
  const projectType = options.existingFiles
    ? detectProjectType(options.existingFiles)
    : 'Unknown'

  // Build a more structured user message
  let prompt = `Generate a complete AGENTS.md file for this project.

IMPORTANT: Your output MUST include ALL required sections (Project overview, Setup commands, Back pressure, Testing instructions, Code style, What NOT to do). Do NOT just output a file tree.

## Project Information

**Description:** ${
    description || 'Analyze this project and generate appropriate AGENTS.md'
  }

**Detected Project Type:** ${projectType}
`

  if (options.analyzeCodebase) {
    prompt += `\nPlease use the Glob and Read tools to analyze the codebase and understand the build/test setup before generating AGENTS.md.\n`
  }

  if (options.existingFiles && options.existingFiles.length > 0) {
    const keyFiles = options.existingFiles
      .filter(
        (f) =>
          f.endsWith('Package.swift') ||
          f.endsWith('package.json') ||
          f.endsWith('Cargo.toml') ||
          f.endsWith('go.mod') ||
          f.endsWith('pyproject.toml') ||
          f.endsWith('CMakeLists.txt') ||
          f.endsWith('Makefile') ||
          f.endsWith('README.md'),
      )
      .slice(0, 20)

    prompt += `\n**Key files:** ${keyFiles.join(', ')}\n`
  }

  if (options.projectDocs) {
    const docPreview = options.projectDocs.slice(0, 500)
    prompt += `\n**README excerpt:**\n${docPreview}${options.projectDocs.length > 500 ? '...' : ''}\n`
  }

  prompt += `\nNow generate the complete AGENTS.md file with all required sections.`

  let markdown = await generateWithAgent(
    prompt,
    AGENTS_GENERATION_PROMPT,
    config,
    { useTools: options.analyzeCodebase },
  )

  // Remove markdown code block wrapper if present
  const mdMatch = markdown.match(/```(?:markdown|md)?\s*([\s\S]*?)```/)
  if (mdMatch) {
    markdown = mdMatch[1].trim()
  }

  return markdown
}

/**
 * Generate and save AGENTS.md to file
 */
export async function generateAndSaveAgentsMd(
  description: string,
  config: RalphConfig,
  outputPath: string,
  options: {
    analyzeCodebase?: boolean
    verbose?: boolean
  } = {},
): Promise<string> {
  if (options.verbose) {
    console.log('🔍 Analyzing project for AGENTS.md...')
  }

  const existingFiles = options.analyzeCodebase
    ? analyzeCodebase(config.workingDir)
    : undefined

  const projectDocs = readProjectDocs(config.workingDir) || undefined

  if (options.verbose && existingFiles) {
    console.log(`   Found ${existingFiles.length} files`)
  }

  if (options.verbose) {
    console.log('🤖 Generating AGENTS.md...')
  }

  const agentsMd = await generateAgentsMd(description, config, {
    existingFiles,
    projectDocs,
    analyzeCodebase: options.analyzeCodebase,
  })

  writeFileSync(outputPath, agentsMd, 'utf-8')

  if (options.verbose) {
    console.log(`✅ AGENTS.md saved to ${outputPath}`)
  }

  return agentsMd
}

/**
 * Generate both PRD and AGENTS.md together
 */
export async function generateProjectFiles(
  description: string,
  config: RalphConfig,
  options: {
    prdPath?: string
    agentsPath?: string
    analyzeCodebase?: boolean
    verbose?: boolean
  } = {},
): Promise<{ prd: PrdJson; agentsMd: string }> {
  const prdPath = options.prdPath || 'prd.md'
  const agentsPath = options.agentsPath || 'AGENTS.md'

  // Analyze codebase once for both
  const existingFiles = options.analyzeCodebase
    ? analyzeCodebase(config.workingDir)
    : undefined

  const projectDocs = readProjectDocs(config.workingDir) || undefined

  if (options.verbose) {
    console.log('🔍 Analyzing project...')
    if (existingFiles) {
      console.log(`   Found ${existingFiles.length} files`)
    }
  }

  // Generate PRD
  if (options.verbose) {
    console.log('🤖 Generating PRD...')
  }

  const prd = await generatePrd(description, config, {
    analyzeCodebase: options.analyzeCodebase,
    existingFiles,
  })

  savePrd(prdPath, prd)

  if (options.verbose) {
    console.log(`   Generated ${prd.items.length} tasks`)
    console.log(`✅ PRD saved to ${prdPath}`)
  }

  // Generate AGENTS.md
  if (options.verbose) {
    console.log('🤖 Generating AGENTS.md...')
  }

  const agentsMd = await generateAgentsMd(description, config, {
    existingFiles,
    projectDocs,
    analyzeCodebase: options.analyzeCodebase,
  })

  writeFileSync(agentsPath, agentsMd, 'utf-8')

  if (options.verbose) {
    console.log(`✅ AGENTS.md saved to ${agentsPath}`)
  }

  return { prd, agentsMd }
}
