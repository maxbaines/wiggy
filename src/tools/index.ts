/**
 * Tool registry for Ralph
 * Now uses Claude Agent SDK's built-in tools
 * Git tools are kept for potential direct use
 */

// Re-export git tools (can be used directly if needed)
export * as git from './git.ts'

// Export CompleteTask tool for atomic task completion
export {
  executeCompleteTask,
  getCompleteTaskToolDescription,
  type CompleteTaskInput,
  type CompleteTaskResult,
  type CompleteTaskConfig,
} from './complete-task.ts'

// Note: The Claude Agent SDK provides built-in tools:
//
// File Tools:
// - Read: Read any file in the working directory (supports offset/limit)
// - Write: Create new files
// - Edit: Make precise edits to existing files (search/replace)
// - Glob: Find files by pattern (**/*.ts, src/**/*.py)
// - Grep: Search file contents with regex and context lines
//
// Shell Tools:
// - Bash: Run terminal commands, scripts, git operations
//
// Web Tools:
// - WebSearch: Search the web for current information
// - WebFetch: Fetch and parse web page content
//
// Interactive Tools:
// - AskUserQuestion: Ask the user clarifying questions
//
// These are configured in agent.ts via the SDK's query() function.
// Git operations are done via Bash tool (e.g., `git add -A && git commit -m "msg"`)
