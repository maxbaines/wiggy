/**
 * Rich terminal output formatting for Ralph
 * Provides colored, styled output with code highlighting
 */

// ANSI color codes - Bright/Neon variants
export const colors = {
  // Standard colors
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Neon foreground colors
  neonGreen: '\x1b[92m',
  neonYellow: '\x1b[93m',
  neonRed: '\x1b[91m',
  neonCyan: '\x1b[96m',
  neonMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',

  // Standard foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgDarkGray: '\x1b[48;5;234m',
  bgGreen: '\x1b[48;5;22m',
  bgYellow: '\x1b[48;5;58m',
  bgRed: '\x1b[48;5;52m',
  bgCyan: '\x1b[48;5;23m',
}

// Box drawing characters
const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  thinTopLeft: '┌',
  thinTopRight: '┐',
  thinBottomLeft: '└',
  thinBottomRight: '┘',
  thinHorizontal: '─',
  thinVertical: '│',
}

/**
 * Get the visual width of a string (accounting for emoji and special characters)
 */
function getVisualWidth(str: string): number {
  // Remove ANSI codes
  const cleaned = str.replace(/\x1b\[[0-9;]*m/g, '')

  // Count visual width (emojis count as 2, regular chars as 1)
  let width = 0
  for (const char of cleaned) {
    const code = char.codePointAt(0) || 0
    // Emoji and special characters typically take 2 spaces
    if (code > 0x1f000) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/**
 * Format a tool call header - clean, compact output
 */
export function formatToolCall(
  name: string,
  input: Record<string, unknown>,
): string {
  // Extract the most relevant info based on tool type
  let detail = ''

  switch (name) {
    case 'Write':
    case 'Read':
    case 'Edit':
      // File tools - show file path only
      if (input.file_path) {
        detail = String(input.file_path)
      }
      break
    case 'Bash':
      // Bash - show command (truncated if long)
      if (input.command) {
        const cmd = String(input.command)
        detail = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd
      }
      break
    case 'Glob':
      // Glob - show pattern
      if (input.pattern) {
        detail = String(input.pattern)
      }
      break
    case 'Grep':
      // Grep - show pattern and path
      if (input.pattern) {
        detail = String(input.pattern)
        if (input.path) {
          detail += ` in ${input.path}`
        }
      }
      break
    case 'WebSearch':
      // Web search - show query
      if (input.query) {
        const query = String(input.query)
        detail = query.length > 50 ? query.substring(0, 47) + '...' : query
      }
      break
    case 'WebFetch':
      // Web fetch - show URL
      if (input.url) {
        detail = String(input.url)
      }
      break
    default:
      // For other tools, show first string value if any
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.length < 80) {
          detail = value
          break
        }
      }
  }

  // Format: 🔧 ToolName → detail
  if (detail) {
    return (
      colors.neonCyan +
      '🔧 ' +
      colors.bold +
      name +
      colors.reset +
      colors.gray +
      ' → ' +
      detail +
      colors.reset
    )
  }

  return colors.neonCyan + '🔧 ' + colors.bold + name + colors.reset
}

/**
 * Format a tool result
 */
export function formatToolResult(
  result: string,
  type: 'success' | 'error' | 'info' = 'info',
): string {
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'
  const color =
    type === 'success'
      ? colors.neonGreen
      : type === 'error'
        ? colors.neonRed
        : colors.cyan

  let output = ''
  output += color + `${icon} Result:` + colors.reset + '\n'

  // Truncate long results
  const maxLength = 500
  const displayResult =
    result.length > maxLength ? result.substring(0, maxLength) + '...' : result

  // Format result with indentation
  const lines = displayResult.split('\n')
  for (const line of lines) {
    output += colors.gray + '  ' + colors.reset + line + '\n'
  }

  output += '\n'

  return output
}

/**
 * Format a code block with background color (full width, no box)
 */
export function formatCodeBlock(
  code: string,
  type: 'new' | 'changed' | 'deleted' | 'info' = 'info',
): string {
  let bgColor: string
  let fgColor: string
  let label: string

  switch (type) {
    case 'new':
      bgColor = colors.bgGreen
      fgColor = colors.neonGreen
      label = '▶ NEW'
      break
    case 'changed':
      bgColor = colors.bgYellow
      fgColor = colors.neonYellow
      label = '▶ CHANGED'
      break
    case 'deleted':
      bgColor = colors.bgRed
      fgColor = colors.neonRed
      label = '▶ DELETED'
      break
    default:
      bgColor = colors.bgDarkGray
      fgColor = colors.cyan
      label = ''
  }

  let output = ''

  // Label line if present
  if (label) {
    output += fgColor + label + colors.reset + '\n'
  }

  // Content lines - full width with background
  const lines = code.split('\n')
  for (const line of lines) {
    output += bgColor + fgColor + line + colors.reset + '\n'
  }

  return output
}

/**
 * Format a file change notification - compact single line
 */
export function formatFileChange(
  path: string,
  type: 'create' | 'modify' | 'delete',
  _content?: string,
): string {
  let icon: string
  let color: string
  let label: string

  switch (type) {
    case 'create':
      icon = '📄'
      color = colors.neonGreen
      label = 'Created'
      break
    case 'modify':
      icon = '📝'
      color = colors.neonYellow
      label = 'Modified'
      break
    case 'delete':
      icon = '🗑️'
      color = colors.neonRed
      label = 'Deleted'
      break
  }

  // Compact single-line format: 📝 Modified → /path/to/file.ts
  return (
    '\n' +
    color +
    icon +
    ' ' +
    label +
    colors.reset +
    colors.gray +
    ' → ' +
    path +
    colors.reset +
    '\n'
  )
}

/**
 * Format a banner/box with title and content (no box, just colored text)
 */
export function formatBox(
  title: string,
  content?: string,
  color: keyof typeof colors = 'cyan',
): string {
  const colorCode = colors[color] || colors.cyan

  let output = '\n'
  output += colorCode + colors.bold + title + colors.reset + '\n'

  if (content) {
    const lines = content.split('\n')
    for (const line of lines) {
      output += colorCode + line + colors.reset + '\n'
    }
  }

  return output
}

/**
 * Simple colored log function
 */
export function log(message: string, color?: keyof typeof colors): void {
  if (color && colors[color]) {
    console.log(`${colors[color]}${message}${colors.reset}`)
  } else {
    console.log(message)
  }
}

/**
 * Format a section divider
 */
export function formatDivider(
  title?: string,
  color: keyof typeof colors = 'blue',
): string {
  const width = 65
  const colorCode = colors[color] || colors.blue

  if (title) {
    const padding = Math.max(0, Math.floor((width - title.length - 4) / 2))
    return (
      colorCode +
      '━'.repeat(padding) +
      '  ' +
      title +
      '  ' +
      '━'.repeat(width - padding - title.length - 4) +
      colors.reset
    )
  }

  return colorCode + '━'.repeat(width) + colors.reset
}

/**
 * Format iteration header
 */
export function formatIterationHeader(current: number, total: number): string {
  return formatDivider(`Iteration ${current} of ${total}`, 'neonCyan')
}

/**
 * Format success message
 */
export function formatSuccess(message: string): string {
  return colors.neonGreen + '✓ ' + colors.reset + message
}

/**
 * Format error message
 */
export function formatError(message: string): string {
  return colors.neonRed + '✗ ' + colors.reset + message
}

/**
 * Format warning message
 */
export function formatWarning(message: string): string {
  return colors.neonYellow + '⚠ ' + colors.reset + message
}

/**
 * Format info message
 */
export function formatInfo(message: string): string {
  return colors.neonCyan + 'ℹ ' + colors.reset + message
}

/**
 * Format Claude's thought/reasoning text - shows AI's next step clearly
 */
export function formatThought(text: string): string {
  // Skip empty or whitespace-only text
  if (!text.trim()) {
    return ''
  }

  // Add thought bubble prefix and subtle styling
  const lines = text.split('\n')
  let output = '\n'

  for (const line of lines) {
    if (line.trim()) {
      output +=
        colors.neonMagenta +
        '💭 ' +
        colors.reset +
        colors.dim +
        line +
        colors.reset +
        '\n'
    } else {
      output += '\n'
    }
  }

  return output
}
