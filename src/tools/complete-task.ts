/**
 * CompleteTask Tool for Ralph
 * Provides atomic task completion: git commit + progress update + PRD marking
 */

import { stageAll, commit, getStatus } from './git.ts'
import {
  loadPrd,
  savePrd,
  markWorkingItemComplete,
  markItemCompleteByDescription,
} from '../prd.ts'
import {
  appendProgress,
  createProgressEntry,
  getLastIteration,
} from '../progress.ts'

/**
 * Input for the CompleteTask tool
 */
export interface CompleteTaskInput {
  /** Description of the completed task (should match PRD item) */
  taskDescription: string
  /** Git commit message (multi-line recommended) */
  commitMessage: string
  /** List of files that were changed */
  filesChanged?: string[]
  /** Key decisions made during implementation */
  decisions?: string[]
  /** Brief summary of what was done */
  summary?: string
}

/**
 * Result from the CompleteTask tool
 */
export interface CompleteTaskResult {
  success: boolean
  /** Git commit hash if successful */
  commitHash?: string
  /** Whether progress.txt was updated */
  progressUpdated: boolean
  /** Whether PRD was updated */
  prdUpdated: boolean
  /** Error messages if any */
  errors: string[]
  /** Human-readable summary */
  message: string
}

/**
 * Configuration for the CompleteTask tool
 */
export interface CompleteTaskConfig {
  workingDir: string
  prdPath?: string
  progressPath?: string
  progressMode: 'git' | 'file'
  /** Current iteration number */
  iteration: number
}

/**
 * Execute the CompleteTask tool
 * Atomically: commits changes, updates progress, marks PRD task as done
 */
export async function executeCompleteTask(
  input: CompleteTaskInput,
  config: CompleteTaskConfig,
): Promise<CompleteTaskResult> {
  const errors: string[] = []
  let commitHash: string | undefined
  let progressUpdated = false
  let prdUpdated = false

  // Step 1: Check for changes to commit
  const statusResult = await getStatus(config.workingDir)
  const hasChanges = statusResult.success && statusResult.stdout?.trim()

  if (!hasChanges) {
    // No changes to commit - this might be okay if agent already committed
    errors.push('No uncommitted changes found - task may already be committed')
  }

  // Step 2: Git commit (if there are changes)
  if (hasChanges) {
    // Stage all changes
    const stageResult = await stageAll(config.workingDir)
    if (!stageResult.success) {
      errors.push(`Failed to stage changes: ${stageResult.error}`)
    } else {
      // Commit with the provided message
      const commitResult = await commit(input.commitMessage, config.workingDir)
      if (commitResult.success) {
        commitHash = commitResult.commitHash
      } else {
        errors.push(`Failed to commit: ${commitResult.error}`)
      }
    }
  }

  // Step 3: Update progress.txt (if file mode)
  if (config.progressMode === 'file' && config.progressPath) {
    try {
      const iteration =
        config.iteration || getLastIteration(config.progressPath) + 1
      const entry = createProgressEntry(iteration, input.taskDescription, {
        decisions: input.decisions,
        filesChanged: input.filesChanged,
        notes: input.summary,
      })
      appendProgress(config.progressPath, entry)
      progressUpdated = true
    } catch (error) {
      errors.push(
        `Failed to update progress: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Step 4: Mark task as complete in PRD
  // First try to find [WORKING] item (most reliable), then fall back to description match
  if (config.prdPath) {
    try {
      const prd = loadPrd(config.prdPath)
      if (prd) {
        // Try to mark the [WORKING] item as complete first (most reliable)
        let updatedPrd = markWorkingItemComplete(prd)

        // If no [WORKING] item found, fall back to description matching
        if (!updatedPrd) {
          updatedPrd = markItemCompleteByDescription(prd, input.taskDescription)
        }

        if (updatedPrd) {
          savePrd(config.prdPath, updatedPrd)
          prdUpdated = true
        } else {
          errors.push(
            `Could not find [WORKING] or matching PRD item for: "${input.taskDescription}"`,
          )
        }
      } else {
        errors.push('Could not load PRD file')
      }
    } catch (error) {
      errors.push(
        `Failed to update PRD: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Build result
  const success = commitHash !== undefined || !hasChanges
  const parts: string[] = []

  if (commitHash) {
    parts.push(`✅ Committed: ${commitHash}`)
  } else if (!hasChanges) {
    parts.push('ℹ️ No changes to commit')
  } else {
    parts.push('❌ Commit failed')
  }

  if (progressUpdated) {
    parts.push('✅ Progress updated')
  } else if (config.progressMode === 'file') {
    parts.push('❌ Progress not updated')
  }

  if (prdUpdated) {
    parts.push('✅ PRD task marked [DONE]')
  } else if (config.prdPath) {
    parts.push('⚠️ PRD not updated')
  }

  return {
    success,
    commitHash,
    progressUpdated,
    prdUpdated,
    errors,
    message: parts.join(' | '),
  }
}

/**
 * Format the CompleteTask tool for the agent's system prompt
 */
export function getCompleteTaskToolDescription(): string {
  return `### CompleteTask Tool

When you have finished implementing a task, call the CompleteTask tool to:
1. Git commit your changes with a detailed message
2. Update progress tracking
3. Mark the PRD task as [DONE]

**Usage:** Call this tool when your implementation is complete and all back pressure checks pass.

**Input format:**
\`\`\`json
{
  "taskDescription": "The exact task description from the PRD",
  "commitMessage": "feat: Brief summary\\n\\nWHAT: Detailed changes\\nWHY: Reasoning\\nNEXT: Follow-up (optional)",
  "filesChanged": ["file1.ts", "file2.ts"],
  "decisions": ["Decision 1: why this approach", "Decision 2: tradeoffs"],
  "summary": "Brief 1-2 sentence summary"
}
\`\`\`

**Important:**
- The taskDescription should match the PRD item closely
- Write detailed, multi-line commit messages
- List all files you changed
- Document key decisions for future reference
`
}
