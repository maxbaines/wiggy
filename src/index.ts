#!/usr/bin/env bun
/**
 * Little Wiggy - CLI Entry Point
 * Autonomous AI coding loop using Claude Agent SDK
 */

import type { RalphArgs } from './types.ts'
import { runRalph } from './ralph.ts'
import { generateProjectFiles } from './generate.ts'
import { loadConfig } from './config.ts'

const VERSION = '1.0.0'

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): RalphArgs {
  const result: RalphArgs = {
    iterations: 1,
    hitl: false,
    sandbox: false,
    help: false,
    version: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true
        break

      case '-v':
      case '--version':
        result.version = true
        break

      case '--hitl':
        result.hitl = true
        break

      case '--sandbox':
        result.sandbox = true
        break

      case '-c':
      case '--config':
        result.configFile = args[++i]
        break

      case '-n':
      case '--iterations':
        result.iterations = parseInt(args[++i], 10)
        break

      default:
        // Check if it's a number (iterations)
        const num = parseInt(arg, 10)
        if (!isNaN(num) && num > 0) {
          result.iterations = num
        }
        break
    }
  }

  return result
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Little Wiggy - Autonomous AI Coding Loop

Usage: wiggy [command] [options]

Commands:
  run [iterations]    Run the coding loop (default command)
  init <description>  Generate a PRD from a description

Run Options:
  -h, --help          Show this help message
  -v, --version       Show version number
  -n, --iterations N  Number of iterations to run
  --hitl              Human-in-the-loop mode (pause between iterations)
  --sandbox           Run in sandbox mode (limited permissions)
  -c, --config FILE   Path to config file (default: ralph.config.json)

Init Options:
  --analyze           Analyze existing codebase for context
  --output FILE       Output file (default: prd.md)

Examples:
  wiggy 5             Run 5 iterations
  wiggy 10 --hitl     Run 10 iterations with HITL pauses
  wiggy init "Build a REST API for user authentication"
  wiggy init "Add tests for all endpoints" --analyze

Configuration:
  Ralph looks for configuration in this order:
  1. Environment variables (ANTHROPIC_API_KEY, RALPH_MODEL, etc.)
  2. Config file (ralph.config.json)
  3. .env file

  Required:
    ANTHROPIC_API_KEY   Your Anthropic API key

  Optional:
    RALPH_MODEL         Model to use (default: claude-sonnet-4-20250514)
    RALPH_MAX_TOKENS    Max tokens per response (default: 8192)
    RALPH_WORKING_DIR   Working directory (default: current directory)
    RALPH_PRD_FILE      Path to PRD file (default: auto-detect)
    RALPH_PROGRESS_FILE Progress file path (default: progress.txt)
    RALPH_VERBOSE       Enable verbose logging (default: false)

PRD Files:
  Ralph looks for PRD files in this order:
  - plans/prd.md
  - prd.md

For more information, visit: https://github.com/maxbaines/ralph
`)
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(`Little Wiggy v${VERSION}`)
}

/**
 * Handle init command - generate PRD from description
 */
async function handleInit(args: string[]): Promise<void> {
  let description = ''
  let analyze = false
  let output = 'prd.md'
  let configFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--analyze':
        analyze = true
        break
      case '--output':
        output = args[++i]
        break
      case '-c':
      case '--config':
        configFile = args[++i]
        break
      default:
        // Collect description (non-flag arguments)
        if (!arg.startsWith('-')) {
          description += (description ? ' ' : '') + arg
        }
        break
    }
  }

  if (!description) {
    console.error('Error: Please provide a project description')
    console.error('Usage: wiggy init "Your project description"')
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🤖 Little Wiggy                         ║')
  console.log('║              PRD & AGENTS.md Generator                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  try {
    const config = loadConfig(configFile)

    console.log(`📝 Description: ${description}`)
    console.log(`📁 PRD Output: ${output}`)
    console.log(`📁 AGENTS.md: AGENTS.md`)
    console.log(`🔍 Analyze codebase: ${analyze}`)
    console.log('')

    const { prd } = await generateProjectFiles(description, config, {
      prdPath: output,
      agentsPath: 'AGENTS.md',
      analyzeCodebase: analyze,
      verbose: true,
    })

    console.log('')
    console.log('📋 Generated PRD:')
    console.log(`   Name: ${prd.name}`)
    console.log(`   Tasks: ${prd.items.length}`)
    console.log('')
    console.log('   Tasks by priority:')
    const high = prd.items.filter((item) => item.priority === 'high').length
    const medium = prd.items.filter((item) => item.priority === 'medium').length
    const low = prd.items.filter((item) => item.priority === 'low').length
    console.log(`   - High: ${high}`)
    console.log(`   - Medium: ${medium}`)
    console.log(`   - Low: ${low}`)
    console.log('')
    console.log(
      `🚀 Run 'wiggy ${prd.items.length}' to start working through the PRD`
    )
  } catch (error) {
    console.error(
      'Error generating PRD:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Skip first two args (bun and script path)
  const rawArgs = process.argv.slice(2)

  // Check for init command
  if (rawArgs[0] === 'init') {
    await handleInit(rawArgs.slice(1))
    return
  }

  // Check for run command (explicit or implicit)
  const argsToProcess = rawArgs[0] === 'run' ? rawArgs.slice(1) : rawArgs
  const args = parseArgs(argsToProcess)

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.version) {
    printVersion()
    process.exit(0)
  }

  if (args.iterations < 1) {
    console.error('Error: iterations must be at least 1')
    process.exit(1)
  }

  if (args.sandbox) {
    console.log('Note: Sandbox mode is not yet implemented in the Bun version.')
    console.log(
      'For sandboxed execution, use Docker or the shell script version.'
    )
  }

  try {
    await runRalph(args)
  } catch (error) {
    console.error(
      'Fatal error:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// Run
main()
