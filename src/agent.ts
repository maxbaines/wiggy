/**
 * Claude Agent SDK integration for Ralph
 * Handles communication with Claude API
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages'
import type { RalphConfig } from './types.ts'
import { toolDefinitions, executeTool } from './tools/index.ts'
import { COMPLETION_MARKER } from './types.ts'

/**
 * Create the Ralph system prompt
 */
export function createSystemPrompt(
  prdSummary: string,
  progressSummary: string,
  agentsMd?: string
): string {
  return `You are Ralph, an autonomous AI coding agent working through a task list.

## Your Process

1. **Analyze the PRD/task list** to understand what needs to be done.
2. **Check progress** to see what has already been completed.
3. **Choose the highest-priority task** - prioritize in this order:
   - Architectural decisions and core abstractions
   - Integration points between modules
   - Unknown unknowns and spike work
   - Standard features and implementation
   - Polish, cleanup, and quick wins
4. **Implement the chosen task** with small, focused changes.
5. **Run ALL feedback loops** before committing:
   - Use run_typecheck to check types
   - Use run_tests to run the test suite
   - Use run_lint to check linting
   - Do NOT commit if any feedback loop fails. Fix issues first.
6. **Make a git commit** with a clear, descriptive message using git_commit.

## Rules

- ONLY WORK ON A SINGLE TASK per iteration.
- Keep changes small and focused - one logical change per commit.
- Quality over speed - leave the codebase better than you found it.
- If a task feels too large, break it into subtasks.
- Run feedback loops after each change, not at the end.

## Current State

### PRD Status
${prdSummary}

### Progress
${progressSummary}

${agentsMd ? `### Project Guidelines (AGENTS.md)\n${agentsMd}` : ''}

## Completion

When you have completed a task:
1. Run all feedback loops (types, tests, lint)
2. Make a git commit with a descriptive message
3. Report what you did using this EXACT format:
   "Completed: [exact task description from PRD]"
   
   This allows Ralph to automatically mark the task as [DONE] in the PRD file.

If ALL tasks in the PRD are complete, output exactly: ${COMPLETION_MARKER}

This signals that the entire PRD has been implemented and Ralph should stop.
`
}

/**
 * Run a single Ralph iteration
 */
export async function runIteration(
  config: RalphConfig,
  systemPrompt: string,
  verbose: boolean = false
): Promise<{
  success: boolean
  isComplete: boolean
  taskDescription?: string
  filesChanged?: string[]
  error?: string
  output?: string
}> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: 10 * 60 * 1000, // 10 minutes
  })

  const messages: MessageParam[] = [
    {
      role: 'user',
      content:
        'Analyze the PRD and progress, then implement the highest-priority incomplete task. Remember to run feedback loops and commit your changes.',
    },
  ]

  let fullOutput = ''
  let taskDescription = ''
  let filesChanged: string[] = []
  let isComplete = false

  try {
    // Agentic loop - keep going until the agent stops using tools
    while (true) {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        tools: toolDefinitions,
        messages,
      })

      // Process the response
      let hasToolUse = false
      const assistantContent: ContentBlockParam[] = []

      for (const block of response.content) {
        if (block.type === 'text') {
          fullOutput += block.text + '\n'
          if (verbose) {
            console.log(block.text)
          }

          // Check for completion marker
          if (block.text.includes(COMPLETION_MARKER)) {
            isComplete = true
          }

          // Try to extract task description
          const taskMatch = block.text.match(
            /(?:working on|implementing|task:|completed:)\s*(.+?)(?:\n|$)/i
          )
          if (taskMatch && !taskDescription) {
            taskDescription = taskMatch[1].trim()
          }

          assistantContent.push({
            type: 'text',
            text: block.text,
          } as TextBlockParam)
        }

        if (block.type === 'tool_use') {
          hasToolUse = true

          if (verbose) {
            console.log(`\n🔧 Tool: ${block.name}`)
            console.log(`   Input: ${JSON.stringify(block.input)}`)
          }

          // Execute the tool
          const toolResult = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            config.workingDir
          )

          if (verbose) {
            console.log(
              `   Result: ${toolResult.substring(0, 200)}${
                toolResult.length > 200 ? '...' : ''
              }`
            )
          }

          // Track file changes
          if (block.name === 'write_file' && block.input) {
            const input = block.input as { path?: string }
            if (input.path) {
              filesChanged.push(input.path)
            }
          }

          // Add assistant message with tool use
          messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              },
            ],
          })

          // Add tool result
          const toolResultBlock: ToolResultBlockParam = {
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          }

          messages.push({
            role: 'user',
            content: [toolResultBlock],
          })
        }
      }

      // If no tool use, we're done with this iteration
      if (!hasToolUse) {
        // Add final assistant message if there was text
        if (assistantContent.length > 0) {
          messages.push({
            role: 'assistant',
            content: assistantContent,
          })
        }
        break
      }

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        break
      }
    }

    return {
      success: true,
      isComplete,
      taskDescription: taskDescription || 'Task completed',
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
