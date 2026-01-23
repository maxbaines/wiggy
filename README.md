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
# Run with default settings (5 iterations)
bun run dev

# Run with specific number of iterations
bun run dev -- --iterations 10

# Run in HITL (human-in-the-loop) mode
bun run dev -- --hitl

# Run with verbose output
bun run dev -- --verbose
```

## Configuration

Create a `.env` file or set environment variables:

```bash
ANTHROPIC_API_KEY=your-api-key
CLAUDE_MODEL=claude-sonnet-4-20250514  # Optional, defaults to sonnet
```

## PRD Format

Create a `PRD.md` file in your project root:

```markdown
# Project Name

## Tasks

- [ ] Task 1 description
- [ ] Task 2 description
- [x] Completed task (will be skipped)
```

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
- **System Prompt**: Custom prompt appended to Claude Code's default
- **Permission Mode**: `acceptEdits` for autonomous file operations
- **Hooks**: PreToolUse and PostToolUse for monitoring tool execution
- **Allowed Tools**: Auto-allow safe read-only tools (Read, Glob, Grep)

## License

MIT
