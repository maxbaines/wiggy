/**
 * PRD Generator for Loop
 * Uses Claude to generate structured PRD files from natural language descriptions
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import type { PrdJson, RalphConfig } from './types.ts'
import { savePrd } from './prd.ts'

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

## Tasks

### High Priority

- [ ] **Clear, actionable task description**
  - Specific acceptance criteria 1
  - Specific acceptance criteria 2

### Medium Priority

- [ ] **Another task description**
  - Acceptance criteria

### Low Priority

- [ ] **Lower priority task**
  - Acceptance criteria

## Guidelines (from Matt Pocock's Ralph Wiggum methodology)

1. **Prioritize by type:**
   - HIGH: Architecture, core abstractions, integration points
   - MEDIUM: Standard features, implementation
   - LOW: Polish, documentation, cleanup

2. **Be specific about scope:**
   - Define exactly what "done" looks like
   - Include acceptance criteria (steps) for each task
   - Don't leave room for shortcuts

3. **Keep tasks atomic:**
   - Each task should be completable in one iteration
   - If a task is too large, break it into subtasks
   - One logical change per task

4. **Categories:**
   - setup: Project initialization, dependencies, configuration
   - architecture: Core abstractions, patterns, structure
   - functional: Features, business logic
   - testing: Tests, coverage
   - documentation: README, comments, docs
   - polish: Cleanup, refactoring, optimization

5. **Acceptance criteria (steps):**
   - Be specific and verifiable
   - Include edge cases
   - Think about what could go wrong

## Output

Return ONLY the Markdown content. No code blocks, no explanations, just the PRD in Markdown format.`

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
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: 5 * 60 * 1000, // 5 minutes
  })

  // Build context
  let context = `## Project Description\n${description}\n\n`

  if (options.analyzeCodebase && options.existingFiles) {
    context += `## Existing Files\n${options.existingFiles.join('\n')}\n\n`
  }

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: PRD_GENERATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate a PRD for the following project:\n\n${context}`,
      },
    ],
  })

  // Extract Markdown from response
  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  let markdown = textContent.text.trim()

  // Remove markdown code block wrapper if present
  const mdMatch = markdown.match(/```(?:markdown|md)?\s*([\s\S]*?)```/)
  if (mdMatch) {
    markdown = mdMatch[1].trim()
  }

  // Write to temp file and parse it
  const tempPath = join(config.workingDir, '.prd.tmp.md')
  writeFileSync(tempPath, markdown, 'utf-8')

  // Import loadPrd to parse the markdown
  const { loadPrd } = await import('./prd.ts')
  const prd = loadPrd(tempPath)

  // Clean up temp file
  const { unlinkSync } = await import('fs')
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
    items: (prd.items || []).map((item, index) => ({
      id: item.id || String(index + 1),
      category: item.category || 'functional',
      description: item.description || '',
      steps: item.steps || [],
      priority: item.priority || 'medium',
      passes: item.passes || false,
    })),
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
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: 5 * 60 * 1000,
  })

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: PRD_GENERATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here is an existing PRD:\n\n${JSON.stringify(
          prd,
          null,
          2,
        )}\n\nPlease refine it based on this feedback:\n${feedback}\n\nReturn the updated PRD as JSON.`,
      },
    ],
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  const jsonText = textContent.text.trim()

  try {
    return normalizePrd(JSON.parse(jsonText))
  } catch {
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
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
 * System prompt for AGENTS.md generation
 * Follows the open AGENTS.md standard (https://agents.md)
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
5. NEVER hardcode specific paths, project names, or scheme names in commands
   - Use generic commands that work from the project root
   - For Xcode: use \`xcodebuild\` without -project flag (auto-discovers .xcodeproj)
   - For Swift Package Manager: use \`swift build\` and \`swift test\`
   - Commands should work regardless of subfolder structure`

/**
 * Detect project type from files
 */
function detectProjectType(files: string[]): string {
  const fileSet = new Set(files.map((f) => f.toLowerCase()))

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
  } = {},
): Promise<string> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: 5 * 60 * 1000,
  })

  // Detect project type
  const projectType = options.existingFiles
    ? detectProjectType(options.existingFiles)
    : 'Unknown'

  // Build a more structured user message
  let userMessage = `Generate a complete AGENTS.md file for this project.

IMPORTANT: Your output MUST include ALL required sections (Project overview, Setup commands, Back pressure, Testing instructions, Code style, What NOT to do). Do NOT just output a file tree.

## Project Information

**Description:** ${
    description || 'Analyze this project and generate appropriate AGENTS.md'
  }

**Detected Project Type:** ${projectType}
`

  if (options.existingFiles && options.existingFiles.length > 0) {
    // Summarize files instead of listing all
    const fileCount = options.existingFiles.length
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
          f.endsWith('README.md') ||
          f.endsWith('.swift') ||
          f.endsWith('.ts') ||
          f.endsWith('.rs') ||
          f.endsWith('.go') ||
          f.endsWith('.py'),
      )
      .slice(0, 20) // Limit to 20 key files

    userMessage += `
**Project has ${fileCount} files. Key files include:**
${keyFiles.join('\n')}
`
  }

  if (options.projectDocs) {
    // Include first 500 chars of README
    const docPreview = options.projectDocs.slice(0, 500)
    userMessage += `
**README excerpt:**
${docPreview}${options.projectDocs.length > 500 ? '...' : ''}
`
  }

  userMessage += `
Now generate the complete AGENTS.md file with all required sections.`

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: AGENTS_GENERATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  let markdown = textContent.text.trim()

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
  })

  writeFileSync(agentsPath, agentsMd, 'utf-8')

  if (options.verbose) {
    console.log(`✅ AGENTS.md saved to ${agentsPath}`)
  }

  return { prd, agentsMd }
}
