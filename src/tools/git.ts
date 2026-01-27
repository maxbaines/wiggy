/**
 * Git tools for Ralph
 * Provides git operations using child_process directly
 * Core functions used by complete-task.ts
 */

import type { GitResult, CommandResult } from '../types.ts'
import { executeCommand } from '../utils.ts'

/**
 * Get git status
 */
export async function getStatus(workingDir: string): Promise<CommandResult> {
  return executeCommand('git status --porcelain', workingDir)
}

/**
 * Stage all changes
 */
export async function stageAll(workingDir: string): Promise<CommandResult> {
  return executeCommand('git add -A', workingDir)
}

/**
 * Create a commit
 */
export async function commit(
  message: string,
  workingDir: string,
): Promise<GitResult> {
  // Escape quotes in message
  const escapedMessage = message.replace(/"/g, '\\"')
  const result = await executeCommand(
    `git commit -m "${escapedMessage}"`,
    workingDir,
  )

  if (result.success) {
    // Get the commit hash
    const hashResult = await executeCommand(
      'git rev-parse --short HEAD',
      workingDir,
    )
    return {
      success: true,
      commitHash: hashResult.stdout?.trim(),
      output: `Committed: ${hashResult.stdout?.trim()}`,
    }
  }

  return {
    success: false,
    error: result.error || result.stderr || 'Failed to commit',
  }
}

/**
 * Stage all and commit
 */
export async function stageAndCommit(
  message: string,
  workingDir: string,
): Promise<GitResult> {
  const stageResult = await stageAll(workingDir)
  if (!stageResult.success) {
    return {
      success: false,
      error: `Failed to stage files: ${stageResult.error}`,
    }
  }

  // Check if there are changes to commit
  const statusResult = await getStatus(workingDir)
  if (!statusResult.stdout?.trim()) {
    return {
      success: true,
      output: 'No changes to commit',
    }
  }

  return commit(message, workingDir)
}
