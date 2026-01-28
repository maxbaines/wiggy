/**
 * PRD (Product Requirements Document) parsing for Ralph
 * Markdown format with Acceptance Criteria checkboxes
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import type {
  PrdJson,
  PrdItem,
  PrdItemStatus,
  AcceptanceCriterion,
} from './types.ts'

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
 * Derive status from acceptance criteria completion
 */
function deriveStatusFromCriteria(
  criteria: AcceptanceCriterion[],
): PrdItemStatus {
  if (criteria.length === 0) return 'pending'
  const allDone = criteria.every((c) => c.done)
  const anyDone = criteria.some((c) => c.done)
  if (allDone) return 'done'
  if (anyDone) return 'working'
  return 'pending'
}

/**
 * Normalize a PRD item to ensure all fields exist
 */
function normalizeItem(item: Partial<PrdItem>, index: number): PrdItem {
  const acceptanceCriteria = item.acceptanceCriteria || []
  const status = item.status || deriveStatusFromCriteria(acceptanceCriteria)
  const passes =
    status === 'done' ||
    (acceptanceCriteria.length > 0 && acceptanceCriteria.every((c) => c.done))

  return {
    id: item.id || String(index + 1),
    category: item.category || 'general',
    description: item.description || '',
    requirements: item.requirements || [],
    acceptanceCriteria,
    steps: item.steps || [], // backwards compatibility
    priority: item.priority || 'medium',
    passes,
    status,
  }
}

/**
 * Parse Markdown format PRD
 * Supports the new format with Requirements and Acceptance Criteria sections
 *
 * Format:
 * # Feature: Feature Name
 *
 * ## Requirements
 * - Requirement 1
 * - Requirement 2
 *
 * ## Acceptance Criteria
 * - [ ] Criterion 1
 * - [x] Criterion 2 (done)
 *
 * **Output when complete:** `<promise>DONE</promise>`
 */
function parseMarkdownPrd(content: string): PrdJson {
  const items: PrdItem[] = []
  const lines = content.split('\n')

  let currentPriority: 'high' | 'medium' | 'low' = 'medium'
  let currentItem: Partial<PrdItem> | null = null
  let itemIndex = 0
  let currentSection: 'none' | 'requirements' | 'acceptance' | 'steps' = 'none'
  let prdName = 'PRD'
  let prdDescription: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect PRD title (# Title)
    const titleMatch = line.match(/^#\s+(.+)$/)
    if (titleMatch && !titleMatch[1].toLowerCase().startsWith('feature')) {
      prdName = titleMatch[1].trim()
      continue
    }

    // Detect priority sections
    if (line.toLowerCase().includes('high priority')) {
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'high'
      currentSection = 'none'
      continue
    }
    if (line.toLowerCase().includes('medium priority')) {
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'medium'
      currentSection = 'none'
      continue
    }
    if (line.toLowerCase().includes('low priority')) {
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
        currentItem = null
      }
      currentPriority = 'low'
      currentSection = 'none'
      continue
    }

    // Detect Feature header (# Feature: Name or ## Feature: Name)
    const featureMatch = line.match(/^#{1,2}\s+(?:Feature:\s*)?(.+)$/)
    if (featureMatch && !line.toLowerCase().includes('priority')) {
      // Check if this is a section header we should skip
      const headerLower = featureMatch[1].toLowerCase()
      if (
        headerLower === 'requirements' ||
        headerLower === 'acceptance criteria' ||
        headerLower === 'tasks'
      ) {
        continue
      }

      // Save previous item
      if (currentItem) {
        items.push(normalizeItem(currentItem, itemIndex++))
      }

      currentItem = {
        id: String(itemIndex + 1),
        category: 'general',
        description: featureMatch[1].trim().replace(/^Feature:\s*/i, ''),
        requirements: [],
        acceptanceCriteria: [],
        steps: [],
        priority: currentPriority,
        passes: false,
        status: 'pending',
      }
      currentSection = 'none'
      continue
    }

    // Detect Requirements section
    if (line.match(/^##\s*Requirements/i)) {
      currentSection = 'requirements'
      continue
    }

    // Detect Acceptance Criteria section
    if (line.match(/^##\s*Acceptance\s*Criteria/i)) {
      currentSection = 'acceptance'
      continue
    }

    // Detect Steps section (backwards compatibility)
    if (line.match(/^##\s*Steps/i)) {
      currentSection = 'steps'
      continue
    }

    // Parse content based on current section
    if (currentItem) {
      // Requirements: plain bullet points
      if (currentSection === 'requirements') {
        const reqMatch = line.match(/^[-*]\s+(.+)$/)
        if (reqMatch) {
          currentItem.requirements = currentItem.requirements || []
          currentItem.requirements.push(reqMatch[1].trim())
          continue
        }
      }

      // Acceptance Criteria: checkbox items
      if (currentSection === 'acceptance') {
        const criteriaMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/)
        if (criteriaMatch) {
          currentItem.acceptanceCriteria = currentItem.acceptanceCriteria || []
          currentItem.acceptanceCriteria.push({
            description: criteriaMatch[2].trim(),
            done: criteriaMatch[1].toLowerCase() === 'x',
          })
          continue
        }
      }

      // Steps (backwards compatibility): plain bullet points
      if (currentSection === 'steps') {
        const stepMatch = line.match(/^[-*]\s+(.+)$/)
        if (stepMatch) {
          currentItem.steps = currentItem.steps || []
          currentItem.steps.push(stepMatch[1].trim())
          continue
        }
      }
    }

    // Legacy format: task items with checkbox (- [ ] Task description)
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
        requirements: [],
        acceptanceCriteria: [],
        steps: [],
        priority: currentPriority,
        passes: status === 'done',
        status,
      }
      currentSection = 'none'
      continue
    }

    // Legacy: sub-items (steps) - lines starting with whitespace + dash
    const stepMatch = line.match(/^\s+-\s+(.+)$/)
    if (stepMatch && currentItem && currentSection === 'none') {
      // Convert legacy steps to acceptance criteria
      currentItem.acceptanceCriteria = currentItem.acceptanceCriteria || []
      currentItem.acceptanceCriteria.push({
        description: stepMatch[1].trim(),
        done: false,
      })
      continue
    }
  }

  // Don't forget the last item
  if (currentItem) {
    items.push(normalizeItem(currentItem, itemIndex))
  }

  return {
    name: prdName,
    description: prdDescription,
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
 * Format: # Feature: Name with ## Requirements and ## Acceptance Criteria sections
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

  // Group by priority
  const byPriority = {
    high: prd.items.filter((i) => i.priority === 'high'),
    medium: prd.items.filter((i) => i.priority === 'medium'),
    low: prd.items.filter((i) => i.priority === 'low'),
  }

  for (const [priority, items] of Object.entries(byPriority)) {
    if (items.length === 0) continue

    lines.push(
      `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`,
    )
    lines.push('')

    for (const item of items) {
      // Feature header with status indicator
      const statusIndicator =
        item.status === 'done'
          ? '[DONE] '
          : item.status === 'working'
            ? '[WORKING] '
            : ''
      lines.push(`# Feature: ${statusIndicator}${item.description}`)
      lines.push('')

      // Requirements section
      if (item.requirements && item.requirements.length > 0) {
        lines.push('## Requirements')
        for (const req of item.requirements) {
          lines.push(`- ${req}`)
        }
        lines.push('')
      }

      // Acceptance Criteria section with checkboxes
      if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
        lines.push('## Acceptance Criteria')
        for (const criterion of item.acceptanceCriteria) {
          const checkbox = criterion.done ? '[x]' : '[ ]'
          lines.push(`- ${checkbox} ${criterion.description}`)
        }
        lines.push('')
      }

      // Legacy steps support - convert to acceptance criteria format
      if (
        (!item.acceptanceCriteria || item.acceptanceCriteria.length === 0) &&
        item.steps &&
        item.steps.length > 0
      ) {
        lines.push('## Acceptance Criteria')
        for (const step of item.steps) {
          lines.push(`- [ ] ${step}`)
        }
        lines.push('')
      }
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
        ? {
            ...item,
            passes: true,
            status: 'done' as PrdItemStatus,
            acceptanceCriteria: item.acceptanceCriteria.map((c) => ({
              ...c,
              done: true,
            })),
          }
        : item,
    ),
  }
}

/**
 * Mark a specific acceptance criterion as complete
 */
export function markCriterionComplete(
  prd: PrdJson,
  itemId: string,
  criterionDescription: string,
): PrdJson {
  return {
    ...prd,
    items: prd.items.map((item) => {
      if (item.id !== itemId) return item

      const updatedCriteria = item.acceptanceCriteria.map((c) =>
        c.description.toLowerCase().includes(criterionDescription.toLowerCase())
          ? { ...c, done: true }
          : c,
      )

      const allDone = updatedCriteria.every((c) => c.done)
      const anyDone = updatedCriteria.some((c) => c.done)

      return {
        ...item,
        acceptanceCriteria: updatedCriteria,
        passes: allDone,
        status: allDone ? 'done' : anyDone ? 'working' : item.status,
      }
    }),
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
 * Shows acceptance criteria status for each feature
 */
export function getPrdSummary(prd: PrdJson): string {
  const total = prd.items.length
  const complete = prd.items.filter((i) => i.passes).length
  const incomplete = getIncompleteItems(prd)

  let summary = `PRD: ${prd.name}\n`
  summary += `Progress: ${complete}/${total} features complete\n\n`

  if (incomplete.length > 0) {
    summary += 'Remaining features:\n'
    for (const item of incomplete) {
      const criteriaTotal = item.acceptanceCriteria.length
      const criteriaDone = item.acceptanceCriteria.filter((c) => c.done).length

      summary += `\n### [${item.priority}] ${item.description}\n`

      if (item.requirements.length > 0) {
        summary += 'Requirements:\n'
        for (const req of item.requirements) {
          summary += `  - ${req}\n`
        }
      }

      if (criteriaTotal > 0) {
        summary += `Acceptance Criteria (${criteriaDone}/${criteriaTotal} done):\n`
        for (const criterion of item.acceptanceCriteria) {
          const checkbox = criterion.done ? '[x]' : '[ ]'
          summary += `  - ${checkbox} ${criterion.description}\n`
        }
      }

      // Legacy steps support
      if (criteriaTotal === 0 && item.steps.length > 0) {
        summary += 'Steps:\n'
        for (const step of item.steps) {
          summary += `  - [ ] ${step}\n`
        }
      }
    }
  } else {
    summary += 'All features complete!'
  }

  return summary
}
