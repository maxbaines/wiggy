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
  getProgressSummary,
  appendProgress,
  createProgressEntry,
  getLastIteration,
} from './progress.ts'
import { createSystemPrompt, runIteration } from './agent.ts'

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
}

/**
 * Print colored output
 */
function log(message: string, color?: keyof typeof colors): void {
  if (color) {
    console.log(`${colors[color]}${message}${colors.reset}`)
  } else {
    console.log(message)
  }
}

/**
 * Print the Ralph banner
 */
function printBanner(): void {
  log('╔════════════════════════════════════════════════════════════╗', 'blue')
  log('║                    🤖 Ralph Wiggum                         ║', 'blue')
  log('║              Autonomous AI Coding Loop                     ║', 'blue')
  log('╚════════════════════════════════════════════════════════════╝', 'blue')
  console.log()
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
      { stdio: 'ignore' }
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
    log('Configuration errors:', 'red')
    for (const error of errors) {
      log(`  - ${error}`, 'red')
    }
    process.exit(1)
  }

  // Find PRD file
  const prdPath = config.prdFile || findPrdFile(config.workingDir)
  const prd = prdPath ? loadPrd(prdPath) : null

  if (!prd) {
    log(
      'Warning: No PRD file found. Ralph will work without a task list.',
      'yellow'
    )
  }

  // Initialize progress file
  const progressPath = join(config.workingDir, config.progressFile)
  initProgressFile(progressPath)

  // Print configuration
  log(`Iterations: ${args.iterations}`, 'green')
  log(`HITL Mode: ${args.hitl}`, 'green')
  log(`PRD File: ${prdPath || 'None'}`, 'green')
  log(`Progress File: ${config.progressFile}`, 'green')
  log(`Working Dir: ${config.workingDir}`, 'green')
  console.log()

  // Initialize loop state
  const state: LoopState = {
    iteration: getLastIteration(progressPath),
    maxIterations: args.iterations,
    prd,
    progress: [],
    isComplete: false,
  }

  // Main loop
  for (let i = 1; i <= args.iterations; i++) {
    state.iteration++

    console.log()
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue')
    log(`  Iteration ${i} of ${args.iterations}`, 'blue')
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue')
    console.log()

    // HITL mode: pause before each iteration (except first)
    if (args.hitl && i > 1) {
      log('HITL Mode: Press Enter to continue or Ctrl+C to stop...', 'yellow')
      await waitForEnter()
    }

    // Check if PRD is already complete
    if (prd && isPrdComplete(prd)) {
      log('PRD is already complete!', 'green')
      state.isComplete = true
      break
    }

    // Build the system prompt
    const prdSummary = prd
      ? getPrdSummary(prd)
      : 'No PRD file. Work on improving the codebase.'
    const progressSummary = getProgressSummary(progressPath)
    const agentsMd = loadAgentsMd(config.workingDir)
    const systemPrompt = createSystemPrompt(
      prdSummary,
      progressSummary,
      agentsMd
    )

    // Run the iteration
    log('Running iteration...', 'blue')
    const result = await runIteration(config, systemPrompt, config.verbose)

    if (result.success) {
      log(`✓ ${result.taskDescription}`, 'green')

      // Record progress
      const entry = createProgressEntry(
        state.iteration,
        result.taskDescription || 'Task completed',
        {
          filesChanged: result.filesChanged,
        }
      )
      appendProgress(progressPath, entry)

      // Mark task as complete in PRD if we have one
      if (prd && prdPath && result.taskDescription) {
        const updatedPrd = markItemCompleteByDescription(
          prd,
          result.taskDescription
        )
        if (updatedPrd) {
          savePrd(prdPath, updatedPrd)
          // Update our in-memory copy
          state.prd = updatedPrd
          log(`  → Marked task as [DONE] in PRD`, 'green')
        }
      }

      // Check for completion
      if (result.isComplete) {
        state.isComplete = true
        break
      }
    } else {
      log(`✗ Error: ${result.error}`, 'red')
      state.lastError = result.error

      // In HITL mode, continue despite errors
      if (!args.hitl) {
        log(
          'Stopping due to error. Use --hitl mode to continue despite errors.',
          'yellow'
        )
        break
      }
    }
  }

  // Final status
  console.log()
  if (state.isComplete) {
    log(
      '╔════════════════════════════════════════════════════════════╗',
      'green'
    )
    log(
      '║                    ✅ PRD COMPLETE                         ║',
      'green'
    )
    log(
      `║              All tasks finished after ${state.iteration} iterations         ║`,
      'green'
    )
    log(
      '╚════════════════════════════════════════════════════════════╝',
      'green'
    )
    sendNotification(
      'Ralph Wiggum',
      `PRD complete after ${state.iteration} iterations`
    )
  } else {
    log(
      '╔════════════════════════════════════════════════════════════╗',
      'yellow'
    )
    log(
      '║              ⚠️  Max iterations reached                     ║',
      'yellow'
    )
    log(
      '║              PRD may not be complete                       ║',
      'yellow'
    )
    log(
      '╚════════════════════════════════════════════════════════════╝',
      'yellow'
    )
    sendNotification(
      'Ralph Wiggum',
      `Max iterations (${args.iterations}) reached`
    )
  }
}

/**
 * Wait for Enter key press
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve()
    })
  })
}
