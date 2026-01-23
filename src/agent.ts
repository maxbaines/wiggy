/**
 * Claude Agent SDK integration for Ralph
 * Uses the official Claude Agent SDK for autonomous coding
 */

import {
  query,
  type SDKResultMessage,
  type SDKAssistantMessage,
  type Options,
  type HookInput,
  type HookJSONOutput,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'fs'
import type { RalphConfig } from './types.ts'
import { COMPLETION_MARKER } from './types.ts'
import { formatToolCall, formatFileChange, formatInfo } from './output.ts'

/**
 * Find the Claude Code CLI executable path
 * Checks common installation locations
 */
function findClaudeCodePath(): string | undefined {
  const possiblePaths = [
    '/usr/local/bin/claude',
    '/root/.claude/local/bin/claude',
    `${process.env.HOME}/.claude/local/bin/claude`,
    '/opt/homebrew/bin/claude',
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return undefined
}

/**
 * Parse structured output from agent response
 * Extracts task description, decisions, and summary from the formatted output
 */
function parseStructuredOutput(output: string): {
  taskDescription: string
  decisions: string[]
  summary: string
} {
  const result = {
    taskDescription: '',
    decisions: [] as string[],
    summary: '',
  }

  // Extract "## Completed:" task description (most reliable)
  const completedMatch = output.match(/##\s*Completed:\s*(.+?)(?:\n|$)/i)
  if (completedMatch) {
    result.taskDescription = completedMatch[1].trim()
  }

  // Extract "## Changes Made" section for summary
  const changesMadeMatch = output.match(
    /##\s*Changes Made\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/i,
  )
  if (changesMadeMatch) {
    result.summary = changesMadeMatch[1].trim()
  }

  // Extract "## Decisions" section
  const decisionsMatch = output.match(
    /##\s*Decisions\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*Completed|$)/i,
  )
  if (decisionsMatch) {
    const decisionsBlock = decisionsMatch[1]
    // Parse bullet points (- item)
    const bulletPoints = decisionsBlock.match(/^[-*]\s+(.+)$/gm)
    if (bulletPoints) {
      result.decisions = bulletPoints
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .filter((d) => d && d.toLowerCase() !== 'none')
    }
  }

  return result
}

/**
 * Create the Ralph system prompt
 */
export function createSystemPrompt(
  prdSummary: string,
  progressSummary: string,
  agentsMd?: string,
): string {
  // Extract back pressure section from AGENTS.md if present
  let backPressureInstructions = ''
  if (agentsMd) {
    const backPressureMatch = agentsMd.match(
      /##\s*Back\s*pressure[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
    )
    if (backPressureMatch) {
      backPressureInstructions = `
### Back Pressure Commands (from AGENTS.md)
Run these checks before committing:
${backPressureMatch[1].trim()}

Use the Bash tool to run these checks.
`
    }
  }

  return `You are Ralph, an autonomous AI coding agent working through a task list.

## Your Process

1. **Analyze the PRD/task list** to understand what needs to be done.
2. **Check progress** to see what has already been completed.
3. **If there are failing back pressure checks from the last iteration, FIX THEM FIRST.**
4. **Choose the highest-priority task** - prioritize in this order:
   - Architectural decisions and core abstractions
   - Integration points between modules
   - Unknown unknowns and spike work
   - Standard features and implementation
   - Polish, cleanup, and quick wins
5. **Implement the chosen task** with small, focused changes.
6. **Run ALL back pressure checks** before committing using Bash tool.
7. **Make a git commit** using Bash: \`git add -A && git commit -m "message"\`

## Available Tools

You have access to powerful built-in tools:

### File Tools
- **Read** - Read any file in the working directory (supports offset/limit for large files)
- **Write** - Create new files
- **Edit** - Make precise edits to existing files (search/replace)
- **Glob** - Find files by pattern (\`**/*.ts\`, \`src/**/*.py\`)
- **Grep** - Search file contents with regex and context lines

### Shell Tools
- **Bash** - Run terminal commands, scripts, git operations

### Web Tools
- **WebSearch** - Search the web for current information
- **WebFetch** - Fetch and parse web page content

### Interactive Tools
- **AskUserQuestion** - Ask the user clarifying questions with multiple choice options

## Rules

- ONLY WORK ON A SINGLE TASK per iteration.
- Keep changes small and focused - one logical change per commit.
- Quality over speed - leave the codebase better than you found it.
- If a task feels too large, break it into subtasks.
- Run back pressure checks after each change, not at the end.
- **NEVER commit with failing checks** - this is the most important rule.

## Current State

### PRD Status
${prdSummary}

### Progress
${progressSummary}
${backPressureInstructions}
${agentsMd ? `### Project Guidelines (AGENTS.md)\n${agentsMd}` : ''}

## Completion

When you have completed a task:
1. Run all back pressure checks using Bash
2. Make a git commit: \`git add -A && git commit -m "descriptive message"\`
3. Report what you did using this EXACT format:

## Changes Made
[Brief summary of what was changed and why - 2-3 sentences]

## Decisions
- [Decision 1: why you chose this approach over alternatives]
- [Decision 2: any tradeoffs or considerations]
- [Add more as needed, or "None" if straightforward]

## Completed: [exact task description from PRD]

This structured format allows Ralph to track progress and decisions between iterations.

If ALL tasks in the PRD are complete, output exactly: ${COMPLETION_MARKER}

This signals that the entire PRD has been implemented and Ralph should stop.
`
}

/**
 * Create hook callbacks for tool execution monitoring
 */
function createHooks(verbose: boolean) {
  return {
    PreToolUse: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<HookJSONOutput> => {
            if (verbose && input.hook_event_name === 'PreToolUse') {
              const preToolInput = input as PreToolUseHookInput
              console.log(formatInfo(`🔧 Running: ${preToolInput.tool_name}`))
            }
            return { continue: true }
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (
            input: HookInput,
            _toolUseID: string | undefined,
            _options: { signal: AbortSignal },
          ): Promise<HookJSONOutput> => {
            if (verbose && input.hook_event_name === 'PostToolUse') {
              const postToolInput = input as PostToolUseHookInput
              console.log(
                formatInfo(`✅ Completed: ${postToolInput.tool_name}`),
              )
            }
            return { continue: true }
          },
        ],
      },
    ],
  }
}

/**
 * Run a single Ralph iteration using the Claude Agent SDK
 */
export async function runIteration(
  config: RalphConfig,
  systemPrompt: string,
  verbose: boolean = false,
): Promise<{
  success: boolean
  isComplete: boolean
  taskDescription?: string
  decisions?: string[]
  summary?: string
  filesChanged?: string[]
  error?: string
  output?: string
}> {
  let fullOutput = ''
  let taskDescription = ''
  let decisions: string[] = []
  let summary = ''
  const filesChanged: string[] = []
  let isComplete = false

  try {
    // Find Claude Code CLI path
    const claudeCodePath = findClaudeCodePath()
    if (!claudeCodePath) {
      return {
        success: false,
        isComplete: false,
        error:
          'Claude Code CLI not found. Install it with: curl -fsSL https://claude.ai/install.sh | bash',
        output: '',
      }
    }

    // Configure the agent query options
    const options: Options = {
      cwd: config.workingDir,
      model: config.model,
      maxTurns: 50, // Allow up to 50 tool calls per iteration
      // Path to Claude Code CLI executable (auto-detected)
      pathToClaudeCodeExecutable: claudeCodePath,
      // Use Claude Code's default tools plus web and interactive tools
      tools: [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'AskUserQuestion',
      ],
      // Use custom system prompt with append
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemPrompt,
      },
      // Auto-allow safe read-only tools for autonomous operation
      allowedTools: ['Read', 'Glob', 'Grep'],
      // Permission mode for autonomous operation
      permissionMode: 'acceptEdits',
      // Add hooks for tool execution monitoring
      hooks: createHooks(verbose),
    }

    const prompt =
      'Analyze the PRD and progress, then implement the highest-priority incomplete task. Remember to run feedback loops and commit your changes.'

    // Run the agent query
    for await (const message of query({ prompt, options })) {
      // Handle different message types
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage
        // Extract text from the message
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            fullOutput += block.text + '\n'
            if (verbose) {
              console.log(block.text)
            }

            // Check for completion marker
            if (block.text.includes(COMPLETION_MARKER)) {
              isComplete = true
            }
          }

          // Track tool uses for verbose output
          if (block.type === 'tool_use' && verbose) {
            console.log(
              formatToolCall(
                block.name,
                block.input as Record<string, unknown>,
              ),
            )

            // Track file changes
            if (block.name === 'Write' || block.name === 'Edit') {
              const input = block.input as { file_path?: string }
              if (input.file_path) {
                filesChanged.push(input.file_path)
                console.log(formatFileChange(input.file_path, 'modify'))
              }
            }
          }
        }
      }

      // Handle result message
      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage
        if (resultMsg.subtype === 'success') {
          if (verbose) {
            console.log(formatInfo(`Completed in ${resultMsg.num_turns} turns`))
            console.log(
              formatInfo(`Cost: $${resultMsg.total_cost_usd.toFixed(4)}`),
            )
          }
        } else {
          // Error result
          if ('errors' in resultMsg && resultMsg.errors.length > 0) {
            return {
              success: false,
              isComplete: false,
              error: resultMsg.errors.join(', '),
              output: fullOutput,
            }
          }
        }
      }

      // Handle tool progress for verbose output
      if (message.type === 'tool_progress' && verbose) {
        console.log(
          formatInfo(
            `Tool ${message.tool_name} running... (${message.elapsed_time_seconds}s)`,
          ),
        )
      }
    }

    // Parse structured output from fullOutput
    const parsed = parseStructuredOutput(fullOutput)
    if (parsed.taskDescription) {
      taskDescription = parsed.taskDescription
    }
    if (parsed.decisions.length > 0) {
      decisions = parsed.decisions
    }
    if (parsed.summary) {
      summary = parsed.summary
    }

    return {
      success: true,
      isComplete,
      taskDescription: taskDescription || 'Task completed',
      decisions,
      summary,
      filesChanged,
      output: fullOutput,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      isComplete: false,
      error: errorMessage,
      output: fullOutput,
    }
  }
}
