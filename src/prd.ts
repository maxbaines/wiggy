/**
 * PRD (Product Requirements Document) parsing for Ralph
 * Markdown format only
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { PrdJson, PrdItem, PrdItemStatus } from './types.ts'

/**
 * Load and parse a PRD file (Markdown format only)
 */
export function loadPrd(filePath: string): PrdJson | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf-8')
  return parseMarkdownPrd(content)
}

/**
 * Derive status from passes boolean (for backwards compatibility)
 */
function deriveStatus(passes: boolean, status?: PrdItemStatus): PrdItemStatus {
  if (status) return status
  return passes ? 'done' : 'pending'
}

/**
 * Normalize a PRD item to ensure all fields exist
 */
function normalizeItem(item: Partial<PrdItem>, index: number): PrdItem {
  const passes = item.passes || false
  const status = item.status || deriveStatus(passes)
  return {
    id: item.id || String(index + 1),
    category: item.category || 'general',
    description: item.description || '',
    steps: item.steps || [],
    priority: item.priority || 'medium',
    passes: status === 'done', // sync passes with status
    status,
  }
}

/**
 * Parse Markdown format PRD
 * Supports multi-line task descriptions - content after the checkbox line
 * until the next task item or section header is included in the description
 */
function parseMarkdownPrd(content: string): PrdJson {
  const items: PrdItem[] = []
  const lines = content.split('\n')

  let currentPriority: 'high' | 'medium' | 'low' = 'medium'
  let currentItem: Partial<PrdItem> | null = null
  let itemIndex = 0
  let collectingDescription = false

  for (const line of lines) {
    // Detect priority sections
    if (line.toLowerCase().includes('high priority')) {
      // Save previous item before changing section
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'high'
      collectingDescription = false
      continue
    }
    if (line.toLowerCase().includes('medium priority')) {
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'medium'
      collectingDescription = false
      continue
    }
    if (line.toLowerCase().includes('low priority')) {
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'low'
      collectingDescription = false
      continue
    }

    // Skip other headers (# or ##)
    if (line.match(/^#{1,2}\s/)) {
      continue
    }

    // Detect task items (checkbox format)
    // Support [ ], [x], [X], [DONE], and [WORKING]
    const taskMatch = line.match(
      /^-\s*\[([ xX]|DONE|WORKING)\]\s*\*?\*?(.+?)\*?\*?\s*$/,
    )
    if (taskMatch) {
      // Save previous item
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
      }

      const checkboxContent = taskMatch[1].trim().toUpperCase()
      let status: PrdItemStatus = 'pending'
      if (checkboxContent === 'X' || checkboxContent === 'DONE') {
        status = 'done'
      } else if (checkboxContent === 'WORKING') {
        status = 'working'
      }
      const description = taskMatch[2].trim()

      currentItem = {
        id: String(itemIndex + 1),
        category: 'general',
        description,
        steps: [],
        priority: currentPriority,
        passes: status === 'done',
        status,
      }
      collectingDescription = true
      continue
    }

    // Detect sub-items (steps) - lines starting with whitespace + dash
    const stepMatch = line.match(/^\s+-\s+(.+)$/)
    if (stepMatch && currentItem) {
      currentItem.steps = currentItem.steps || []
      currentItem.steps.push(stepMatch[1].trim())
      continue
    }

    // Collect additional description lines (non-empty lines that aren't steps or new tasks)
    if (collectingDescription && currentItem && line.trim()) {
      // Append to description with newline
      currentItem.description = currentItem.description + '\n' + line
    }
  }

  // Don't forget the last item
  if (currentItem) {
    items.push(normalizeItem(currentItem, itemIndex))
  }

  return {
    name: 'PRD',
    items,
  }
}

/**
 * Save PRD back to file (Markdown format only)
 */
export function savePrd(filePath: string, prd: PrdJson): void {
  writeFileSync(filePath, prdToMarkdown(prd), 'utf-8')
}

/**
 * Convert PRD to Markdown format
 */
function prdToMarkdown(prd: PrdJson): string {
  const lines: string[] = []

  if (prd.name) {
    lines.push(`# ${prd.name}`)
    lines.push('')
  }

  if (prd.description) {
    lines.push(prd.description)
    lines.push('')
  }

  lines.push('## Tasks')
  lines.push('')

  // Group by priority
  const byPriority = {
    high: prd.items.filter((i) => i.priority === 'high'),
    medium: prd.items.filter((i) => i.priority === 'medium'),
    low: prd.items.filter((i) => i.priority === 'low'),
  }

  for (const [priority, items] of Object.entries(byPriority)) {
    if (items.length === 0) continue

    lines.push(
      `### ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`,
    )
    lines.push('')

    for (const item of items) {
      // Use status for checkbox: [DONE], [WORKING], or [ ]
      let checkbox = '[ ]'
      if (item.status === 'done' || item.passes) {
        checkbox = '[DONE]'
      } else if (item.status === 'working') {
        checkbox = '[WORKING]'
      }

      // Handle multi-line descriptions - first line goes with checkbox, rest on separate lines
      const descriptionLines = item.description.split('\n')
      lines.push(`- ${checkbox} ${descriptionLines[0]}`)

      // Add remaining description lines (if multi-line)
      for (let i = 1; i < descriptionLines.length; i++) {
        lines.push(descriptionLines[i])
      }

      for (const step of item.steps) {
        lines.push(`  - ${step}`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Mark a PRD item as complete by ID
 */
export function markItemComplete(prd: PrdJson, itemId: string): PrdJson {
  return {
    ...prd,
    items: prd.items.map((item) =>
      item.id === itemId
        ? { ...item, passes: true, status: 'done' as PrdItemStatus }
        : item,
    ),
  }
}

/**
 * Mark a PRD item as working by ID
 */
export function markItemWorking(prd: PrdJson, itemId: string): PrdJson {
  return {
    ...prd,
    items: prd.items.map((item) =>
      item.id === itemId
        ? { ...item, status: 'working' as PrdItemStatus }
        : item,
    ),
  }
}

/**
 * Find the currently working item (if any)
 */
export function getWorkingItem(prd: PrdJson): PrdItem | undefined {
  return prd.items.find((item) => item.status === 'working')
}

/**
 * Mark the currently working item as complete
 * Returns null if no working item found
 */
export function markWorkingItemComplete(prd: PrdJson): PrdJson | null {
  const workingItem = getWorkingItem(prd)
  if (!workingItem) {
    return null
  }
  return markItemComplete(prd, workingItem.id)
}

/**
 * Mark a PRD item as complete by description (fuzzy match)
 */
export function markItemCompleteByDescription(
  prd: PrdJson,
  description: string,
): PrdJson | null {
  // Try exact match first
  let matchedItem = prd.items.find(
    (item) => !item.passes && item.description === description,
  )

  // If no exact match, try fuzzy match (contains or is contained by)
  if (!matchedItem) {
    matchedItem = prd.items.find(
      (item) =>
        !item.passes &&
        (item.description.toLowerCase().includes(description.toLowerCase()) ||
          description.toLowerCase().includes(item.description.toLowerCase())),
    )
  }

  if (!matchedItem) {
    return null
  }

  return markItemComplete(prd, matchedItem.id)
}

/**
 * Get incomplete items from PRD
 */
export function getIncompleteItems(prd: PrdJson): PrdItem[] {
  return prd.items.filter((item) => !item.passes)
}

/**
 * Get items by priority
 */
export function getItemsByPriority(prd: PrdJson): {
  high: PrdItem[]
  medium: PrdItem[]
  low: PrdItem[]
} {
  const incomplete = getIncompleteItems(prd)
  return {
    high: incomplete.filter((i) => i.priority === 'high'),
    medium: incomplete.filter((i) => i.priority === 'medium'),
    low: incomplete.filter((i) => i.priority === 'low'),
  }
}

/**
 * Check if PRD is complete
 */
export function isPrdComplete(prd: PrdJson): boolean {
  return prd.items.every((item) => item.passes)
}

/**
 * Get PRD summary for prompt
 */
export function getPrdSummary(prd: PrdJson): string {
  const total = prd.items.length
  const complete = prd.items.filter((i) => i.passes).length
  const incomplete = getIncompleteItems(prd)

  let summary = `PRD: ${prd.name}\n`
  summary += `Progress: ${complete}/${total} tasks complete\n\n`

  if (incomplete.length > 0) {
    summary += 'Remaining tasks:\n'
    for (const item of incomplete) {
      summary += `- [${item.priority}] ${item.description}\n`
      for (const step of item.steps) {
        summary += `  - ${step}\n`
      }
    }
  } else {
    summary += 'All tasks complete!'
  }

  return summary
}
