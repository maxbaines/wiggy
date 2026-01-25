/**
 * Claude Agent SDK integration for Ralph
 * Uses the official Claude Agent SDK for autonomous coding
 */

import {
  query,
  type SDKResultMessage,
  type SDKAssistantMessage,
  type Options,
} from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'fs'
import type { RalphConfig, PrdItem, TaskSelectionResult } from './types.ts'
import { COMPLETION_MARKER } from './types.ts'
import {
  formatToolCall,
  formatFileChange,
  formatInfo,
  formatThought,
  formatWarning,
} from './output.ts'
import {
  getKeyboardListener,
  formatInterventionMessage,
  type InterventionResult,
} from './keyboard.ts'
import { getCompleteTaskToolDescription } from './tools/index.ts'

/**
 * Find the Claude Code CLI executable path
 * Checks common installation locations and environment variable
 */
function findClaudeCodePath(): string | undefined {
  const possiblePaths = [
    // Check environment variable first (allows custom path)
    process.env.CLAUDE_CODE_PATH,
    // Ubuntu/Linux default install location (most common)
    `${process.env.HOME}/.local/bin/claude`,
    '/root/.local/bin/claude', // Docker root user
    // Other common locations
    '/usr/local/bin/claude',
    `${process.env.HOME}/.claude/local/bin/claude`,
    '/root/.claude/local/bin/claude',
    '/opt/homebrew/bin/claude', // macOS Homebrew
  ].filter(Boolean) as string[] // Remove undefined entries

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
 * Parse task selection from agent response
 * Supports multiple formats for robustness
 */
function parseTaskSelection(output: string): TaskSelectionResult | null {
  // Try format 1: SELECTED_TASK: <id>
  let taskIdMatch = output.match(/SELECTED_TASK:\s*(\d+)/i)
  let taskDescMatch = output.match(/TASK_DESCRIPTION:\s*(.+?)(?:\n|$)/i)
  let reasoningMatch = output.match(
    /REASONING:\s*([\s\S]*?)(?=\n(?:SELECTED_TASK|TASK_DESCRIPTION)|$)/i,
  )

  if (taskIdMatch) {
    return {
      taskId: taskIdMatch[1],
      taskDescription: taskDescMatch?.[1]?.trim() || '',
      reasoning: reasoningMatch?.[1]?.trim() || '',
    }
  }

  // Try format 2: "Task #N" or "Task N:"
  taskIdMatch = output.match(/Task\s*#?(\d+)/i)
  if (taskIdMatch) {
    // Try to extract description after the task number
    const afterTaskMatch = output.match(/Task\s*#?\d+[:\s]+(.+?)(?:\n|$)/i)
    return {
      taskId: taskIdMatch[1],
      taskDescription: afterTaskMatch?.[1]?.trim() || '',
      reasoning: '',
    }
  }

  return null
}

/**
 * Create system prompt for task selection (Phase 1)
 * Simple text-only analysis - NO TOOLS, just pick from the PRD list
 */
export function createTaskSelectionPrompt(prdSummary: string): string {
  return `You are a task selector. Pick the next task from the PRD list below.

## THE PRD IS KING

The PRD shows all tasks with their status:
- [ ] = incomplete task (needs to be done)
- [DONE] = completed task (skip these)

## PRD Status
${prdSummary}

## Selection Rules

1. Pick the FIRST incomplete [ ] task from the HIGH priority section
2. If no high priority tasks remain, pick from MEDIUM priority
3. If no medium priority tasks remain, pick from LOW priority
4. NEVER pick a [DONE] task

## Output Format

Respond with ONLY this format (no explanation needed):

SELECTED_TASK: [task ID number]
TASK_DESCRIPTION: [exact task description]

Example:
SELECTED_TASK: 2
TASK_DESCRIPTION: Add user authentication
`
}

/**
 * Select the next task to work on (Phase 1)
 * Simple text-only selection - no tools, just analyze the PRD
 */
export async function selectNextTask(
  config: RalphConfig,
  prdSummary: string,
  _progressSummary: string,
  _agentsMd?: string,
  verbose: boolean = false,
): Promise<TaskSelectionResult | null> {
  try {
    const claudeCodePath = findClaudeCodePath()
    if (!claudeCodePath) {
      console.error('Claude Code CLI not found')
      return null
    }

    const systemPrompt = createTaskSelectionPrompt(prdSummary)

    const options: Options = {
      cwd: config.workingDir,
      model: config.model,
      maxTurns: 1, // Single turn - just pick a task, no exploration
      pathToClaudeCodeExecutable: claudeCodePath,
      // NO TOOLS - text only
      tools: [],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemPrompt,
      },
      allowedTools: [],
      permissionMode: 'default',
      hooks: createHooks(verbose),
    }

    const prompt =
      'Select the next task from the PRD. Output SELECTED_TASK and TASK_DESCRIPTION only.'

    let fullOutput = ''

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            fullOutput += block.text + '\n'
            if (verbose) {
              console.log(
                formatInfo(`Task selector: ${block.text.substring(0, 100)}...`),
              )
            }
          }
        }
      }

      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage
        if (verbose && resultMsg.subtype === 'success') {
          console.log(formatInfo(`Task selection completed`))
        }
      }
    }

    return parseTaskSelection(fullOutput)
  } catch (error) {
    console.error(
      'Error selecting task:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Create system prompt for task implementation (Phase 2)
 * Only sees the selected task, not the full PRD
 */
export function createTaskImplementationPrompt(
  task: PrdItem,
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

  const taskSteps =
    task.steps.length > 0
      ? `\n\nSteps:\n${task.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : ''

  return `You are Ralph, an autonomous AI coding agent. You have ONE task to complete.

## YOUR TASK

**${task.description}**${taskSteps}

Priority: ${task.priority}

## Your Process

1. **Implement the task** with small, focused changes
2. **Run ALL back pressure checks** before committing
3. **Make a git commit** with a detailed message

## Available Tools

### File Tools
- **Read** - Read any file in the working directory
- **Write** - Create new files
- **Edit** - Make precise edits to existing files
- **Glob** - Find files by pattern
- **Grep** - Search file contents

### Shell Tools
- **Bash** - Run terminal commands, scripts, git operations

### Web Tools
- **WebSearch** - Search the web for information
- **WebFetch** - Fetch web page content

## Rules

- Focus ONLY on the task above - do not work on anything else
- Keep changes small and focused
- Run back pressure checks after changes
- **NEVER commit with failing checks**

## Progress Context
${progressSummary}
${backPressureInstructions}
${agentsMd ? `### Project Guidelines (AGENTS.md)\n${agentsMd}` : ''}

${getCompleteTaskToolDescription()}

## Completion

When you have finished implementing the task and all back pressure checks pass:

1. **Use the CompleteTask tool** to commit, update progress, and mark the PRD task as done
2. The tool will handle git commit, progress.txt update, and PRD marking atomically

Example CompleteTask call:
\`\`\`json
{
  "taskDescription": "${task.description}",
  "commitMessage": "feat: ${task.description}\\n\\nWHAT: Describe changes\\nWHY: Reasoning\\nNEXT: Follow-up",
  "filesChanged": ["file1.ts"],
  "decisions": ["Decision 1"],
  "summary": "Brief summary"
}
\`\`\`

After calling CompleteTask, report:

## Completed: ${task.description}
`
}

/**
 * Create the Ralph system prompt (legacy - full PRD visibility)
 * @deprecated Use createTaskImplementationPrompt for focused task execution
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

## CRITICAL: Git Commit = Next Iteration's Context

Your git commit message is THE PRIMARY WAY progress is tracked between iterations.
The next iteration will see your commit messages to understand what was done.

**Write detailed, multi-line commit messages:**

\`\`\`bash
git add -A && git commit -m "feat: Brief summary of what was done

WHAT: Describe the specific changes made
- File/component changes
- New features or fixes

WHY: Explain key decisions
- Why this approach over alternatives
- Any tradeoffs made

NEXT: Note any follow-up work needed (optional)
- Blockers or dependencies
- Related tasks to tackle next"
\`\`\`

**Bad commit:** \`git commit -m "fix stuff"\`
**Good commit:** Multi-line with WHAT/WHY/NEXT sections

## Completion

When you have completed a task:
1. Run all back pressure checks using Bash
2. Make a DETAILED git commit (see format above) - this is essential!
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
function createHooks(_verbose: boolean) {
  // Hooks are available but we now use inline tool_use logging for cleaner output
  // The formatToolCall function provides all the detail we need
  return {
    PreToolUse: [],
    PostToolUse: [],
  }
}

/**
 * Run a single Ralph iteration using the Claude Agent SDK
 * Supports manual intervention via Ctrl+K during execution
 */
export async function runIteration(
  config: RalphConfig,
  systemPrompt: string,
  verbose: boolean = false,
  interventionCallback?: () => Promise<InterventionResult | null>,
): Promise<{
  success: boolean
  isComplete: boolean
  wasInterrupted?: boolean
  taskDescription?: string
  decisions?: string[]
  summary?: string
  filesChanged?: string[]
  error?: string
  output?: string
  intervention?: InterventionResult
}> {
  let fullOutput = ''
  let taskDescription = ''
  let decisions: string[] = []
  let summary = ''
  const filesChanged: string[] = []
  let isComplete = false
  let intervention: InterventionResult | null = null
  let wasInterrupted = false

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
      // Auto-allow tools for autonomous operation
      // In production, this runs in a sandboxed Docker container
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
      // Permission mode for autonomous operation - acceptEdits allows file changes
      permissionMode: 'acceptEdits',
      // Add hooks for tool execution monitoring
      hooks: createHooks(verbose),
    }

    let prompt =
      'Implement the task described in your instructions. Focus only on this specific task, run back pressure checks when done, then use the CompleteTask tool to finish.'

    // Check for pending intervention to include in initial prompt
    const keyboard = getKeyboardListener()
    if (keyboard.hasPendingIntervention()) {
      const pending = keyboard.consumeIntervention()
      if (pending) {
        intervention = pending
        prompt += formatInterventionMessage(pending)
        if (verbose) {
          console.log(formatWarning(`Including human feedback in prompt`))
        }
      }
    }

    // Run the agent query
    for await (const message of query({ prompt, options })) {
      // Check if user pressed Ctrl+K to interrupt
      if (keyboard.wasInterrupted()) {
        wasInterrupted = true
        console.log('')
        console.log(
          formatWarning('⏸️  Iteration interrupted by user (Ctrl+\\)'),
        )
        // Prompt for input immediately
        const userMessage = await keyboard.promptForInput()
        if (userMessage) {
          intervention = { message: userMessage, timestamp: new Date() }
        }
        keyboard.clearInterrupt()
        // Break out of the loop to restart with feedback
        break
      }

      // Handle different message types
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage
        // Extract text from the message
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            fullOutput += block.text + '\n'
            if (verbose) {
              // Format Claude's thoughts/reasoning with visual indicator
              const formatted = formatThought(block.text)
              if (formatted) {
                console.log(formatted)
              }
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
      success: !wasInterrupted, // Not successful if interrupted
      isComplete,
      wasInterrupted,
      taskDescription: wasInterrupted
        ? 'Iteration interrupted by user'
        : taskDescription || 'Task completed',
      decisions,
      summary,
      filesChanged,
      output: fullOutput,
      intervention: intervention || undefined,
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
