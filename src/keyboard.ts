/**
 * Keyboard Listener Module
 * Provides non-blocking keyboard input detection for manual intervention
 */

import * as readline from 'readline'
import { EventEmitter } from 'events'

// Ctrl+\ is ASCII code 28 (0x1C) - rarely used in terminals
const CTRL_BACKSLASH = '\x1C'
// Ctrl+C is ASCII code 3 (0x03)
const CTRL_C = '\x03'

export interface InterventionResult {
  message: string
  timestamp: Date
}

/**
 * KeyboardListener - Listens for Ctrl+\ to trigger manual intervention
 *
 * Usage:
 *   const listener = new KeyboardListener()
 *   listener.start()
 *   listener.on('intervention', async () => {
 *     const message = await listener.promptForInput()
 *     // Use message...
 *   })
 *   // Later...
 *   listener.stop()
 */
export class KeyboardListener extends EventEmitter {
  private isListening: boolean = false
  private isPaused: boolean = false
  private isInterrupted: boolean = false
  private rl: readline.Interface | null = null
  private pendingIntervention: InterventionResult | null = null

  constructor() {
    super()
  }

  /**
   * Start listening for keyboard input
   */
  start(): void {
    if (this.isListening) return

    this.isListening = true

    // Only set up raw mode if stdin is a TTY
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')

      process.stdin.on('data', this.handleKeyPress.bind(this))
    }
  }

  /**
   * Stop listening for keyboard input
   */
  stop(): void {
    if (!this.isListening) return

    this.isListening = false

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
      process.stdin.removeAllListeners('data')
    }

    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }

  /**
   * Handle key press events
   */
  private handleKeyPress(key: string): void {
    // Don't process keys while paused for input
    if (this.isPaused) return

    if (key === CTRL_BACKSLASH) {
      this.isInterrupted = true
      this.emit('intervention')
    } else if (key === CTRL_C) {
      // Allow Ctrl+C to exit - restore terminal state first
      console.log('\n^C')
      this.stop()
      // Send SIGINT to properly terminate the process and any child processes
      process.kill(process.pid, 'SIGINT')
    }
  }

  /**
   * Pause raw mode and prompt for user input
   * Returns the user's message
   */
  async promptForInput(): Promise<string> {
    this.isPaused = true

    // Temporarily disable raw mode for readline
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }

    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      console.log('')
      console.log(
        '╔════════════════════════════════════════════════════════════╗',
      )
      console.log(
        '║  ⏸️  PAUSED - Manual Intervention                           ║',
      )
      console.log(
        '╚════════════════════════════════════════════════════════════╝',
      )
      console.log('')

      this.rl.question('💬 Enter your message for the agent: ', (answer) => {
        if (this.rl) {
          this.rl.close()
          this.rl = null
        }

        // Re-enable raw mode
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true)
        }

        this.isPaused = false

        // Store the intervention
        this.pendingIntervention = {
          message: answer.trim(),
          timestamp: new Date(),
        }

        console.log('')
        console.log('▶️  Resuming with your feedback...')
        console.log('')

        resolve(answer.trim())
      })
    })
  }

  /**
   * Check if there's a pending intervention message
   */
  hasPendingIntervention(): boolean {
    return this.pendingIntervention !== null
  }

  /**
   * Get and clear the pending intervention
   */
  consumeIntervention(): InterventionResult | null {
    const intervention = this.pendingIntervention
    this.pendingIntervention = null
    return intervention
  }

  /**
   * Check if currently paused for input
   */
  isPausedForInput(): boolean {
    return this.isPaused
  }

  /**
   * Check if currently listening
   */
  isActive(): boolean {
    return this.isListening
  }

  /**
   * Check if an interrupt was requested (Ctrl+K pressed)
   */
  wasInterrupted(): boolean {
    return this.isInterrupted
  }

  /**
   * Clear the interrupted state
   */
  clearInterrupt(): void {
    this.isInterrupted = false
  }
}

// Singleton instance for global access
let globalListener: KeyboardListener | null = null

/**
 * Get the global keyboard listener instance
 */
export function getKeyboardListener(): KeyboardListener {
  if (!globalListener) {
    globalListener = new KeyboardListener()
  }
  return globalListener
}

/**
 * Format an intervention message for injection into the conversation
 */
export function formatInterventionMessage(
  intervention: InterventionResult,
): string {
  return `

---
**🧑 Human Intervention** (${intervention.timestamp.toLocaleTimeString()}):
${intervention.message}
---

Please acknowledge this feedback and incorporate it into your current work.
`
}
