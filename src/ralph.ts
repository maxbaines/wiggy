/**
 * Ralph - Main loop logic
 * Orchestrates the autonomous coding loop
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { RalphConfig, RalphArgs, LoopState } from './types.ts'
import { loadConfig, validateConfig, findPrdFile } from './config.ts'
import {
  loadPrd,
  getPrdSummary,
  isPrdComplete,
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
import { createSystemPrompt, runIteration } from './agent.ts'
import {
  log,
  formatBox,
  formatIterationHeader,
  formatSuccess,
  formatError,
  formatWarning,
  formatInfo,
} from './output.ts'

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
    if (prd && isPrdComplete(prd)) {
      console.log(formatSuccess('PRD is already complete!'))
      state.isComplete = true
      break
    }

    // Build the system prompt
    const prdSummary = prd
      ? getPrdSummary(prd)
      : 'No PRD file. Work on improving the codebase.'
    const progressSummary = getProgressSummaryByMode(
      config.progressMode,
      config.workingDir,
      progressPath,
    )
    const agentsMd = loadAgentsMd(config.workingDir)
    const systemPrompt = createSystemPrompt(
      prdSummary,
      progressSummary,
      agentsMd,
    )

    // Run the iteration
    console.log(formatInfo('Running iteration...'))
    const result = await runIteration(config, systemPrompt, config.verbose)

    if (result.success) {
      console.log(formatSuccess(result.taskDescription || 'Task completed'))

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
      if (prd && prdPath && result.taskDescription) {
        const updatedPrd = markItemCompleteByDescription(
          prd,
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
