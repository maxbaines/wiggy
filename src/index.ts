#!/usr/bin/env bun
/**
 * Loop - CLI Entry Point
 * Autonomous AI coding loop using Claude Agent SDK
 */

import type { RalphArgs } from './types.ts'
import { runRalph } from './ralph.ts'
import { generateProjectFiles } from './generate.ts'
import { loadConfig } from './config.ts'
import { savePrd } from './prd.ts'
import type { PrdJson, PrdItem } from './types.ts'
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs'
import * as readline from 'readline'
import { join, dirname } from 'path'
import { spawnSync } from 'child_process'

const VERSION = '1.1.0'

/**
 * Check if running inside a Docker container
 */
function isInsideDocker(): boolean {
  // Check for /.dockerenv file (created by Docker)
  if (existsSync('/.dockerenv')) {
    return true
  }
  // Check for container environment variable
  if (process.env.DOCKER_CONTAINER === 'true') {
    return true
  }
  return false
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): RalphArgs {
  const result: RalphArgs = {
    iterations: 1,
    hitl: false,
    sandbox: true,
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

      case '--no-sandbox':
        result.sandbox = false
        break

      case '--analyze':
        result.analyze = true
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
  sandbox list        List all sandbox containers
  sandbox stop <name> Stop a specific sandbox container
  sandbox stop all    Stop all running sandbox containers
  sandbox remove <name>  Remove container and proj folder (with confirmation)
  sandbox remove all     Remove all sandboxes and proj folders (with confirmation)
  global              Install loop globally to /usr/local/bin

Run Options:
  -h, --help          Show this help message
  -v, --version       Show version number
  -n, --iterations N  Number of iterations to run
  --hitl              Human-in-the-loop mode (pause between iterations)
  --no-sandbox        Run locally instead of in Docker sandbox (sandbox is default)
  -c, --config FILE   Path to config file (default: ralph.config.json)

Manual Intervention:
  Press Ctrl+\\ during execution to pause and add feedback to the agent.
  Your message will be included in the next iteration's context.

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
    RALPH_PROGRESS_MODE Progress tracking mode: "git" or "file" (default: git)
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
 * Get the actual binary path (handles compiled Bun binaries)
 * For compiled binaries, process.argv[1] returns a virtual /$bunfs/ path
 * We need to use process.execPath instead
 */
function getBinaryPath(): string {
  // For compiled Bun binaries, process.execPath is the actual binary
  // For dev mode (bun run), process.argv[1] is the script path
  const execPath = process.execPath

  // If execPath doesn't contain 'bun' in the path, it's likely the compiled binary
  if (!execPath.includes('bun') && existsSync(execPath)) {
    return execPath
  }

  // Fallback: try to find loop binary in common locations
  const possiblePaths = [join(process.cwd(), 'loop'), '/usr/local/bin/loop']

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // Last resort: return execPath even if it might be bun
  return execPath
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

  // Find the current loop binary (use execPath for compiled binaries)
  const currentBinary = getBinaryPath()
  if (!currentBinary || !existsSync(currentBinary)) {
    console.error('❌ Could not find current loop binary')
    console.error(`   Tried: ${currentBinary}`)
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

  // Find and copy loop binary (use getBinaryPath for compiled binaries)
  const currentBinary = getBinaryPath()
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

  // Copy Dockerfile and docker scripts for sandbox support
  const possibleDockerfilePaths = [
    join(process.cwd(), 'Dockerfile'),
    join(dirname(currentBinary || ''), 'Dockerfile'),
    join(dirname(currentBinary || ''), '..', 'Dockerfile'),
    '/usr/local/share/loop/Dockerfile',
  ]

  let dockerfileSrc: string | null = null
  for (const p of possibleDockerfilePaths) {
    if (existsSync(p)) {
      dockerfileSrc = p
      break
    }
  }

  if (dockerfileSrc) {
    copyFileSync(dockerfileSrc, join(projDir, 'Dockerfile'))
    console.log('   ✓ Copied Dockerfile')

    // Also copy entrypoint.sh and terminal.sh from the same docker directory
    const dockerDir = dirname(dockerfileSrc)
    const entrypointSrc = join(dockerDir, 'docker', 'entrypoint.sh')
    const terminalSrc = join(dockerDir, 'docker', 'terminal.sh')

    // Try alternate paths if docker/ subdirectory doesn't exist
    const entrypointPaths = [
      entrypointSrc,
      join(dockerDir, 'entrypoint.sh'),
      join(process.cwd(), 'docker', 'entrypoint.sh'),
    ]
    const terminalPaths = [
      terminalSrc,
      join(dockerDir, 'terminal.sh'),
      join(process.cwd(), 'docker', 'terminal.sh'),
    ]

    for (const p of entrypointPaths) {
      if (existsSync(p)) {
        copyFileSync(p, join(projDir, 'docker', 'entrypoint.sh'))
        spawnSync('chmod', ['+x', join(projDir, 'docker', 'entrypoint.sh')])
        console.log('   ✓ Copied docker/entrypoint.sh')
        break
      }
    }

    for (const p of terminalPaths) {
      if (existsSync(p)) {
        copyFileSync(p, join(projDir, 'docker', 'terminal.sh'))
        spawnSync('chmod', ['+x', join(projDir, 'docker', 'terminal.sh')])
        console.log('   ✓ Copied docker/terminal.sh')
        break
      }
    }
  } else {
    console.log(
      '   ⚠ Could not find Dockerfile to copy (sandbox will not work)',
    )
  }

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
 * Create project folder for sandbox (reuses logic from handleNew)
 */
function createProjectFolder(name: string): string {
  const projDir = join(process.cwd(), 'proj', name)

  // If project already exists, just return the path
  if (existsSync(projDir)) {
    return projDir
  }

  console.log(`📁 Creating project folder: proj/${name}`)
  console.log('')

  // Create project directory structure
  mkdirSync(projDir, { recursive: true })
  mkdirSync(join(projDir, 'docker'), { recursive: true })

  // Find and copy loop binary
  const currentBinary = getBinaryPath()
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
    spawnSync('chmod', ['+x', join(projDir, 'loop')])
    console.log('   ✓ Copied loop binary')
  }

  // Find and copy sandbox.sh
  const possibleSandboxPaths = [
    join(process.cwd(), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary || ''), 'docker', 'sandbox.sh'),
    join(dirname(currentBinary || ''), '..', 'docker', 'sandbox.sh'),
    '/usr/local/share/loop/docker/sandbox.sh',
  ]

  for (const p of possibleSandboxPaths) {
    if (existsSync(p)) {
      copyFileSync(p, join(projDir, 'docker', 'sandbox.sh'))
      spawnSync('chmod', ['+x', join(projDir, 'docker', 'sandbox.sh')])
      console.log('   ✓ Copied docker/sandbox.sh')
      break
    }
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

  // Copy Dockerfile and docker scripts
  const possibleDockerfilePaths = [
    join(process.cwd(), 'Dockerfile'),
    join(dirname(currentBinary || ''), 'Dockerfile'),
    join(dirname(currentBinary || ''), '..', 'Dockerfile'),
    '/usr/local/share/loop/Dockerfile',
  ]

  let dockerfileSrc: string | null = null
  for (const p of possibleDockerfilePaths) {
    if (existsSync(p)) {
      dockerfileSrc = p
      break
    }
  }

  if (dockerfileSrc) {
    copyFileSync(dockerfileSrc, join(projDir, 'Dockerfile'))
    console.log('   ✓ Copied Dockerfile')

    const dockerDir = dirname(dockerfileSrc)
    const entrypointPaths = [
      join(dockerDir, 'docker', 'entrypoint.sh'),
      join(dockerDir, 'entrypoint.sh'),
      join(process.cwd(), 'docker', 'entrypoint.sh'),
    ]
    const terminalPaths = [
      join(dockerDir, 'docker', 'terminal.sh'),
      join(dockerDir, 'terminal.sh'),
      join(process.cwd(), 'docker', 'terminal.sh'),
    ]

    for (const p of entrypointPaths) {
      if (existsSync(p)) {
        copyFileSync(p, join(projDir, 'docker', 'entrypoint.sh'))
        spawnSync('chmod', ['+x', join(projDir, 'docker', 'entrypoint.sh')])
        console.log('   ✓ Copied docker/entrypoint.sh')
        break
      }
    }

    for (const p of terminalPaths) {
      if (existsSync(p)) {
        copyFileSync(p, join(projDir, 'docker', 'terminal.sh'))
        spawnSync('chmod', ['+x', join(projDir, 'docker', 'terminal.sh')])
        console.log('   ✓ Copied docker/terminal.sh')
        break
      }
    }
  }

  console.log('')
  return projDir
}

/**
 * Handle sandbox stop command - stop a specific sandbox container
 */
async function handleSandboxStop(name: string): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                      Stop Container                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const containerName = name.startsWith('loop-') ? name : `loop-${name}`

  // Check if container exists
  const existsResult = spawnSync(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `name=^${containerName}$`,
      '--format',
      '{{.Names}}',
    ],
    { stdio: 'pipe' },
  )

  const exists = existsResult.stdout?.toString().trim()
  if (!exists) {
    console.log(`❌ Container '${containerName}' not found`)
    console.log('')
    console.log('   Run "loop sandbox list" to see available sandboxes.')
    process.exit(1)
  }

  // Check if container is running
  const runningResult = spawnSync(
    'docker',
    ['ps', '--filter', `name=^${containerName}$`, '--format', '{{.Names}}'],
    { stdio: 'pipe' },
  )

  const isRunning = runningResult.stdout?.toString().trim()
  if (!isRunning) {
    console.log(`⚫ Container '${containerName}' is already stopped`)
    return
  }

  // Stop the container
  console.log(`⏳ Stopping ${containerName}...`)
  const stopResult = spawnSync('docker', ['stop', containerName], {
    stdio: 'pipe',
  })

  if (stopResult.status !== 0) {
    console.error(
      `❌ Failed to stop container: ${stopResult.stderr?.toString()}`,
    )
    process.exit(1)
  }

  console.log(`✅ Stopped ${containerName}`)
}

/**
 * Prompt user for confirmation
 */
async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Handle sandbox remove command - remove a specific sandbox container and project folder
 */
async function handleSandboxRemove(name: string): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                    Remove Container                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const containerName = name.startsWith('loop-') ? name : `loop-${name}`
  const projectName = name.startsWith('loop-') ? name.slice(5) : name
  const projDir = join(process.cwd(), 'proj', projectName)

  // Check what exists
  const containerResult = spawnSync(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `name=^${containerName}$`,
      '--format',
      '{{.Names}}',
    ],
    { stdio: 'pipe' },
  )
  const containerExists = containerResult.stdout?.toString().trim()
  const projDirExists = existsSync(projDir)

  if (!containerExists && !projDirExists) {
    console.log(`❌ Nothing found for '${projectName}'`)
    console.log('')
    console.log('   Run "loop sandbox list" to see available sandboxes.')
    process.exit(1)
  }

  // Show what will be removed
  console.log('⚠️  The following will be PERMANENTLY removed:')
  console.log('')
  if (containerExists) {
    console.log(`   🐳 Docker container: ${containerName}`)
  }
  if (projDirExists) {
    console.log(`   📁 Project folder:   ${projDir}`)
  }
  console.log('')

  // Ask for confirmation
  const confirmed = await askConfirmation('Are you sure? (y/N): ')
  if (!confirmed) {
    console.log('')
    console.log('❌ Cancelled')
    return
  }

  console.log('')

  // Remove container
  if (containerExists) {
    console.log(`⏳ Removing container ${containerName}...`)
    const rmResult = spawnSync('docker', ['rm', '-f', containerName], {
      stdio: 'pipe',
    })
    if (rmResult.status === 0) {
      console.log(`   ✅ Removed container`)
    } else {
      console.log(`   ❌ Failed to remove container`)
    }
  }

  // Remove project folder
  if (projDirExists) {
    console.log(`⏳ Removing project folder ${projDir}...`)
    try {
      rmSync(projDir, { recursive: true, force: true })
      console.log(`   ✅ Removed project folder`)
    } catch (err) {
      console.log(`   ❌ Failed to remove project folder: ${err}`)
    }
  }

  console.log('')
  console.log('✅ Done')
}

/**
 * Handle sandbox remove all command - remove all sandbox containers and project folders
 */
async function handleSandboxRemoveAll(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                  Remove All Containers                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Get all containers with loop- prefix
  const result = spawnSync(
    'docker',
    ['ps', '-a', '--filter', 'name=loop-', '--format', '{{.Names}}'],
    { stdio: 'pipe' },
  )

  const output = result.stdout?.toString().trim()
  const containers = output ? output.split('\n').filter(Boolean) : []

  // Get all project folders
  const projBaseDir = join(process.cwd(), 'proj')
  let projectFolders: string[] = []
  if (existsSync(projBaseDir)) {
    const { readdirSync, statSync } = await import('fs')
    try {
      projectFolders = readdirSync(projBaseDir)
        .filter((f) => statSync(join(projBaseDir, f)).isDirectory())
        .map((f) => join(projBaseDir, f))
    } catch {
      // Ignore errors
    }
  }

  if (containers.length === 0 && projectFolders.length === 0) {
    console.log('   No sandboxes or project folders found.')
    return
  }

  // Show what will be removed
  console.log('⚠️  The following will be PERMANENTLY removed:')
  console.log('')
  if (containers.length > 0) {
    console.log('   🐳 Docker containers:')
    for (const c of containers) {
      console.log(`      - ${c}`)
    }
  }
  if (projectFolders.length > 0) {
    console.log('   📁 Project folders:')
    for (const f of projectFolders) {
      console.log(`      - ${f}`)
    }
  }
  console.log('')

  // Ask for confirmation
  const confirmed = await askConfirmation(
    'Are you sure you want to remove ALL sandboxes? (y/N): ',
  )
  if (!confirmed) {
    console.log('')
    console.log('❌ Cancelled')
    return
  }

  console.log('')

  // Remove containers
  let containersRemoved = 0
  let containersFailed = 0
  for (const container of containers) {
    const rmResult = spawnSync('docker', ['rm', '-f', container], {
      stdio: 'pipe',
    })
    if (rmResult.status === 0) {
      console.log(`   ✅ Removed container ${container}`)
      containersRemoved++
    } else {
      console.log(`   ❌ Failed to remove container ${container}`)
      containersFailed++
    }
  }

  // Remove project folders
  let foldersRemoved = 0
  let foldersFailed = 0
  for (const folder of projectFolders) {
    try {
      rmSync(folder, { recursive: true, force: true })
      console.log(`   ✅ Removed folder ${folder}`)
      foldersRemoved++
    } catch (err) {
      console.log(`   ❌ Failed to remove folder ${folder}`)
      foldersFailed++
    }
  }

  console.log('')
  console.log(
    `   Summary: ${containersRemoved} containers removed, ${foldersRemoved} folders removed`,
  )
  if (containersFailed > 0 || foldersFailed > 0) {
    console.log(
      `            ${containersFailed} containers failed, ${foldersFailed} folders failed`,
    )
  }
}

/**
 * Handle sandbox stop all command - stop all sandbox containers
 */
async function handleSandboxStopAll(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                   Stop All Containers                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Get all running containers with loop- prefix
  const result = spawnSync(
    'docker',
    ['ps', '--filter', 'name=loop-', '--format', '{{.Names}}'],
    { stdio: 'pipe' },
  )

  if (result.status !== 0) {
    console.error('❌ Failed to list containers')
    process.exit(1)
  }

  const output = result.stdout?.toString().trim()
  if (!output) {
    console.log('   No running sandboxes found.')
    return
  }

  const containers = output.split('\n').filter(Boolean)
  console.log(`⏳ Stopping ${containers.length} sandbox(es)...`)
  console.log('')

  let stopped = 0
  let failed = 0

  for (const container of containers) {
    const stopResult = spawnSync('docker', ['stop', container], {
      stdio: 'pipe',
    })
    if (stopResult.status === 0) {
      console.log(`   ✅ Stopped ${container}`)
      stopped++
    } else {
      console.log(`   ❌ Failed to stop ${container}`)
      failed++
    }
  }

  console.log('')
  console.log(`   Summary: ${stopped} stopped, ${failed} failed`)
}

/**
 * Handle sandbox list command - show all sandbox containers
 */
async function handleSandboxList(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandboxes                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Get all containers with loop- prefix
  const result = spawnSync(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      'name=loop-',
      '--format',
      '{{.Names}}\t{{.Status}}\t{{.Ports}}',
    ],
    { stdio: 'pipe' },
  )

  if (result.status !== 0) {
    console.error('❌ Failed to list containers')
    process.exit(1)
  }

  const output = result.stdout?.toString().trim()
  if (!output) {
    console.log('   No sandboxes found.')
    console.log('')
    console.log('   Create one with: loop sandbox <name>')
    return
  }

  const lines = output.split('\n')
  console.log('   NAME                STATUS              WEB TERMINAL')
  console.log('   ─────────────────────────────────────────────────────────')

  for (const line of lines) {
    const [name, status, ports] = line.split('\t')
    const isRunning = status?.toLowerCase().includes('up')
    const statusIcon = isRunning ? '🟢' : '⚫'

    // Extract port from ports string (e.g., "0.0.0.0:7962->7681/tcp")
    let webUrl = '-'
    if (ports) {
      const portMatch = ports.match(/:(\d+)->7681/)
      if (portMatch) {
        webUrl = `http://localhost:${portMatch[1]}`
      }
    }

    console.log(
      `   ${statusIcon} ${name.padEnd(18)} ${(isRunning ? 'running' : 'stopped').padEnd(18)} ${webUrl}`,
    )
  }

  console.log('')
  console.log('   Commands:')
  console.log('   - Attach: docker exec -it <name> bash')
  console.log('   - Stop:   docker stop <name>')
  console.log('   - Remove: docker rm <name>')
  console.log('')
}

/**
 * Handle sandbox command - launch fresh Docker sandbox
 */
async function handleSandbox(args: string[]): Promise<void> {
  const name = args[0]

  // Check for 'list' subcommand - should have been handled in main() but double-check
  if (name === 'list') {
    await handleSandboxList()
    return
  }

  // If no name provided, use current directory (original behavior)
  const useCurrentDir = !name || name.startsWith('-')

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    🐳 Loop Sandbox                         ║')
  console.log('║                   Fresh Build Mode                         ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Determine workspace directory
  let workspaceDir: string
  let containerName: string

  if (useCurrentDir) {
    // No name provided - use current directory (original behavior)
    workspaceDir = process.cwd()
    containerName = 'loop-default'
    console.log('📁 Using current directory as workspace')
  } else {
    // Name provided - create/use proj/<name>/ folder
    workspaceDir = createProjectFolder(name)
    containerName = `loop-${name}`
  }

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
  console.log(`📁 Workspace: ${workspaceDir}`)
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

  // Find Dockerfile - use getBinaryPath for compiled binaries
  const currentBinary = getBinaryPath()
  const possibleDockerfiles = [
    join(process.cwd(), 'Dockerfile'),
    join(dirname(currentBinary || ''), 'Dockerfile'),
    join(dirname(currentBinary || ''), '..', 'Dockerfile'),
    '/usr/local/share/loop/Dockerfile',
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
    console.error('   Searched in:')
    possibleDockerfiles.forEach((p) => console.error(`     - ${p}`))
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

  // Get the proj directory for mounting all projects
  const projDir = join(process.cwd(), 'proj')

  const dockerRunArgs = [
    'run',
    '-d',
    '--name',
    containerName,
    '-v',
    `${workspaceDir}:/workspace`,
  ]

  // Mount all projects as /projects if proj/ exists
  if (existsSync(projDir)) {
    dockerRunArgs.push('-v', `${projDir}:/projects`)
  }

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
  const hashName = useCurrentDir ? 'default' : name
  const hash = hashName.split('').reduce((a, b) => {
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
    console.log(`📝 Task: ${description}`)
    console.log('')

    // Create a simple PRD with the exact text as a single item (no AI generation)
    const prd: PrdJson = {
      name: 'Task',
      items: [
        {
          id: '1',
          category: 'general',
          description: description,
          steps: [],
          priority: 'high',
          passes: false,
          status: 'pending',
        },
      ],
    }

    // Save the PRD to do.md
    savePrd('do.md', prd)
    console.log('✅ Created do.md with task')
    console.log('')

    // Calculate iterations: 1 task + 2 buffer, or use --max if provided
    const iterations = maxIterations || 3

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
    // Check for subcommands
    if (rawArgs[1] === 'list') {
      await handleSandboxList()
      return
    }
    if (rawArgs[1] === 'stop') {
      if (rawArgs[2] === 'all') {
        await handleSandboxStopAll()
        return
      }
      if (!rawArgs[2] || rawArgs[2].startsWith('-')) {
        console.error('Error: Please provide a sandbox name')
        console.error('Usage: loop sandbox stop <name>')
        console.error('       loop sandbox stop all')
        process.exit(1)
      }
      await handleSandboxStop(rawArgs[2])
      return
    }
    if (rawArgs[1] === 'remove' || rawArgs[1] === 'rm') {
      if (rawArgs[2] === 'all') {
        await handleSandboxRemoveAll()
        return
      }
      if (!rawArgs[2] || rawArgs[2].startsWith('-')) {
        console.error('Error: Please provide a sandbox name')
        console.error('Usage: loop sandbox remove <name>')
        console.error('       loop sandbox remove all')
        process.exit(1)
      }
      await handleSandboxRemove(rawArgs[2])
      return
    }
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

  // Auto-disable sandbox when running inside Docker
  if (args.sandbox && isInsideDocker()) {
    args.sandbox = false
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
