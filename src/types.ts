/**
 * Ralph Type Definitions
 */

// Configuration
export interface RalphConfig {
  apiKey: string
  model: string
  maxTokens: number
  workingDir: string
  prdFile?: string
  progressFile: string
  progressMode: 'git' | 'file'
  verbose: boolean
}

// CLI Arguments
export interface RalphArgs {
  iterations: number
  hitl: boolean
  sandbox: boolean
  sandboxName?: string
  configFile?: string
  help: boolean
  version: boolean
}

// PRD Types
export interface PrdItem {
  id: string
  category: string
  description: string
  steps: string[]
  priority: 'high' | 'medium' | 'low'
  passes: boolean
}

export interface PrdJson {
  name: string
  description?: string
  items: PrdItem[]
}

// Back Pressure Check Result
export interface BackPressureCheckResult {
  name: string
  passed: boolean
  output?: string
}

// Progress Entry
export interface ProgressEntry {
  timestamp: string
  iteration: number
  taskId?: string
  taskDescription: string
  decisions: string[]
  filesChanged: string[]
  notes?: string
  backPressureResults?: BackPressureCheckResult[]
}

// Tool Definitions
export interface ToolResult {
  success: boolean
  output?: string
  error?: string
}

export interface FileReadResult extends ToolResult {
  content?: string
}

export interface FileWriteResult extends ToolResult {
  path?: string
}

export interface CommandResult extends ToolResult {
  exitCode?: number
  stdout?: string
  stderr?: string
}

export interface GitResult extends ToolResult {
  commitHash?: string
  branch?: string
}

// Agent Types
export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AgentToolResult {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

// Loop State
export interface LoopState {
  iteration: number
  maxIterations: number
  prd: PrdJson | null
  progress: ProgressEntry[]
  isComplete: boolean
  lastError?: string
}

// Completion Detection
export const COMPLETION_MARKER = '<promise>COMPLETE</promise>'
