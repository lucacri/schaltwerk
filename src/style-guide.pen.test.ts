import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PenNode {
  type: string
  name?: string
  reusable?: boolean
  children?: PenNode[]
  width?: string | number
  fontSize?: number
  textGrowth?: string
}

interface PenDocument {
  children: PenNode[]
}

function flattenNodes(nodes: PenNode[]): PenNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])])
}

function findNamedNode(nodes: PenNode[], name: string): PenNode | undefined {
  return flattenNodes(nodes).find((node) => node.name === name)
}

function hasExactContent(nodes: PenNode[], content: string): boolean {
  return flattenNodes(nodes).some((node) => 'content' in node && node.content === content)
}

describe('design/style-guide.pen', () => {
  const document = JSON.parse(
    readFileSync(resolve(process.cwd(), 'design/style-guide.pen'), 'utf8'),
  ) as PenDocument

  it('includes the reusable molecules needed for composed session views', () => {
    const reusableNames = flattenNodes(document.children)
      .filter((node) => node.reusable)
      .map((node) => node.name)

    expect(reusableNames).toEqual(expect.arrayContaining([
      'component/FavoriteCard',
      'component/SidebarSectionHeader',
      'component/EpicGroupHeader',
      'component/CompactVersionRow',
    ]))
  })

  it('documents the composed modal and sidebar views', () => {
    const composedViews = document.children.find((node) => node.name === 'Composed Views')

    expect(composedViews).toBeDefined()
    expect(composedViews?.type).toBe('frame')

    const descendants = flattenNodes(composedViews?.children ?? [])
    const descendantNames = descendants.map((node) => node.name)

    expect(descendantNames).toEqual(expect.arrayContaining([
      'New Session Modal View',
      'NameAndEpicRow',
      'AgentSections',
      'BasicAgentsCardsRow',
      'PromptEditorArea',
      'ModalFooter',
      'Agents Sidebar View',
      'Sidebar Top Bar',
      'Orchestrator Entry',
      'Specs Section',
      'Running Section',
      'Epic Group',
      'Epic Context Menu',
      'Ungrouped Sessions Divider',
      'Version Group',
      'Version Group Header',
      'Consolidation Candidate Lane',
    ]))

    expect(descendantNames).not.toContain('Search Toggle Row')
    expect(descendantNames).not.toContain('searchToggleButton')
    expect(descendantNames).not.toContain('Session Context Popup')

    expect(findNamedNode(composedViews?.children ?? [], 'New Session Modal View')).toBeDefined()
    expect(findNamedNode(composedViews?.children ?? [], 'Agents Sidebar View')).toBeDefined()
  })

  it('keeps session card examples aligned with the current sidebar states', () => {
    const sessionCard = findNamedNode(document.children, 'component/SessionCard')

    expect(sessionCard).toBeDefined()

    const sessionCardDescendants = flattenNodes(sessionCard?.children ?? [])
    const sessionCardNames = sessionCardDescendants.map((node) => node.name)

    expect(sessionCardNames).toEqual(expect.arrayContaining([
      'scAccentBar',
      'scContent',
      'scStatusText',
      'scStatusBadge',
      'scTask',
      'scDirtyChip',
      'scAheadChip',
      'scDiffChip',
      'scBottomRow',
      'scMetaLeft',
      'scShortcutBadge',
    ]))

    expect(hasExactContent(document.children, 'Reviewed')).toBe(false)
  })

  it('keeps session card task copy at body size and constrained to the card width', () => {
    const sessionCard = findNamedNode(document.children, 'component/SessionCard')
    const sessionTask = findNamedNode(sessionCard?.children ?? [], 'scTask')

    expect(sessionTask).toBeDefined()
    expect(sessionTask?.fontSize).toBe(10)
    expect(sessionTask?.width).toBe('fill_container')
    expect(sessionTask?.textGrowth).toBe('fixed-width-height')
  })

  it('uses compact version rows for grouped session comparisons instead of repeated titles and branch names', () => {
    const compactVersionRow = findNamedNode(document.children, 'component/CompactVersionRow')

    expect(compactVersionRow).toBeDefined()

    const compactVersionRowDescendants = flattenNodes(compactVersionRow?.children ?? [])
    const compactVersionRowNames = compactVersionRowDescendants.map((node) => node.name)

    expect(compactVersionRowNames).toEqual(expect.arrayContaining([
      'versionRowAccent',
      'versionIndexColumn',
      'versionIndexText',
      'versionRowBody',
      'versionRowAgentChip',
      'versionRowAgentText',
      'versionRowStats',
      'versionRowDirtyChip',
      'versionRowDirtyText',
      'versionRowAheadChip',
      'versionRowAheadText',
      'versionRowDiffChip',
      'versionRowDiffText',
      'versionRowStatusWrap',
      'versionRowStatus',
      'versionRowStatusText',
      'versionRowShortcut',
      'versionRowShortcutText',
    ]))

    expect(compactVersionRowNames).not.toContain('cvrName')
    expect(compactVersionRowNames).not.toContain('cvrBranch')
    expect(compactVersionRowNames).not.toContain('cvrDirtyChip')
    expect(compactVersionRowNames).not.toContain('cvrAheadChip')
    expect(compactVersionRowNames).not.toContain('cvrDiffChip')

    expect(hasExactContent(document.children, 'Expanded grouping')).toBe(false)
    expect(hasExactContent(document.children, 'Card density pass')).toBe(false)
    expect(hasExactContent(document.children, 'Status audit')).toBe(false)
    expect(hasExactContent(document.children, 'Consolidation candidate')).toBe(false)
    expect(hasExactContent(document.children, 'Expanded grouping, action shortcuts, and consolidation review.')).toBe(false)
    expect(hasExactContent(document.children, 'lucode/sidebar-redesign-v1')).toBe(false)
    expect(hasExactContent(document.children, 'lucode/sidebar-redesign-v2')).toBe(false)
    expect(hasExactContent(document.children, 'lucode/sidebar-redesign-v3')).toBe(false)
    expect(hasExactContent(document.children, 'lucode/sidebar-redesign-merge')).toBe(false)
  })
})
