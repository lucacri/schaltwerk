import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HistoryItemRow } from './HistoryItemRow'
import { theme } from '../../common/theme'
import type { HistoryItemRef, HistoryItemViewModel } from './types'

function makeViewModel(references: HistoryItemRef[]): HistoryItemViewModel {
  return {
    historyItem: {
      id: 'abc1234',
      parentIds: [],
      subject: 'Test commit',
      author: 'Alice',
      timestamp: 1720000000000,
      references,
      fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff'
    },
    isCurrent: false,
    inputSwimlanes: [],
    outputSwimlanes: []
  }
}

function renderRow(references: HistoryItemRef[]) {
  return render(
    <HistoryItemRow
      viewModel={makeViewModel(references)}
      isSelected={false}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      onToggleDetails={vi.fn()}
      detailTopPadding={4}
      detailBottomPadding={4}
      detailItemHeight={18}
      detailMessageHeight={18}
    />
  )
}

function findPill(container: HTMLElement, name: string): HTMLElement {
  const pill = container.querySelector(`[title="${name}"]`) as HTMLElement | null
  if (!pill) throw new Error(`No pill with title="${name}" found`)
  return pill
}

describe('HistoryItemRow reference pills', () => {
  it('uses inverse text on bright amber branch color', () => {
    const { container } = renderRow([
      { id: 'r1', name: 'feature/bright', icon: 'branch', color: '#FFB000' }
    ])
    const pill = findPill(container, 'feature/bright')
    expect(pill.style.color).toBe(theme.colors.text.inverse)
    expect(pill.style.backgroundColor.toLowerCase()).toBe('#ffb000')
  })

  it('uses inverse text on bright tag color', () => {
    const { container } = renderRow([
      { id: 'r2', name: 'v1.0.0', icon: 'tag', color: '#e5c07b' }
    ])
    const pill = findPill(container, 'v1.0.0')
    expect(pill.style.color).toBe(theme.colors.text.inverse)
  })

  it('uses primary text on dark branch color', () => {
    const { container } = renderRow([
      { id: 'r3', name: 'feature/dark', icon: 'branch', color: '#994F00' }
    ])
    const pill = findPill(container, 'feature/dark')
    expect(pill.style.color).toBe(theme.colors.text.primary)
  })

  it('falls back to themed secondary text when ref has no color', () => {
    const { container } = renderRow([
      { id: 'r4', name: 'no-color-branch', icon: 'branch' }
    ])
    const pill = findPill(container, 'no-color-branch')
    expect(pill.style.color).toBe('var(--color-text-secondary)')
    expect(pill.style.backgroundColor).toBe('var(--color-overlay-light)')
  })

  it('does not cap the primary branch label width for long Lucode branch names', () => {
    const branchName = 'lucode/history-panel-branch-name-with-distinguishing-tail'
    const { container } = renderRow([
      { id: 'r5', name: branchName, icon: 'branch' }
    ])

    const pill = findPill(container, branchName)
    const label = pill.querySelector('.whitespace-nowrap') as HTMLElement | null

    expect(label).not.toBeNull()
    expect(label?.className).not.toContain('max-w-[90px]')
    expect(label?.textContent).toBe(branchName)
  })

  it('renders an inline agent badge for Lucode-managed branch refs', () => {
    const { getByText } = renderRow([
      {
        id: 'r6',
        name: 'lucode/owned-by-codex',
        icon: 'branch',
        sessionAgentType: 'codex',
        sessionAgentLabel: 'Codex'
      }
    ])

    expect(getByText('Codex')).toBeInTheDocument()
  })

  it('promotes a Lucode-managed branch to the visible primary pill when it is not first', () => {
    const { getByText, queryByText } = renderRow([
      { id: 'r7', name: 'main', icon: 'branch' },
      {
        id: 'r8',
        name: 'lucode/owned-by-codex',
        icon: 'branch',
        sessionAgentType: 'codex',
        sessionAgentLabel: 'Codex'
      },
      { id: 'r9', name: 'feature/other', icon: 'branch' }
    ])

    expect(getByText('lucode/owned-by-codex')).toBeInTheDocument()
    expect(getByText('Codex')).toBeInTheDocument()
    expect(queryByText('main')).not.toBeInTheDocument()
  })
})
