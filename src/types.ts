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
  analyze?: boolean
  help: boolean
  version: boolean
}

// Task Selection Result (Phase 1 output)
export interface TaskSelectionResult {
  taskId: string
  taskDescription: string
  reasoning: string
}

// PRD Types
export type PrdItemStatus = 'pending' | 'working' | 'done'

export interface PrdItem {
  id: string
  category: string
  description: string
  steps: string[]
  priority: 'high' | 'medium' | 'low'
  passes: boolean // kept for backwards compatibility
  status: PrdItemStatus // new: 'pending' | 'working' | 'done'
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

// Tool Result Types (used by git.ts and backpressure.ts)
export interface ToolResult {
  success: boolean
  output?: string
  error?: string
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

// Note: The Claude Agent SDK provides built-in tool types via:
// import type { FileReadInput, FileWriteInput, FileEditInput, ... } from '@anthropic-ai/claude-agent-sdk/sdk-tools'
// See: https://platform.claude.com/docs/en/agent-sdk/overview

// Intervention Types
export interface InterventionMessage {
  message: string
  timestamp: Date
}

// Loop State
export interface LoopState {
  iteration: number
  maxIterations: number
  prd: PrdJson | null
  progress: ProgressEntry[]
  isComplete: boolean
  lastError?: string
  pendingIntervention?: InterventionMessage
}

// Completion Detection
export const COMPLETION_MARKER = '<promise>COMPLETE</promise>'
