/**
 * Back Pressure module for Ralph
 * Parses AGENTS.md to extract and run back pressure commands
 * Follows the open AGENTS.md standard (https://agents.md)
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { CommandResult } from './types.ts'
import { executeCommand } from './utils.ts'

/**
 * A single back pressure check
 */
export interface BackPressureCheck {
  name: string // "Build", "Typecheck", "Lint", "Test", etc.
  command: string // The actual command to run
  required: boolean // Whether this check must pass before commit
}

/**
 * Results from running back pressure checks
 */
export interface BackPressureResults {
  checks: {
    name: string
    command: string
    passed: boolean
    output: string
    duration: number
  }[]
  allPassed: boolean
  summary: string
}

/**
 * Parse back pressure commands from AGENTS.md content
 * Looks for the "Back pressure" section and extracts commands
 */
export function parseBackPressureConfig(
  agentsMdContent: string,
): BackPressureCheck[] {
  const checks: BackPressureCheck[] = []

  // Find the "Back pressure" section (case insensitive)
  const backPressureMatch = agentsMdContent.match(
    /##\s*Back\s*pressure[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
  )

  if (!backPressureMatch) {
    // Fallback: try to find commands in "Setup commands" section
    const setupMatch = agentsMdContent.match(
      /##\s*Setup\s*commands[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
    )

    if (setupMatch) {
      return parseCommandsFromSection(setupMatch[1], false)
    }

    return []
  }

  return parseCommandsFromSection(backPressureMatch[1], true)
}

/**
 * Parse commands from a section of markdown
 * Supports formats like:
 * - Build: `swift build`
 * - `swift build` (build)
 * - Build: swift build
 */
function parseCommandsFromSection(
  section: string,
  defaultRequired: boolean,
): BackPressureCheck[] {
  const checks: BackPressureCheck[] = []
  const lines = section.split('\n')

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('<!--') || !line.trim()) continue

    // Pattern 1: "- Name: `command`" or "- Name: command"
    const namedMatch = line.match(
      /^[-*]\s*(\w+(?:\s+\w+)?)\s*:\s*`?([^`\n]+)`?/i,
    )
    if (namedMatch) {
      const name = namedMatch[1].trim()
      const command = namedMatch[2].trim()

      // Check if marked as optional
      const isOptional =
        line.toLowerCase().includes('(optional)') ||
        line.toLowerCase().includes('optional:')

      checks.push({
        name,
        command,
        required: defaultRequired && !isOptional,
      })
      continue
    }

    // Pattern 2: "- `command`" (infer name from command)
    const commandOnlyMatch = line.match(/^[-*]\s*`([^`]+)`/)
    if (commandOnlyMatch) {
      const command = commandOnlyMatch[1].trim()
      const name = inferCheckName(command)

      checks.push({
        name,
        command,
        required: defaultRequired,
      })
    }
  }

  return checks
}

/**
 * Infer check name from command
 */
function inferCheckName(command: string): string {
  const cmd = command.toLowerCase()

  if (cmd.includes('test')) return 'Test'
  if (cmd.includes('lint') || cmd.includes('eslint') || cmd.includes('clippy'))
    return 'Lint'
  if (
    cmd.includes('typecheck') ||
    cmd.includes('tsc') ||
    cmd.includes('mypy') ||
    cmd.includes('check')
  )
    return 'Typecheck'
  if (cmd.includes('build') || cmd.includes('compile')) return 'Build'
  if (cmd.includes('format') || cmd.includes('fmt')) return 'Format'

  // Default to first word of command
  return command.split(' ')[0]
}

/**
 * Load and parse AGENTS.md from a directory
 */
export function loadBackPressureConfig(
  workingDir: string,
): BackPressureCheck[] {
  const agentsPath = join(workingDir, 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    return getDefaultChecks()
  }

  try {
    const content = readFileSync(agentsPath, 'utf-8')
    const checks = parseBackPressureConfig(content)

    // If no checks found, return defaults
    if (checks.length === 0) {
      return getDefaultChecks()
    }

    return checks
  } catch {
    return getDefaultChecks()
  }
}

/**
 * Get default back pressure checks (fallback when no AGENTS.md)
 * These use auto-detection similar to the original implementation
 */
function getDefaultChecks(): BackPressureCheck[] {
  return [
    { name: 'Typecheck', command: 'AUTO_DETECT', required: true },
    { name: 'Lint', command: 'AUTO_DETECT', required: true },
    { name: 'Test', command: 'AUTO_DETECT', required: true },
  ]
}

/**
 * Run all back pressure checks
 */
export async function runBackPressureChecks(
  workingDir: string,
  checks?: BackPressureCheck[],
): Promise<BackPressureResults> {
  const checksToRun = checks || loadBackPressureConfig(workingDir)
  const results: BackPressureResults['checks'] = []
  let allPassed = true

  for (const check of checksToRun) {
    const startTime = Date.now()

    let result: CommandResult

    if (check.command === 'AUTO_DETECT') {
      // Use auto-detection for default checks
      result = await runAutoDetectedCheck(check.name, workingDir)
    } else {
      result = await executeCommand(check.command, workingDir, 300000) // 5 min timeout
    }

    const duration = Date.now() - startTime
    const passed = result.success

    if (check.required && !passed) {
      allPassed = false
    }

    results.push({
      name: check.name,
      command: check.command,
      passed,
      output: result.success
        ? result.stdout || result.output || 'Passed'
        : result.stderr || result.error || 'Failed',
      duration,
    })
  }

  // Generate summary
  const summary = generateSummary(results, allPassed)

  return {
    checks: results,
    allPassed,
    summary,
  }
}

/**
 * Run auto-detected check (fallback behavior)
 */
async function runAutoDetectedCheck(
  checkName: string,
  workingDir: string,
): Promise<CommandResult> {
  switch (checkName.toLowerCase()) {
    case 'typecheck': {
      // Try different type check commands
      const commands = [
        'bun run typecheck',
        'pnpm typecheck',
        'npm run typecheck',
        'npx tsc --noEmit',
      ]
      for (const cmd of commands) {
        const result = await executeCommand(cmd, workingDir, 120000)
        if (result.success || result.exitCode !== 127) {
          return result
        }
      }
      return { success: true, output: 'No type checking configured' }
    }

    case 'test':
    case 'tests': {
      const commands = ['bun test', 'pnpm test', 'npm test']
      for (const cmd of commands) {
        const result = await executeCommand(cmd, workingDir, 300000)
        if (result.success || result.exitCode !== 127) {
          return result
        }
      }
      return { success: true, output: 'No tests configured' }
    }

    case 'lint': {
      const commands = [
        'bun run lint',
        'pnpm lint',
        'npm run lint',
        'npx eslint .',
      ]
      for (const cmd of commands) {
        const result = await executeCommand(cmd, workingDir, 120000)
        if (result.success || result.exitCode !== 127) {
          return result
        }
      }
      return { success: true, output: 'No linting configured' }
    }

    default:
      return {
        success: true,
        output: `No auto-detection for ${checkName}`,
      }
  }
}

/**
 * Generate a human-readable summary of check results
 */
function generateSummary(
  results: BackPressureResults['checks'],
  allPassed: boolean,
): string {
  const lines: string[] = []

  if (allPassed) {
    lines.push('✅ All back pressure checks passed!')
  } else {
    lines.push('❌ Some back pressure checks failed:')
  }

  lines.push('')

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    const duration = `(${(result.duration / 1000).toFixed(1)}s)`
    lines.push(
      `${icon} ${result.name}: ${
        result.passed ? 'passed' : 'FAILED'
      } ${duration}`,
    )

    // Include error output for failed checks
    if (!result.passed && result.output) {
      const errorLines = result.output.split('\n').slice(0, 5) // First 5 lines
      for (const line of errorLines) {
        lines.push(`   ${line}`)
      }
      if (result.output.split('\n').length > 5) {
        lines.push('   ...')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Format back pressure results for inclusion in progress file
 */
export function formatResultsForProgress(results: BackPressureResults): string {
  const lines: string[] = ['### Back Pressure Results']

  for (const result of results.checks) {
    const icon = result.passed ? '✅' : '❌'
    lines.push(
      `- ${icon} ${result.name}: ${result.passed ? 'passed' : 'FAILED'}`,
    )
  }

  if (!results.allPassed) {
    lines.push('')
    lines.push('⚠️ **Fix failing checks before continuing!**')
  }

  return lines.join('\n')
}
