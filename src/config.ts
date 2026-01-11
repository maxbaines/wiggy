/**
 * Configuration loading for Ralph
 * Priority: Environment variables > Config file > .env > Defaults
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { RalphConfig } from './types.ts'

const DEFAULTS: RalphConfig = {
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 50000,
  workingDir: process.cwd(),
  progressFile: 'progress.txt',
  verbose: false,
}

/**
 * Load configuration from a JSON file
 */
function loadConfigFile(configPath: string): Partial<RalphConfig> {
  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.warn(`Warning: Could not parse config file ${configPath}`)
    return {}
  }
}

/**
 * Load configuration from .env file
 */
function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) {
    return
  }

  try {
    const content = readFileSync(envPath, 'utf-8')
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=').trim()

      // Only set if not already in environment
      if (key && value && !process.env[key]) {
        process.env[key] = value
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not parse .env file ${envPath}`)
  }
}

/**
 * Load Ralph configuration with priority:
 * 1. Environment variables (highest)
 * 2. Config file (ralph.config.json)
 * 3. .env file
 * 4. Defaults (lowest)
 */
export function loadConfig(configFilePath?: string): RalphConfig {
  // Load .env file first (lowest priority after defaults)
  const envPath = join(process.cwd(), '.env')
  loadEnvFile(envPath)

  // Load config file if specified or exists
  const configPath = configFilePath || join(process.cwd(), 'ralph.config.json')
  const fileConfig = loadConfigFile(configPath)

  // Build config with priority
  const config: RalphConfig = {
    apiKey:
      process.env.ANTHROPIC_API_KEY || fileConfig.apiKey || DEFAULTS.apiKey,

    model: process.env.RALPH_MODEL || fileConfig.model || DEFAULTS.model,

    maxTokens:
      parseInt(process.env.RALPH_MAX_TOKENS || '', 10) ||
      fileConfig.maxTokens ||
      DEFAULTS.maxTokens,

    workingDir:
      process.env.RALPH_WORKING_DIR ||
      fileConfig.workingDir ||
      DEFAULTS.workingDir,

    prdFile: process.env.RALPH_PRD_FILE || fileConfig.prdFile,

    progressFile:
      process.env.RALPH_PROGRESS_FILE ||
      fileConfig.progressFile ||
      DEFAULTS.progressFile,

    verbose:
      process.env.RALPH_VERBOSE === 'true' ||
      fileConfig.verbose ||
      DEFAULTS.verbose,
  }

  return config
}

/**
 * Validate configuration
 */
export function validateConfig(config: RalphConfig): string[] {
  const errors: string[] = []

  if (!config.apiKey) {
    errors.push(
      'ANTHROPIC_API_KEY is required. Set it in environment, .env file, or ralph.config.json'
    )
  }

  if (!config.model) {
    errors.push('Model is required')
  }

  if (config.maxTokens < 1 || config.maxTokens > 200000) {
    errors.push('maxTokens must be between 1 and 200000')
  }

  return errors
}

/**
 * Find PRD file in common locations
 */
export function findPrdFile(workingDir: string): string | null {
  const locations = ['plans/prd.md', 'prd.md']

  for (const loc of locations) {
    const fullPath = join(workingDir, loc)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}
