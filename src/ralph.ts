/**
 * Ralph - Main loop logic
 * Orchestrates the autonomous coding loop
 */

import { existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import type { RalphConfig, RalphArgs, LoopState } from './types.ts'
import { loadConfig, validateConfig, findPrdFile } from './config.ts'
import {
  loadPrd,
  getPrdSummary,
  isPrdComplete,
  getIncompleteItems,
  markItemCompleteByDescription,
  savePrd,
} from './prd.ts'
import {
  initProgressFile,
  getProgressSummaryByMode,
  appendProgress,
  createProgressEntry,
  getLastIteration,
} from './progress.ts'
import {
  createSystemPrompt,
  createTaskImplementationPrompt,
  selectNextTask,
  runIteration,
} from './agent.ts'
import {
  log,
  formatBox,
  formatIterationHeader,
  formatSuccess,
  formatError,
  formatWarning,
  formatInfo,
} from './output.ts'
import { getKeyboardListener, type InterventionResult } from './keyboard.ts'

/**
 * Print the Ralph banner
 */
function printBanner(): void {
  console.log(
    formatBox('🤖 Ralph Wiggum', 'Autonomous AI Coding Loop', 'neonCyan'),
  )
}

/**
 * Load AGENTS.md if it exists
 */
function loadAgentsMd(workingDir: string): string | undefined {
  const agentsPath = join(workingDir, 'AGENTS.md')
  if (existsSync(agentsPath)) {
    return readFileSync(agentsPath, 'utf-8')
  }
  return undefined
}

/**
 * Check for uncommitted changes in the working directory
 */
function checkForUncommittedChanges(workingDir: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return output.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Auto-commit any uncommitted changes with a fallback message
 */
function autoCommitChanges(workingDir: string, message: string): boolean {
  try {
    execSync('git add -A', {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Send notification (macOS)
 */
function sendNotification(title: string, message: string): void {
  try {
    const { execSync } = require('child_process')
    execSync(
      `osascript -e 'display notification "${message}" with title "${title}"'`,
      { stdio: 'ignore' },
    )
  } catch {
    // Ignore notification errors
  }
}

/**
 * Run the Ralph loop
 */
export async function runRalph(args: RalphArgs): Promise<void> {
  printBanner()

  // Load configuration
  const config = loadConfig(args.configFile)
  const errors = validateConfig(config)

  if (errors.length > 0) {
    console.log(formatError('Configuration errors:'))
    for (const error of errors) {
      console.log(formatError(`  - ${error}`))
    }
    process.exit(1)
  }

  // Find PRD file
  const prdPath = config.prdFile || findPrdFile(config.workingDir)
  const prd = prdPath ? loadPrd(prdPath) : null

  if (!prd) {
    console.log(
      formatWarning('No PRD file found. Ralph will work without a task list.'),
    )
  }

  // Initialize progress file (only needed for file mode)
  const progressPath = join(config.workingDir, config.progressFile)
  if (config.progressMode === 'file') {
    initProgressFile(progressPath)
  }

  // Print configuration
  console.log(formatInfo(`Iterations: ${args.iterations}`))
  console.log(formatInfo(`HITL Mode: ${args.hitl}`))
  console.log(formatInfo(`PRD File: ${prdPath || 'None'}`))
  console.log(formatInfo(`Progress Mode: ${config.progressMode}`))
  console.log(formatInfo(`Working Dir: ${config.workingDir}`))
  console.log()

  // Initialize keyboard listener for manual intervention
  const keyboard = getKeyboardListener()
  keyboard.start()
  console.log(formatInfo('Press Ctrl+\\ anytime to add feedback to the agent'))
  console.log()

  // Set up intervention handler
  let pendingIntervention: InterventionResult | null = null
  keyboard.on('intervention', async () => {
    const message = await keyboard.promptForInput()
    if (message) {
      pendingIntervention = { message, timestamp: new Date() }
    }
  })

  // Initialize loop state
  // For git mode, always start at 0 since we don't track iteration numbers
  const state: LoopState = {
    iteration:
      config.progressMode === 'file' ? getLastIteration(progressPath) : 0,
    maxIterations: args.iterations,
    prd,
    progress: [],
    isComplete: false,
  }

  // Main loop
  for (let i = 1; i <= args.iterations; i++) {
    state.iteration++

    console.log()
    console.log(formatIterationHeader(i, args.iterations))
    console.log()

    // HITL mode: pause before each iteration (except first)
    if (args.hitl && i > 1) {
      console.log(
        formatWarning(
          'HITL Mode: Press Enter to continue or Ctrl+C to stop...',
        ),
      )
      await waitForEnter()
    }

    // Check if PRD is already complete
    if (state.prd && isPrdComplete(state.prd)) {
      console.log(formatSuccess('PRD is already complete!'))
      state.isComplete = true
      break
    }

    // Get progress summary and AGENTS.md
    const progressSummary = getProgressSummaryByMode(
      config.progressMode,
      config.workingDir,
      progressPath,
    )
    const agentsMd = loadAgentsMd(config.workingDir)

    // Include any pending intervention in the progress summary
    let enhancedProgressSummary = progressSummary
    if (pendingIntervention) {
      enhancedProgressSummary += `\n\n### 🧑 Human Feedback (${pendingIntervention.timestamp.toLocaleTimeString()}):\n${pendingIntervention.message}\n\nPlease acknowledge and incorporate this feedback.`
      console.log(
        formatWarning(
          `Including human feedback: "${pendingIntervention.message.substring(0, 50)}${pendingIntervention.message.length > 50 ? '...' : ''}"`,
        ),
      )
      pendingIntervention = null // Clear after including
    }

    // TWO-PHASE EXECUTION
    let systemPrompt: string
    let selectedTaskDescription: string | undefined

    if (state.prd) {
      // PHASE 1: Task Selection
      // Agent sees full PRD to select the best task
      console.log(formatInfo('Phase 1: Selecting next task...'))
      const prdSummary = getPrdSummary(state.prd)

      const taskSelection = await selectNextTask(
        config,
        prdSummary,
        enhancedProgressSummary,
        agentsMd,
        config.verbose,
      )

      if (taskSelection) {
        console.log(
          formatSuccess(
            `Selected task #${taskSelection.taskId}: ${taskSelection.taskDescription}`,
          ),
        )
        if (taskSelection.reasoning) {
          console.log(formatInfo(`  Reasoning: ${taskSelection.reasoning}`))
        }

        // Find the task in PRD
        const incompleteItems = getIncompleteItems(state.prd)
        const selectedTask = incompleteItems.find(
          (item) =>
            item.id === taskSelection.taskId ||
            item.description
              .toLowerCase()
              .includes(taskSelection.taskDescription.toLowerCase()) ||
            taskSelection.taskDescription
              .toLowerCase()
              .includes(item.description.toLowerCase()),
        )

        if (selectedTask) {
          // PHASE 2: Task Implementation
          // Agent only sees the selected task
          console.log(formatInfo('Phase 2: Implementing task...'))
          systemPrompt = createTaskImplementationPrompt(
            selectedTask,
            enhancedProgressSummary,
            agentsMd,
          )
          selectedTaskDescription = selectedTask.description
        } else {
          // Fallback: couldn't find task, use legacy full PRD mode
          console.log(
            formatWarning(
              'Could not find selected task in PRD, using full PRD mode',
            ),
          )
          systemPrompt = createSystemPrompt(
            prdSummary,
            enhancedProgressSummary,
            agentsMd,
          )
        }
      } else {
        // Fallback: task selection failed, use legacy full PRD mode
        console.log(formatWarning('Task selection failed, using full PRD mode'))
        const prdSummary = getPrdSummary(state.prd)
        systemPrompt = createSystemPrompt(
          prdSummary,
          enhancedProgressSummary,
          agentsMd,
        )
      }
    } else {
      // No PRD - use legacy mode
      systemPrompt = createSystemPrompt(
        'No PRD file. Work on improving the codebase.',
        enhancedProgressSummary,
        agentsMd,
      )
    }

    // Run the iteration with intervention callback
    console.log(formatInfo('Running iteration...'))
    const result = await runIteration(
      config,
      systemPrompt,
      config.verbose,
      async () => pendingIntervention,
    )

    // Use selected task description if available
    if (selectedTaskDescription && !result.taskDescription) {
      result.taskDescription = selectedTaskDescription
    }

    // Check if iteration was interrupted by user
    if (result.wasInterrupted) {
      console.log(
        formatWarning(
          'Iteration was interrupted - restarting with your feedback',
        ),
      )
      // Store the intervention for next iteration
      if (result.intervention) {
        pendingIntervention = result.intervention
      }
      // Don't count this as a completed iteration - decrement counter
      i--
      state.iteration--
      continue
    }

    // Check if intervention was received during iteration (without interrupt)
    if (result.intervention) {
      console.log(
        formatInfo(
          `Human feedback received - will be included in next iteration`,
        ),
      )
      pendingIntervention = result.intervention
    }

    if (result.success) {
      console.log(formatSuccess(result.taskDescription || 'Task completed'))

      // Verify git commit was made - check for uncommitted changes
      const hasUncommittedChanges = checkForUncommittedChanges(
        config.workingDir,
      )
      if (hasUncommittedChanges) {
        console.log(
          formatWarning(
            '⚠️  Uncommitted changes detected! Agent may have forgotten to commit.',
          ),
        )
        // Auto-commit with a fallback message to ensure progress is tracked
        const fallbackCommitMessage = `chore: Auto-commit for iteration ${state.iteration}

WHAT: Changes from Ralph iteration ${state.iteration}
- Task: ${result.taskDescription || 'Task completed'}
${result.filesChanged?.length ? `- Files: ${result.filesChanged.join(', ')}` : ''}

WHY: Agent did not commit - auto-committed to preserve progress tracking

NEXT: Review this commit and ensure proper commit messages in future iterations`

        const commitSuccess = autoCommitChanges(
          config.workingDir,
          fallbackCommitMessage,
        )
        if (commitSuccess) {
          console.log(
            formatInfo('  → Auto-committed changes to preserve progress'),
          )
        } else {
          console.log(
            formatWarning(
              '  → Failed to auto-commit - changes may be lost for progress tracking',
            ),
          )
        }
      }

      // Record progress (only in file mode)
      if (config.progressMode === 'file') {
        const entry = createProgressEntry(
          state.iteration,
          result.taskDescription || 'Task completed',
          {
            decisions: result.decisions,
            filesChanged: result.filesChanged,
            notes: result.summary,
          },
        )
        appendProgress(progressPath, entry)
      }

      // Mark task as complete in PRD if we have one
      if (state.prd && prdPath && result.taskDescription) {
        const updatedPrd = markItemCompleteByDescription(
          state.prd,
          result.taskDescription,
        )
        if (updatedPrd) {
          savePrd(prdPath, updatedPrd)
          // Update our in-memory copy
          state.prd = updatedPrd
          console.log(formatSuccess('  → Marked task as [DONE] in PRD'))
        }
      }

      // Check for completion
      if (result.isComplete) {
        state.isComplete = true
        break
      }
    } else {
      console.log(formatError(`Error: ${result.error}`))
      state.lastError = result.error

      // In HITL mode, continue despite errors
      if (!args.hitl) {
        console.log(
          formatWarning(
            'Stopping due to error. Use --hitl mode to continue despite errors.',
          ),
        )
        break
      }
    }
  }

  // Stop keyboard listener
  keyboard.stop()

  // Final status
  console.log()
  if (state.isComplete) {
    console.log(
      formatBox(
        '✅ PRD COMPLETE',
        `All tasks finished after ${state.iteration} iterations`,
        'neonGreen',
      ),
    )
    sendNotification(
      'Ralph Wiggum',
      `PRD complete after ${state.iteration} iterations`,
    )
  } else {
    console.log(
      formatBox(
        '⚠️  Max iterations reached',
        'PRD may not be complete',
        'neonYellow',
      ),
    )
    sendNotification(
      'Ralph Wiggum',
      `Max iterations (${args.iterations}) reached`,
    )
  }
}

/**
 * Wait for Enter key press
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolve()
    })
  })
}
