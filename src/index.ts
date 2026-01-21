#!/usr/bin/env bun
/**
 * Loop - CLI Entry Point
 * Autonomous AI coding loop using Claude Agent SDK
 */

import type { RalphArgs } from './types.ts'
import { runRalph } from './ralph.ts'
import { generateProjectFiles } from './generate.ts'
import { loadConfig } from './config.ts'
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { spawnSync } from 'child_process'

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
        // Check if next arg is the sandbox name (not a flag)
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result.sandboxName = args[++i]
        }
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
Loop - Autonomous AI Coding Agent

Usage: loop [command] [options]

Commands:
  run [iterations]    Run the coding loop (default command)
  init <description>  Generate a PRD from a description
  do <description>    Generate a PRD and run it to completion (one-off task)
  new <name>          Create a new project folder in proj/
  sandbox <name>      Launch a fresh Docker sandbox (rebuilds image)
  global              Install loop globally to /usr/local/bin

Run Options:
  -h, --help          Show this help message
  -v, --version       Show version number
  -n, --iterations N  Number of iterations to run
  --hitl              Human-in-the-loop mode (pause between iterations)
  -c, --config FILE   Path to config file (default: ralph.config.json)

Init Options:
  --analyze           Analyze existing codebase for context
  --output FILE       Output file (default: prd.md)

Do Options:
  --hitl              Human-in-the-loop mode (pause between iterations)
  --max N             Maximum iterations (default: task count + 2)
  -c, --config FILE   Path to config file (default: ralph.config.json)

Examples:
  loop 5                  Run 5 iterations
  loop 10 --hitl          Run 10 iterations with HITL pauses
  loop new myproject      Create proj/myproject with all needed files
  loop sandbox myproject  Launch fresh Docker sandbox 'loop-myproject'
  loop global             Install loop globally (requires sudo)
  loop init "Build a REST API for user authentication"
  loop init "Add tests for all endpoints" --analyze
  loop do "Fix build errors and package as an app"
  loop do "Add dark mode support" --hitl

Configuration:
  Loop looks for configuration in this order:
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
  Loop looks for PRD files in this order:
  - do.md (created by 'do' command)
  - plans/prd.md
  - prd.md

For more information, visit: https://github.com/maxbaines/loop
`)
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(`Loop v${VERSION}`)
}

/**
 * Handle global command - install loop globally
 */
async function handleGlobal(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🤖 Loop                         ║')
  console.log('║                   Global Installation                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const platform = process.platform
  if (platform === 'win32') {
    console.error('❌ Global installation is not supported on Windows.')
    console.error('   Please add the loop binary to your PATH manually.')
    process.exit(1)
  }

  const binPath = '/usr/local/bin/loop'
  const sharePath = '/usr/local/share/loop/docker'
  const sandboxDest = join(sharePath, 'sandbox.sh')

  // Find the current loop binary
  const currentBinary = process.argv[1]
  if (!currentBinary || !existsSync(currentBinary)) {
    console.error('❌ Could not find current loop binary')
    process.exit(1)
  }

  // Find sandbox.sh
  const possibleSandboxPaths = [
    join(process.cwd(), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary), '..', 'docker', 'sandbox.sh'),
  ]

  let sandboxSrc: string | null = null
  for (const p of possibleSandboxPaths) {
    if (existsSync(p)) {
      sandboxSrc = p
      break
    }
  }

  console.log(`📦 Installing loop globally...`)
  console.log(`   Binary: ${currentBinary} → ${binPath}`)
  if (sandboxSrc) {
    console.log(`   Sandbox: ${sandboxSrc} → ${sandboxDest}`)
  }
  console.log('')

  // Use sudo to copy files
  const commands: string[][] = []

  // Copy binary
  commands.push(['sudo', 'cp', currentBinary, binPath])
  commands.push(['sudo', 'chmod', '+x', binPath])

  // Copy sandbox.sh if found
  if (sandboxSrc) {
    commands.push(['sudo', 'mkdir', '-p', sharePath])
    commands.push(['sudo', 'cp', sandboxSrc, sandboxDest])
    commands.push(['sudo', 'chmod', '+x', sandboxDest])
  }

  console.log('🔐 Requesting sudo access...')
  console.log('')

  for (const cmd of commands) {
    const result = spawnSync(cmd[0], cmd.slice(1), {
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      console.error(`❌ Failed to execute: ${cmd.join(' ')}`)
      process.exit(1)
    }
  }

  console.log('')
  console.log('✅ Loop installed globally!')
  console.log('')
  console.log('   You can now run:')
  console.log('   $ loop --help')
  console.log('   $ loop init "Your project description"')
  console.log('   $ loop do "Your task"')
  console.log('')
}

/**
 * Handle new command - create a new project folder
 */
async function handleNew(args: string[]): Promise<void> {
  const name = args[0]

  if (!name || name.startsWith('-')) {
    console.error('Error: Please provide a project name')
    console.error('Usage: loop new <name>')
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🤖 Loop                         ║')
  console.log('║                   New Project Setup                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const projDir = join(process.cwd(), 'proj', name)

  if (existsSync(projDir)) {
    console.error(`❌ Project folder already exists: ${projDir}`)
    process.exit(1)
  }

  console.log(`📁 Creating project: ${name}`)
  console.log(`   Location: ${projDir}`)
  console.log('')

  // Create project directory structure
  mkdirSync(projDir, { recursive: true })
  mkdirSync(join(projDir, 'docker'), { recursive: true })

  // Find and copy loop binary
  const currentBinary = process.argv[1]
  const possibleBinaries = [
    currentBinary,
    join(process.cwd(), 'loop'),
    '/usr/local/bin/loop',
  ]

  let binarySrc: string | null = null
  for (const p of possibleBinaries) {
    if (p && existsSync(p)) {
      binarySrc = p
      break
    }
  }

  if (binarySrc) {
    copyFileSync(binarySrc, join(projDir, 'loop'))
    // Make executable
    spawnSync('chmod', ['+x', join(projDir, 'loop')])
    console.log('   ✓ Copied loop binary')
  } else {
    console.log('   ⚠ Could not find loop binary to copy')
  }

  // Find and copy sandbox.sh
  const possibleSandboxPaths = [
    join(process.cwd(), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary || ''), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary || ''), '..', 'docker', 'sandbox.sh'),
    '/usr/local/share/loop/docker/sandbox.sh',
  ]

  let sandboxSrc: string | null = null
  for (const p of possibleSandboxPaths) {
    if (existsSync(p)) {
      sandboxSrc = p
      break
    }
  }

  if (sandboxSrc) {
    copyFileSync(sandboxSrc, join(projDir, 'docker', 'sandbox.sh'))
    spawnSync('chmod', ['+x', join(projDir, 'docker', 'sandbox.sh')])
    console.log('   ✓ Copied docker/sandbox.sh')
  }

  // Copy or create .env
  const possibleEnvPaths = [
    join(process.cwd(), '.env'),
    join(dirname(currentBinary || ''), '.env'),
  ]

  let envSrc: string | null = null
  for (const p of possibleEnvPaths) {
    if (existsSync(p)) {
      envSrc = p
      break
    }
  }

  if (envSrc) {
    copyFileSync(envSrc, join(projDir, '.env'))
    console.log('   ✓ Copied .env')
  } else {
    // Create default .env
    const defaultEnv = `# Loop Configuration
ANTHROPIC_API_KEY=your-api-key-here
RALPH_MODEL=claude-sonnet-4-20250514
RALPH_MAX_TOKENS=8192
RALPH_VERBOSE=false
`
    writeFileSync(join(projDir, '.env'), defaultEnv)
    console.log('   ✓ Created .env (please add your API key)')
  }

  // Create .gitignore
  const gitignore = `.env
progress.txt
node_modules/
dist/
*.log
.DS_Store
`
  writeFileSync(join(projDir, '.gitignore'), gitignore)
  console.log('   ✓ Created .gitignore')

  console.log('')
  console.log('✅ Project created successfully!')
  console.log('')
  console.log('   Next steps:')
  console.log(`   $ cd proj/${name}`)
  console.log('   $ ./loop init "Your project description"')
  console.log('   $ ./loop 5')
  console.log('')
}

/**
 * Handle sandbox command - launch fresh Docker sandbox
 */
async function handleSandbox(args: string[]): Promise<void> {
  const name = args[0]

  if (!name || name.startsWith('-')) {
    console.error('Error: Please provide a sandbox name')
    console.error('Usage: loop sandbox <name>')
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                   Fresh Build Mode                         ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const containerName = `loop-${name}`
  const imageName = 'loop'

  // Check if Docker is running
  const dockerCheck = spawnSync('docker', ['info'], { stdio: 'pipe' })
  if (dockerCheck.status !== 0) {
    console.error('❌ Docker is not running')
    console.error('   Please start Docker and try again.')
    process.exit(1)
  }

  // Stop and remove existing container if it exists
  console.log(`📦 Container: ${containerName}`)
  console.log(`📁 Workspace: ${process.cwd()}`)
  console.log('')

  const existingContainer = spawnSync(
    'docker',
    ['ps', '-a', '--format', '{{.Names}}'],
    { stdio: 'pipe' },
  )
  const containers = existingContainer.stdout?.toString() || ''

  if (containers.split('\n').includes(containerName)) {
    console.log('⏳ Removing existing container...')
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' })
    console.log('   ✓ Removed')
  }

  // Always rebuild the image
  console.log('⏳ Building fresh Docker image...')

  // Find Dockerfile
  const possibleDockerfiles = [
    join(process.cwd(), 'Dockerfile'),
    join(dirname(process.argv[1] || ''), 'Dockerfile'),
    join(dirname(process.argv[1] || ''), '..', 'Dockerfile'),
  ]

  let dockerfilePath: string | null = null
  let dockerContext: string | null = null
  for (const p of possibleDockerfiles) {
    if (existsSync(p)) {
      dockerfilePath = p
      dockerContext = dirname(p)
      break
    }
  }

  if (!dockerfilePath || !dockerContext) {
    console.error('❌ Dockerfile not found')
    console.error('   Make sure you have a Dockerfile in the project.')
    process.exit(1)
  }

  const buildResult = spawnSync(
    'docker',
    ['build', '-t', imageName, dockerContext],
    { stdio: 'inherit' },
  )

  if (buildResult.status !== 0) {
    console.error('❌ Docker build failed')
    process.exit(1)
  }

  console.log('   ✓ Image built')
  console.log('')

  // Create new container
  console.log('⏳ Creating new container...')

  const dockerRunArgs = [
    'run',
    '-d',
    '--name',
    containerName,
    '-v',
    `${process.cwd()}:/workspace`,
  ]

  // Pass through environment variables
  if (process.env.ANTHROPIC_API_KEY) {
    dockerRunArgs.push(
      '-e',
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
    )
  }
  if (process.env.RALPH_MODEL) {
    dockerRunArgs.push('-e', `RALPH_MODEL=${process.env.RALPH_MODEL}`)
  }
  if (process.env.RALPH_MAX_TOKENS) {
    dockerRunArgs.push('-e', `RALPH_MAX_TOKENS=${process.env.RALPH_MAX_TOKENS}`)
  }
  if (process.env.RALPH_VERBOSE) {
    dockerRunArgs.push('-e', `RALPH_VERBOSE=${process.env.RALPH_VERBOSE}`)
  }

  // Calculate port based on container name hash
  const hash = name.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0)
    return a & a
  }, 0)
  const portOffset = Math.abs(hash) % 1000
  const webPort = 7681 + portOffset

  dockerRunArgs.push('-p', `${webPort}:7681`)
  dockerRunArgs.push(imageName)

  const runResult = spawnSync('docker', dockerRunArgs, { stdio: 'pipe' })

  if (runResult.status !== 0) {
    console.error('❌ Failed to create container')
    console.error(runResult.stderr?.toString())
    process.exit(1)
  }

  console.log('   ✓ Container created')
  console.log(`🌐 Web terminal: http://localhost:${webPort}`)
  console.log('')
  console.log('🚀 Connecting to sandbox...')
  console.log("   Type 'exit' to leave (container keeps running)")
  console.log(`   Run 'docker stop ${containerName}' to stop`)
  console.log('')
  console.log(
    '════════════════════════════════════════════════════════════════',
  )

  // Attach to container
  const execResult = spawnSync(
    'docker',
    ['exec', '-it', '-w', '/workspace', containerName, 'bash'],
    { stdio: 'inherit' },
  )

  process.exit(execResult.status || 0)
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
    console.error('Usage: loop init "Your project description"')
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🤖 Loop                         ║')
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
      `🚀 Run 'loop ${prd.items.length}' to start working through the PRD`,
    )
  } catch (error) {
    console.error(
      'Error generating PRD:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }
}

/**
 * Handle do command - generate PRD and run it to completion
 */
async function handleDo(args: string[]): Promise<void> {
  let description = ''
  let hitl = false
  let maxIterations: number | undefined
  let configFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--hitl':
        hitl = true
        break
      case '--max':
        maxIterations = parseInt(args[++i], 10)
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
    console.error('Error: Please provide a task description')
    console.error('Usage: loop do "Your task description"')
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🤖 Loop                         ║')
  console.log('║                   One-Off Task: DO                         ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  try {
    const config = loadConfig(configFile)

    console.log(`📝 Description: ${description}`)
    console.log(`🔍 Analyzing codebase for context...`)
    console.log('')

    // Generate PRD and AGENTS.md with codebase analysis
    const { prd } = await generateProjectFiles(description, config, {
      prdPath: 'do.md',
      agentsPath: 'AGENTS.md',
      analyzeCodebase: true,
      verbose: true,
    })

    console.log('')
    console.log('📋 Generated PRD:')
    console.log(`   Name: ${prd.name}`)
    console.log(`   Tasks: ${prd.items.length}`)
    console.log('')

    // Calculate iterations: task count + 2 buffer, or use --max if provided
    const iterations = maxIterations || prd.items.length + 2

    console.log(`🚀 Starting execution (${iterations} iterations max)...`)
    console.log('')

    // Run the loop
    await runRalph({
      iterations,
      hitl,
      sandbox: false,
      help: false,
      version: false,
      configFile,
    })
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Skip first two args (bun and script path)
  const rawArgs = process.argv.slice(2)

  // Check for global command
  if (rawArgs[0] === 'global') {
    await handleGlobal()
    return
  }

  // Check for new command
  if (rawArgs[0] === 'new') {
    await handleNew(rawArgs.slice(1))
    return
  }

  // Check for sandbox command
  if (rawArgs[0] === 'sandbox') {
    await handleSandbox(rawArgs.slice(1))
    return
  }

  // Check for init command
  if (rawArgs[0] === 'init') {
    await handleInit(rawArgs.slice(1))
    return
  }

  // Check for do command
  if (rawArgs[0] === 'do') {
    await handleDo(rawArgs.slice(1))
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
    // Launch sandbox mode via Docker
    const sandboxName = args.sandboxName || 'default'
    const { spawnSync } = await import('child_process')
    const { join, dirname } = await import('path')
    const { fileURLToPath } = await import('url')

    // Find the sandbox script - check multiple locations
    const possiblePaths = [
      join(process.cwd(), 'docker', 'sandbox.sh'),
      join(dirname(process.argv[1]), '..', 'docker', 'sandbox.sh'),
      '/usr/local/share/loop/docker/sandbox.sh',
    ]

    let sandboxScript: string | null = null
    const { existsSync } = await import('fs')
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        sandboxScript = p
        break
      }
    }

    if (!sandboxScript) {
      console.error('Error: sandbox.sh script not found')
      console.error(
        'Make sure you have the docker/sandbox.sh script available.',
      )
      process.exit(1)
    }

    console.log(`🐳 Launching sandbox: ${sandboxName}`)

    // Execute the sandbox script
    const result = spawnSync('bash', [sandboxScript, sandboxName], {
      stdio: 'inherit',
      env: process.env,
    })

    process.exit(result.status || 0)
  }

  try {
    await runRalph(args)
  } catch (error) {
    console.error(
      'Fatal error:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }
}

// Run
main()
