/**
 * Shared utilities for Ralph
 * Common functions used across multiple modules
 */

import { existsSync } from 'fs'
import { spawn } from 'child_process'
import type { CommandResult } from './types.ts'

/**
 * Find the Claude Code CLI executable path
 * Checks common installation locations and environment variable
 */
export function findClaudeCodePath(): string | undefined {
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
 * Execute a shell command
 * @param command - The command to execute
 * @param workingDir - Working directory for the command
 * @param timeout - Timeout in milliseconds (default: 60000)
 */
export async function executeCommand(
  command: string,
  workingDir: string,
  timeout: number = 60000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now()

    // Use shell to execute the command
    const child = spawn(command, {
      shell: true,
      cwd: workingDir,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    // Set timeout
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        success: false,
        error: `Command timed out after ${timeout}ms`,
        stdout,
        stderr,
        exitCode: -1,
      })
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      const duration = Date.now() - startTime

      if (code === 0) {
        resolve({
          success: true,
          output: `Command completed in ${duration}ms`,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
        })
      } else {
        resolve({
          success: false,
          error: `Command exited with code ${code}`,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? -1,
        })
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      resolve({
        success: false,
        error: `Failed to execute command: ${error.message}`,
        exitCode: -1,
      })
    })
  })
}

/**
 * Send a macOS notification
 * @param title - Notification title
 * @param message - Notification message
 */
export function sendNotification(title: string, message: string): void {
  try {
    const { execSync } = require('child_process')
    execSync(
      `osascript -e 'display notification "${message}" with title "${title}"'`,
      { stdio: 'ignore' },
    )
  } catch {
    // Ignore notification errors
  }
}
