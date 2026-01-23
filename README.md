# Loop (A version of Ralph Wiggum by Geoffrey Huntley)

> "Me fail English? That's unpossible!" - Ralph Wiggum

**Loop** is an autonomous AI coding loop built with TypeScript and Bun, using the Claude Agent SDK directly. It compiles to a single executable for Mac, Windows, and Linux.

Named after Ralph Wiggum - because like Ralph, it just keeps going until the job is done.

## How Loop Works

Loop operates as an **autonomous coding agent** that iteratively works through tasks defined in a PRD (Product Requirements Document).

### The Loop Cycle

Each iteration follows this pattern:

1. **Read PRD** - Loop reads your `prd.md` file to understand what needs to be built
2. **Check Progress** - Reviews recent git commits (or `progress.txt` in file mode) to see what's already been completed
3. **Pick a Task** - Selects the next uncompleted task from the PRD
4. **Execute** - Uses available tools (file operations, terminal commands, git) to implement the task
5. **Run Checks** - Executes back pressure checks from `AGENTS.md` (typecheck, lint, test, build)
6. **Commit** - If checks pass, commits the changes with a descriptive message
7. **Update Progress** - Marks the task as complete and logs what was done
8. **Repeat** - Moves to the next task until all iterations are complete or PRD is finished

### Example Workflow

```bash
# Step 1: Generate a PRD from your idea
loop init "Build a CLI todo app with add, list, complete commands"
# Creates: prd.md with structured tasks, AGENTS.md with project checks

# Step 2: Run Loop to implement the PRD
loop 5 --hitl
# Loop will:
#   - Read prd.md and find the first uncompleted task
#   - Implement it (create files, write code, run commands)
#   - Run typecheck/lint/test to verify the code works
#   - Commit the changes
#   - Move to the next task
#   - Pause for your review (--hitl = human-in-the-loop)
#   - Repeat for up to 5 iterations

# Or use 'do' for one-off tasks (generates PRD and runs it immediately)
loop do "Fix current build errors and package as an app"
# Loop will:
#   - Analyze the codebase for context
#   - Generate a PRD with tasks to accomplish the goal
#   - Immediately start executing the tasks
#   - Run until complete or max iterations reached
```

### Key Concepts

| Concept           | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| **Iteration**     | One complete cycle of: pick task → implement → check → commit           |
| **PRD**           | The task list that defines what Loop should build                       |
| **Progress**      | Tracks completed tasks via git commits (default) or progress.txt file   |
| **Back Pressure** | Quality checks (typecheck, lint, test) that must pass before committing |
| **HITL Mode**     | Human-in-the-loop - pauses between iterations for manual review         |

## Quick Start

```bash
# Download the binary for your platform from releases, or build from source

# Install globally (optional but recommended)
./loop global

# Create a new project
loop new myproject
cd proj/myproject

# One-off task - generate PRD and run immediately
loop do "Fix build errors and package as an app"

# Or the two-step approach:
# Generate a PRD from a description
loop init "Build a CLI todo app with add, list, complete commands"

# Run iterations to implement the PRD
loop 5 --hitl

# Run in a Docker sandbox for isolation
loop sandbox myproject
```

## Installation

### Global Installation

Install Loop globally so you can run it from anywhere:

```bash
# From the directory containing the loop binary
./loop global
```

This copies:

- Binary to `/usr/local/bin/loop`
- Docker scripts to `/usr/local/share/loop/docker/`

After installation, you can run `loop` from any directory.

### Project Setup

Create a new self-contained project with all needed files:

```bash
loop new myproject
```

This creates `proj/myproject/` with:

- `loop` - The loop binary
- `.env` - Configuration (copy your API key)
- `.gitignore` - Standard ignores
- `Dockerfile` - For sandbox support
- `docker/` - Docker helper scripts

## Docker Sandbox

Run Loop in an isolated Docker container for safety:

```bash
# With a name - creates isolated project folder
loop sandbox myproject

# Without a name - uses current directory
loop sandbox
```

### Sandbox Modes

**Named sandbox** (`loop sandbox myproject`):

- Creates `proj/myproject/` folder with all needed files
- Mounts that folder as `/workspace` in the container
- Each named sandbox is completely isolated from others

**Default sandbox** (`loop sandbox`):

- Uses current directory as workspace
- Good for quick testing in existing projects

### What the Sandbox Provides

**🔒 Protected (host is safe from):**

- **System files** - Cannot modify `/etc`, `/usr`, `/bin`, etc. on host
- **Other directories** - Can only access `/workspace` (your mounted project folder)
- **Network isolation** - Runs in its own network namespace
- **Process isolation** - Container processes are isolated from host
- **Package installation** - `apt install`, etc. only affects the container
- **Dangerous commands** - `rm -rf /` only destroys the container, not your host

**⚠️ Shared (can affect host):**

- **Mounted workspace** - Files in the project folder are mounted to `/workspace`
- **Exposed ports** - The web terminal port (7681+offset)

### Sandbox Workflow

```bash
# Launch a named sandbox (creates proj/hello-world/ automatically)
loop sandbox hello-world

# Inside the sandbox:
root@container:/workspace# loop init "Build a hello world app"
root@container:/workspace# loop 5

# Exit sandbox (container keeps running)
root@container:/workspace# exit

# Stop the container when done
docker stop loop-hello-world

# Launch another isolated sandbox
loop sandbox another-project
# This creates proj/another-project/ - completely separate from hello-world
```

### Why Use the Sandbox?

The sandbox is ideal for running an autonomous AI coding agent because:

- ✅ The agent can read/write/delete files in your project
- ✅ The agent can install packages inside the container
- ✅ The agent can run any commands inside the container
- ❌ The agent cannot access files outside the mounted folder
- ❌ The agent cannot install packages on your host OS
- ❌ The agent cannot crash or damage your host system

The worst the agent can do is mess up your project files, which you can recover with git.

## Usage

```bash
# One-off task (generates PRD and runs to completion)
./loop do "Add user authentication"
./loop do "Refactor database layer" --hitl
./loop do "Fix all TypeScript errors" --max 10

# Run with iterations (requires existing PRD)
./loop 5

# HITL mode (pause between iterations for human review)
./loop 10 --hitl

# Custom config file
./loop 5 --config my.config.json

# Show help
./loop --help

# Show version
./loop --version
```

## Configuration

Loop looks for configuration in this order:

1. **Environment variables** (highest priority)
2. **Config file** (`ralph.config.json`)
3. **.env file**

### Required

```bash
ANTHROPIC_API_KEY=your-api-key-here
```

### Optional

```bash
RALPH_MODEL=claude-sonnet-4-20250514
RALPH_MAX_TOKENS=8192
RALPH_WORKING_DIR=.
RALPH_PRD_FILE=plans/prd.json
RALPH_PROGRESS_FILE=progress.txt
RALPH_PROGRESS_MODE=git    # "git" (default) or "file"
RALPH_VERBOSE=false
```

### Config File

Create `ralph.config.json`:

```json
{
  "apiKey": "your-api-key",
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 8192,
  "workingDir": ".",
  "progressFile": "progress.txt",
  "progressMode": "git",
  "verbose": false
}
```

### Progress Tracking Modes

Loop supports two modes for tracking progress between iterations:

| Mode   | Description                                                                |
| ------ | -------------------------------------------------------------------------- |
| `git`  | **(Default)** Uses last 10 git commit messages as context. No extra files. |
| `file` | Uses `progress.txt` file to track iterations (legacy behavior).            |

**Git mode** is recommended because:

- No extra files to manage
- Uses actual commit history as source of truth
- Works naturally with git-based workflows

## PRD Generator

Loop can generate structured PRDs from natural language descriptions using Claude:

```bash
# Basic PRD generation
loop init "Build a REST API for user authentication"

# Analyze existing codebase for context
loop init "Add tests for all endpoints" --analyze

# Output as Markdown
loop init "Create a dashboard UI" --markdown

# Custom output file
loop init "Refactor database layer" --output plans/db-refactor.json
```

The generator follows Matt Pocock's Loop Wiggum methodology:

- **Prioritizes by type**: Architecture first, polish last
- **Atomic tasks**: Each task completable in one iteration
- **Acceptance criteria**: Specific, verifiable steps
- **Explicit scope**: No room for shortcuts

## AGENTS.md & Back Pressure

Loop follows the [AGENTS.md standard](https://agents.md) for AI agent configuration. When you run `loop init`, it automatically generates an `AGENTS.md` file for your project.

### Back Pressure System (WIP)

Loop reads your `AGENTS.md` file to determine which checks to run before committing changes:

```markdown
## Back pressure

- Build: `swift build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun test`
```

These checks are automatically run to ensure code quality. If no `AGENTS.md` is found, Loop falls back to auto-detecting common check commands (typecheck, lint, test).

## PRD Files

Loop PRD Markdown format:

```markdown
## Tasks

### High Priority

- [ ] **Set up database schema**
  - Create migrations
  - Add indexes
```

## Tools Available

Loop has access to these tools:

| Tool              | Description                            |
| ----------------- | -------------------------------------- |
| `read_file`       | Read file contents                     |
| `write_file`      | Write/create files                     |
| `list_files`      | List directory contents                |
| `search_files`    | Search for patterns in files           |
| `execute_command` | Run shell commands                     |
| `run_tests`       | Run test suite                         |
| `run_typecheck`   | Run type checking                      |
| `run_lint`        | Run linter                             |
| `run_checks`      | Run all AGENTS.md back pressure checks |
| `git_status`      | Get git status                         |
| `git_commit`      | Stage and commit changes               |
| `git_diff`        | Get diff of changes                    |
| `git_log`         | Get recent commits                     |

## Features

- **Single executable** - Bun compiles to native binaries
- **Cross-platform** - Mac, Windows, Linux from one codebase
- **No Claude Code dependency** - Direct API access via Claude Agent SDK
- **Full tool support** - File operations, terminal commands, git
- **AGENTS.md support** - Follows the open standard for AI agent configuration
- **Back pressure** - Automatic quality checks before commits
- **PRD support** - JSON and Markdown formats
- **Progress tracking** - Maintains state between iterations

## Building from Source

```bash
# Install dependencies
bun install

# Build for current platform
bun run build

# Build for all platforms
bun run build:all

# Individual platforms
bun run build:mac      # macOS ARM64
bun run build:mac-x64  # macOS x64
bun run build:linux    # Linux x64
bun run build:windows  # Windows x64
```

Executables are output to `dist/`.

## Development

```bash
# Run in development
bun run dev

# Type check
bun run typecheck

# Run tests
bun test
```

## Project Structure

```
loop/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── ralph.ts          # Main loop logic
│   ├── agent.ts          # Claude Agent SDK wrapper
│   ├── backpressure.ts   # AGENTS.md back pressure system
│   ├── config.ts         # Configuration loading
│   ├── generate.ts       # PRD generator (AI-powered)
│   ├── output.ts         # Centralized output formatting
│   ├── prd.ts            # PRD file parsing
│   ├── progress.ts       # Progress tracking
│   ├── types.ts          # TypeScript types
│   └── tools/
│       ├── index.ts      # Tool registry
│       ├── filesystem.ts # File operations
│       ├── terminal.ts   # Command execution
│       └── git.ts        # Git operations
├── example/              # Example project
├── package.json
├── tsconfig.json
└── .env.example
```

## License

MIT
