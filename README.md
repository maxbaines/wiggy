# Loop (Ralph Wiggum)

Autonomous AI coding loop using the Claude Agent SDK.

## Overview

Loop is an autonomous coding agent that works through a PRD (Product Requirements Document) task by task, making commits along the way. It uses the official [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) for powerful file editing, command execution, and code search capabilities.

## Features

- **Autonomous Operation**: Works through tasks without human intervention
- **PRD-Driven**: Follows a structured task list from a PRD file
- **Back Pressure Checks**: Runs typecheck, lint, and tests before committing
- **Git Integration**: Automatically commits changes with descriptive messages
- **Progress Tracking**: Tracks completed tasks and decisions
- **HITL Mode**: Human-in-the-loop mode for supervised operation
- **Web Access**: Search the web and fetch content for research
- **Interactive Prompts**: Ask clarifying questions when needed
- **Tool Hooks**: Pre/post tool execution monitoring

## Built-in Tools (via Claude Agent SDK)

The agent has access to powerful built-in tools:

### File Tools

| Tool      | Description                                           |
| --------- | ----------------------------------------------------- |
| **Read**  | Read any file (supports offset/limit for large files) |
| **Write** | Create new files                                      |
| **Edit**  | Make precise edits to existing files (search/replace) |
| **Glob**  | Find files by pattern (`**/*.ts`, `src/**/*.py`)      |
| **Grep**  | Search file contents with regex and context lines     |

### Shell Tools

| Tool     | Description                                    |
| -------- | ---------------------------------------------- |
| **Bash** | Run terminal commands, scripts, git operations |

### Web Tools

| Tool          | Description                            |
| ------------- | -------------------------------------- |
| **WebSearch** | Search the web for current information |
| **WebFetch**  | Fetch and parse web page content       |

### Interactive Tools

| Tool                | Description                                   |
| ------------------- | --------------------------------------------- |
| **AskUserQuestion** | Ask clarifying questions with multiple choice |

## Prerequisites

- **Bun** (or Node.js 18+)
- **Claude Code CLI** - Required by the Agent SDK

### Install Claude Code CLI

```bash
# macOS/Linux/WSL
curl -fsSL https://claude.ai/install.sh | bash

# Then authenticate
claude
```

## Installation

```bash
# Install dependencies
bun install

# Set your API key
export ANTHROPIC_API_KEY=your-api-key
```

## Usage

```bash
# Run 5 iterations (runs in Docker sandbox by default)
loop 5

# Run locally without sandbox
loop 5 --no-sandbox

# Run in HITL (human-in-the-loop) mode
loop 10 --hitl

# Generate a PRD from description
loop init "Build a REST API for user authentication"

# One-off task: generate PRD and run to completion
loop do "Fix build errors and add tests"

# Launch interactive Docker sandbox
loop sandbox myproject

# List all sandboxes
loop sandbox list
```

### Sandbox Mode (Default)

By default, Loop runs inside a Docker sandbox for safety. The sandbox:

- Isolates file system changes
- Provides a web terminal at `http://localhost:<port>`
- Persists project files in `proj/<name>/`

Use `--no-sandbox` to run directly on your machine.

## Configuration

Create a `.env` file or set environment variables:

```bash
ANTHROPIC_API_KEY=your-api-key
CLAUDE_MODEL=claude-sonnet-4-20250514  # Optional, defaults to sonnet
```

## PRD Format

Create a `PRD.md` file in your project root. The key to success: **Each feature needs clear, testable acceptance criteria.** This is what tells Ralph when a task is truly "done."

```markdown
# Project Name

## High Priority

### Feature: User Authentication

#### Requirements

- OAuth login with Google
- Session management
- Logout functionality

#### Acceptance Criteria

- [ ] User can log in with Google
- [ ] Session persists across page reloads
- [ ] User can log out
- [ ] Tests pass

**Output when complete:** `<promise>DONE</promise>`

## Medium Priority

### Feature: Dashboard

#### Requirements

- Display user stats
- Show recent activity

#### Acceptance Criteria

- [ ] Dashboard loads within 2 seconds
- [ ] Stats are accurate
- [ ] Tests pass

**Output when complete:** `<promise>DONE</promise>`
```

### Good vs Bad Acceptance Criteria

**Good criteria:** "User can log in with Google and session persists across page reloads"
**Bad criteria:** "Auth works correctly"

The more specific your acceptance criteria, the better Ralph performs.

## AGENTS.md

Create an `AGENTS.md` file to configure back pressure checks:

```markdown
# Agent Configuration

## Back pressure

- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun test`
```

## Architecture

```
src/
├── agent.ts        # Claude Agent SDK integration with hooks
├── backpressure.ts # Back pressure check runner
├── config.ts       # Configuration loading
├── index.ts        # CLI entry point
├── output.ts       # Terminal output formatting
├── prd.ts          # PRD parsing and management
├── progress.ts     # Progress tracking
├── ralph.ts        # Main loop orchestration
├── types.ts        # TypeScript type definitions
└── tools/
    ├── git.ts      # Git operations (utility functions)
    └── index.ts    # Tool exports
```

## SDK Features Used

- **Built-in Tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion
- **Skills**: Specialized capabilities Claude invokes autonomously (see below)
- **System Prompt**: Custom prompt appended to Claude Code's default
- **Permission Mode**: `acceptEdits` for autonomous file operations
- **Hooks**: PreToolUse and PostToolUse for monitoring tool execution
- **Allowed Tools**: Auto-allow safe read-only tools (Read, Glob, Grep, Skill)

## Skills

Skills extend Claude with specialized capabilities that are automatically invoked when relevant. Loop loads Skills from:

1. **Project Skills** (`.claude/skills/`): Shared with your team via git
2. **User Skills** (`~/.claude/skills/`): Personal Skills across all projects

### Built-in Skills

| Skill           | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| **code-review** | Thorough code review with security, quality, and design checks |

### Creating Custom Skills

Create a `SKILL.md` file in `.claude/skills/<skill-name>/`:

```markdown
---
description: 'Invoke when [specific trigger description]'
---

# Skill Name

## Instructions

[Detailed instructions for Claude to follow]
```

The `description` field determines when Claude invokes your Skill. Be specific about trigger conditions.

### Example: Custom Deployment Skill

```
.claude/skills/deploy/SKILL.md
```

```markdown
---
description: 'Invoke when deploying to production, staging, or when asked about deployment procedures'
---

# Deployment Skill

## Pre-deployment Checklist

- [ ] All tests pass
- [ ] Version bumped
- [ ] Changelog updated

## Deployment Steps

1. Build the project
2. Run smoke tests
3. Deploy to staging first
4. Verify staging
5. Deploy to production
```

For more details, see the [Claude Agent SDK Skills documentation](https://platform.claude.com/docs/en/agent-sdk/skills).

## License

MIT
