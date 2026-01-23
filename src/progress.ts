/**
 * Progress tracking for Ralph
 * Supports two modes:
 * - 'git': Uses last 10 git commit messages (default)
 * - 'file': Uses progress.txt file (legacy)
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { execSync } from 'child_process'
import type { ProgressEntry, BackPressureCheckResult } from './types.ts'

/**
 * Initialize progress file if it doesn't exist
 */
export function initProgressFile(filePath: string): void {
  if (!existsSync(filePath)) {
    const header = `# Ralph Progress Log
# Created: ${new Date().toISOString()}
# This file tracks progress between Ralph iterations.
# Delete this file when your sprint is complete.

`
    writeFileSync(filePath, header, 'utf-8')
  }
}

/**
 * Load progress entries from file
 */
export function loadProgress(filePath: string): ProgressEntry[] {
  if (!existsSync(filePath)) {
    return []
  }

  const content = readFileSync(filePath, 'utf-8')
  const entries: ProgressEntry[] = []

  // Parse the progress file
  // Format: ## Iteration N - timestamp
  const iterationBlocks = content.split(/^## Iteration \d+/m).slice(1)

  for (const block of iterationBlocks) {
    const lines = block.trim().split('\n')
    const headerMatch = lines[0]?.match(/- (.+)/)
    const timestamp = headerMatch?.[1] || new Date().toISOString()

    const entry: ProgressEntry = {
      timestamp,
      iteration: entries.length + 1,
      taskDescription: '',
      decisions: [],
      filesChanged: [],
    }

    let currentSection = ''

    for (const line of lines.slice(1)) {
      if (line.startsWith('### Task:')) {
        entry.taskDescription = line.replace('### Task:', '').trim()
      } else if (line.startsWith('### Decisions')) {
        currentSection = 'decisions'
      } else if (line.startsWith('### Files Changed')) {
        currentSection = 'files'
      } else if (line.startsWith('### Notes')) {
        currentSection = 'notes'
      } else if (line.startsWith('- ') && currentSection === 'decisions') {
        entry.decisions.push(line.replace('- ', ''))
      } else if (line.startsWith('- ') && currentSection === 'files') {
        entry.filesChanged.push(line.replace('- ', ''))
      } else if (currentSection === 'notes' && line.trim()) {
        entry.notes = (entry.notes || '') + line + '\n'
      }
    }

    if (entry.taskDescription) {
      entries.push(entry)
    }
  }

  return entries
}

/**
 * Append a progress entry to the file
 */
export function appendProgress(filePath: string, entry: ProgressEntry): void {
  initProgressFile(filePath)

  // Format back pressure results if present
  let backPressureSection = ''
  if (entry.backPressureResults && entry.backPressureResults.length > 0) {
    backPressureSection = `\n### Back Pressure Results\n`
    for (const result of entry.backPressureResults) {
      const icon = result.passed ? '✅' : '❌'
      backPressureSection += `- ${icon} ${result.name}: ${
        result.passed ? 'passed' : 'FAILED'
      }\n`
      if (!result.passed && result.output) {
        // Include first few lines of error output
        const errorLines = result.output.split('\n').slice(0, 3)
        for (const line of errorLines) {
          backPressureSection += `  ${line}\n`
        }
      }
    }
  }

  const content = `
## Iteration ${entry.iteration} - ${entry.timestamp}

### Task: ${entry.taskDescription}
${entry.taskId ? `Task ID: ${entry.taskId}` : ''}

### Decisions
${entry.decisions.map((d) => `- ${d}`).join('\n') || '- None'}

### Files Changed
${entry.filesChanged.map((f) => `- ${f}`).join('\n') || '- None'}
${backPressureSection}
### Notes
${entry.notes || 'None'}

---
`

  appendFileSync(filePath, content, 'utf-8')
}

/**
 * Get progress summary for prompt
 * Includes back pressure results from the last iteration to ensure
 * the agent is aware of any failures that need to be fixed
 */
export function getProgressSummary(
  filePath: string,
  lastBackPressureResults?: BackPressureCheckResult[],
): string {
  const entries = loadProgress(filePath)

  let summary = ''

  // If there are back pressure results from the last iteration, show them prominently
  if (lastBackPressureResults && lastBackPressureResults.length > 0) {
    const hasFailures = lastBackPressureResults.some((r) => !r.passed)

    if (hasFailures) {
      summary += '⚠️ **LAST BACK PRESSURE STATUS - FIX BEFORE CONTINUING:**\n\n'
    } else {
      summary += '✅ **Last Back Pressure Status:**\n\n'
    }

    for (const result of lastBackPressureResults) {
      const icon = result.passed ? '✅' : '❌'
      summary += `${icon} ${result.name}: ${
        result.passed ? 'passed' : 'FAILED'
      }\n`
      if (!result.passed && result.output) {
        const errorLines = result.output.split('\n').slice(0, 3)
        for (const line of errorLines) {
          summary += `   ${line}\n`
        }
      }
    }

    if (hasFailures) {
      summary += '\n→ **Fix the failing checks before starting new work!**\n'
    }

    summary += '\n---\n\n'
  }

  if (entries.length === 0) {
    return summary + 'No previous progress recorded.'
  }

  summary += `Previous Progress (${entries.length} iterations):\n\n`

  // Show last 5 entries
  const recentEntries = entries.slice(-5)

  for (const entry of recentEntries) {
    summary += `Iteration ${entry.iteration}: ${entry.taskDescription}\n`
    if (entry.decisions.length > 0) {
      summary += `  Decisions: ${entry.decisions.join(', ')}\n`
    }
    if (entry.filesChanged.length > 0) {
      summary += `  Files: ${entry.filesChanged.join(', ')}\n`
    }
    summary += '\n'
  }

  return summary
}

/**
 * Create a progress entry from iteration results
 */
export function createProgressEntry(
  iteration: number,
  taskDescription: string,
  options: {
    taskId?: string
    decisions?: string[]
    filesChanged?: string[]
    notes?: string
  } = {},
): ProgressEntry {
  return {
    timestamp: new Date().toISOString(),
    iteration,
    taskId: options.taskId,
    taskDescription,
    decisions: options.decisions || [],
    filesChanged: options.filesChanged || [],
    notes: options.notes,
  }
}

/**
 * Clear progress file (for new sprint)
 */
export function clearProgress(filePath: string): void {
  if (existsSync(filePath)) {
    const header = `# Ralph Progress Log
# Created: ${new Date().toISOString()}
# This file tracks progress between Ralph iterations.
# Delete this file when your sprint is complete.

`
    writeFileSync(filePath, header, 'utf-8')
  }
}

/**
 * Get the last iteration number
 */
export function getLastIteration(filePath: string): number {
  const entries = loadProgress(filePath)
  if (entries.length === 0) {
    return 0
  }
  return Math.max(...entries.map((e) => e.iteration))
}

/**
 * Get progress from git commit history
 * Returns the last N commit messages as progress context
 */
export function getProgressFromGit(
  workingDir: string,
  count: number = 10,
): string {
  try {
    const output = execSync(`git log --oneline -n ${count}`, {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const commits = output.trim()
    if (!commits) {
      return 'No git commits found.'
    }

    return `Recent Commits (last ${count}):\n\n${commits
      .split('\n')
      .map((line) => `- ${line}`)
      .join('\n')}`
  } catch {
    return 'No git history available (not a git repository or no commits).'
  }
}

/**
 * Get progress summary based on mode
 * - 'git': Returns last 10 git commit messages
 * - 'file': Returns progress from progress.txt file
 */
export function getProgressSummaryByMode(
  mode: 'git' | 'file',
  workingDir: string,
  filePath: string,
  lastBackPressureResults?: BackPressureCheckResult[],
): string {
  let summary = ''

  // If there are back pressure results from the last iteration, show them prominently
  if (lastBackPressureResults && lastBackPressureResults.length > 0) {
    const hasFailures = lastBackPressureResults.some((r) => !r.passed)

    if (hasFailures) {
      summary += '⚠️ **LAST BACK PRESSURE STATUS - FIX BEFORE CONTINUING:**\n\n'
    } else {
      summary += '✅ **Last Back Pressure Status:**\n\n'
    }

    for (const result of lastBackPressureResults) {
      const icon = result.passed ? '✅' : '❌'
      summary += `${icon} ${result.name}: ${
        result.passed ? 'passed' : 'FAILED'
      }\n`
      if (!result.passed && result.output) {
        const errorLines = result.output.split('\n').slice(0, 3)
        for (const line of errorLines) {
          summary += `   ${line}\n`
        }
      }
    }

    if (hasFailures) {
      summary += '\n→ **Fix the failing checks before starting new work!**\n'
    }

    summary += '\n---\n\n'
  }

  if (mode === 'git') {
    summary += getProgressFromGit(workingDir)
  } else {
    // File mode - use existing logic
    const entries = loadProgress(filePath)

    if (entries.length === 0) {
      summary += 'No previous progress recorded.'
    } else {
      summary += `Previous Progress (${entries.length} iterations):\n\n`

      // Show last 5 entries
      const recentEntries = entries.slice(-5)

      for (const entry of recentEntries) {
        summary += `Iteration ${entry.iteration}: ${entry.taskDescription}\n`
        if (entry.decisions.length > 0) {
          summary += `  Decisions: ${entry.decisions.join(', ')}\n`
        }
        if (entry.filesChanged.length > 0) {
          summary += `  Files: ${entry.filesChanged.join(', ')}\n`
        }
        summary += '\n'
      }
    }
  }

  return summary
}
