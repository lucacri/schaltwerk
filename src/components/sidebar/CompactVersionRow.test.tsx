import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { renderWithProviders } from '../../tests/test-utils'
import { CompactVersionRow } from './CompactVersionRow'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'
import type { EnrichedSession, SessionInfo } from '../../types/session'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('../../store/atoms/lastAgentResponse', async () => {
  const actual = await vi.importActual<typeof import('../../store/atoms/lastAgentResponse')>('../../store/atoms/lastAgentResponse')
  return {
    ...actual,
    formatAgentResponseTime: () => 'just now',
  }
})

vi.mock('../session/SessionActions', () => ({
  SessionActions: () => <div data-testid="session-actions">actions</div>,
}))

const baseInfo: SessionInfo = {
  session_id: 'feature_v2',
  display_name: 'feature_v2',
  version_number: 2,
  branch: 'feature_v2',
  worktree_path: '/tmp/feature_v2',
  base_branch: 'main',
  status: 'active',
  session_state: 'running',
  is_current: false,
  session_type: 'worktree',
  ready_to_merge: false,
  attention_required: false,
  is_blocked: false,
  dirty_files_count: 2,
  commits_ahead_count: 4,
  original_agent_type: 'claude',
  diff_stats: { files_changed: 2, additions: 42, deletions: 3, insertions: 42 },
  issue_number: 8,
  issue_url: 'https://github.com/example/repo/issues/8',
  pr_number: 11,
  pr_url: 'https://github.com/example/repo/pull/11',
}

const baseSession: EnrichedSession = {
  info: baseInfo,
  status: undefined,
  terminals: [],
}

const mockActions: SessionCardActions = {
  onSelect: vi.fn(),
  onCancel: vi.fn(),
  onConvertToSpec: vi.fn(),
  onRunDraft: vi.fn(),
  onRefineSpec: vi.fn(),
  onDeleteSpec: vi.fn(),
  onImprovePlanSpec: vi.fn(),
  onReset: vi.fn(),
  onSwitchModel: vi.fn(),
  onCreatePullRequest: vi.fn(),
  onCreateGitlabMr: vi.fn(),
  onMerge: vi.fn(),
  onQuickMerge: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onLinkPr: vi.fn(),
  onPostToForge: vi.fn(),
}

function renderRow(overrides: Partial<ComponentProps<typeof CompactVersionRow>> = {}) {
  const props: ComponentProps<typeof CompactVersionRow> = {
    session: baseSession,
    index: 1,
    isSelected: false,
    hasFollowUpMessage: false,
    showPromoteIcon: false,
    willBeDeleted: false,
    isPromotionPreview: false,
    isRunning: false,
    isResetting: false,
    disableMerge: false,
    mergeStatus: 'idle',
    isBusy: false,
    isHighlighted: false,
    isConsolidationSourceHighlighted: false,
    onHover: vi.fn(),
    ...overrides,
  }

  renderWithProviders(<SessionCardActionsProvider actions={mockActions}><CompactVersionRow {...props} /></SessionCardActionsProvider>)
  return props
}

describe('CompactVersionRow', () => {
  it('renders the compact metadata row for a running version', () => {
    renderRow()

    const row = screen.getByTestId('compact-version-row')
    expect(row).toBeInTheDocument()
    expect(row).toHaveAttribute('data-session-id', 'feature_v2')
    expect(row).toHaveAttribute('data-session-selected', 'false')
    expect(screen.getByTestId('compact-row-version-index')).toHaveTextContent('v2')
    expect(screen.getByTestId('compact-row-agent-chip')).toHaveTextContent('claude')
    expect(screen.getByTestId('compact-row-diff-chip')).toHaveTextContent('2f +42 -3')
    expect(screen.getByRole('button', { name: 'Open issue #8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open PR #11' })).toBeInTheDocument()
    expect(screen.getByTestId('compact-row-status-running')).toBeInTheDocument()
    expect(screen.getByTestId('compact-stat-dirty')).toHaveTextContent('2 dirty')
    expect(screen.getByText('4 ahead')).toBeInTheDocument()
    expect(screen.queryByTestId('session-actions')).toBeNull()
  })

  it('renders the style guide row structure with accent, index, body, and right stack', () => {
    renderRow()

    const row = screen.getByTestId('compact-version-row')
    const accent = screen.getByTestId('compact-row-accent')
    const versionIndex = screen.getByTestId('compact-row-version-index')
    const body = screen.getByTestId('compact-row-body')
    const rightStack = screen.getByTestId('compact-row-right-stack')

    expect(row).toContainElement(accent)
    expect(row).toContainElement(versionIndex)
    expect(row).toContainElement(body)
    expect(row).toContainElement(rightStack)
    expect(accent.style.width).toBe('4px')
    expect(versionIndex.style.width).toBe('52px')
    expect(versionIndex).toHaveTextContent('v2')
    expect(screen.getByTestId('compact-row-agent-chip')).toHaveTextContent('claude')
    expect(screen.getByTestId('compact-row-diff-chip')).toHaveTextContent('2f +42 -3')
  })

  it('renders idle state when attention is required', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          attention_required: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-idle')).toBeInTheDocument()
    expect(screen.getByText(/idle/i)).toBeInTheDocument()
  })

  it('renders not started for spec rows that have never started clarification', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'spec',
          status: 'spec',
          worktree_path: '',
          clarification_started: false,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-not-started')).toBeInTheDocument()
    expect(screen.getByText(/not started/i)).toBeInTheDocument()
  })

  it('renders clarification running state for started specs', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'spec',
          status: 'spec',
          worktree_path: '',
          attention_required: false,
          clarification_started: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-running')).toBeInTheDocument()
  })

  it('renders clarified state for clarified specs', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'spec',
          status: 'spec',
          spec_stage: 'clarified',
          worktree_path: '',
          attention_required: false,
          clarification_started: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-clarified')).toBeInTheDocument()
    expect(screen.getByText(/^Clarified$/)).toBeInTheDocument()
  })

  it('renders clarification waiting state for started specs', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'spec',
          status: 'spec',
          worktree_path: '',
          attention_required: true,
          clarification_started: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-waiting')).toBeInTheDocument()
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()
    expect(screen.queryByTestId('compact-row-status-running')).toBeNull()
  })

  it('transitions from waiting to running when attention clears and isRunning becomes true', () => {
    const { rerender } = (() => {
      const props: ComponentProps<typeof CompactVersionRow> = {
        session: {
          ...baseSession,
          info: {
            ...baseSession.info,
            session_state: 'spec',
            status: 'spec',
            spec_stage: 'clarified',
            worktree_path: '',
            attention_required: true,
            attention_kind: 'waiting_for_input',
            clarification_started: true,
          },
        },
        index: 1,
        isSelected: false,
        hasFollowUpMessage: false,
        showPromoteIcon: false,
        willBeDeleted: false,
        isPromotionPreview: false,
        isRunning: false,
        isResetting: false,
        disableMerge: false,
        mergeStatus: 'idle',
        isBusy: false,
        isHighlighted: false,
        isConsolidationSourceHighlighted: false,
        onHover: vi.fn(),
      }

      return renderWithProviders(
        <SessionCardActionsProvider actions={mockActions}>
          <CompactVersionRow {...props} />
        </SessionCardActionsProvider>
      )
    })()

    expect(screen.getByTestId('compact-row-status-waiting')).toBeInTheDocument()
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()

    const clearedProps: ComponentProps<typeof CompactVersionRow> = {
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'spec',
          status: 'spec',
          spec_stage: 'clarified',
          worktree_path: '',
          attention_required: undefined,
          attention_kind: undefined,
          clarification_started: true,
        },
      },
      index: 1,
      isSelected: false,
      hasFollowUpMessage: false,
      showPromoteIcon: false,
      willBeDeleted: false,
      isPromotionPreview: false,
      isRunning: true,
      isResetting: false,
      disableMerge: false,
      mergeStatus: 'idle',
      isBusy: false,
      isHighlighted: false,
      isConsolidationSourceHighlighted: false,
      onHover: vi.fn(),
    }

    rerender(
      <SessionCardActionsProvider actions={mockActions}>
        <CompactVersionRow {...clearedProps} />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByTestId('compact-row-status-waiting')).toBeNull()
    expect(screen.queryByText(/waiting for input/i)).toBeNull()
    expect(screen.getByTestId('compact-row-status-running')).toBeInTheDocument()
  })

  it('does not render ready state when session is ready to merge', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          ready_to_merge: true,
          session_state: 'running',
          status: 'active',
        },
      },
    })

    expect(screen.queryByTestId('compact-row-status-ready')).toBeNull()
    expect(screen.queryByText(/ready/i)).toBeNull()
  })

  it('renders running state when a ready session is still active', () => {
    renderRow({
      isRunning: true,
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          ready_to_merge: true,
          session_state: 'running',
          status: 'active',
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-running')).toBeInTheDocument()
    expect(screen.queryByTestId('compact-row-status-ready')).toBeNull()
  })

  it('renders blocked state when session is blocked', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          is_blocked: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-blocked')).toBeInTheDocument()
    expect(screen.getByText(/blocked/i)).toBeInTheDocument()
  })

  it('selects the session on click', () => {
    renderRow()

    fireEvent.click(screen.getByTestId('compact-version-row'))
    expect(mockActions.onSelect).toHaveBeenCalledWith('feature_v2')
  })

  it('expands selected rows by default and shows actions', () => {
    renderRow({ isSelected: true })
    expect(screen.getByTestId('session-actions')).toBeInTheDocument()
  })

  it('hides actions when not selected', () => {
    renderRow({ isSelected: false })
    expect(screen.queryByTestId('session-actions')).toBeNull()
  })

  it('shows actions on a separate line when selected', () => {
    renderRow({ isSelected: true })
    const actions = screen.getByTestId('session-actions')
    expect(actions).toBeInTheDocument()
    const actionsRow = actions.closest('[data-testid="compact-row-actions"]')
    expect(actionsRow).toBeInTheDocument()
  })

  it('does not apply legacy tagMinWidth to the agent chip', () => {
    renderRow({ tagMinWidth: '14ch' })
    const badge = screen.getByTestId('compact-row-agent-chip')
    expect(badge.style.minWidth).toBe('')
  })

  it('does not set minWidth on the agent chip when tagMinWidth is undefined', () => {
    renderRow()
    const badge = screen.getByTestId('compact-row-agent-chip')
    expect(badge.style.minWidth).toBe('')
  })

  it('renders longer agent labels without truncation', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          original_agent_type: 'kilocode',
        },
      },
    })

    expect(screen.getByTestId('compact-row-version-index')).toHaveTextContent('v2')
    expect(screen.getByTestId('compact-row-agent-chip')).toHaveTextContent('kilocode')
  })

  it('renders consolidation sessions with a merge index instead of a duplicate version label', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          is_consolidation: true,
        },
      },
    })

    expect(screen.getByTestId('compact-row-version-index')).toHaveTextContent(/merge/i)
    expect(screen.getByTestId('compact-row-agent-chip')).toHaveTextContent('claude')
    expect(screen.queryByText('v2 · claude')).toBeNull()
  })

  it('uses selected styling from the style guide', () => {
    renderRow({ isSelected: true })

    const row = screen.getByTestId('compact-version-row')
    expect(row.style.getPropertyValue('--session-card-border')).toBe('var(--color-accent-blue-border)')
    expect(row.style.getPropertyValue('--session-card-bg')).toBe('var(--color-accent-blue-bg)')
    expect(row.style.getPropertyValue('--session-card-hover-bg')).toBe('var(--color-accent-blue-bg)')
  })

  it('dims the entire row when it is not a consolidation candidate', () => {
    renderRow({ isDimmedForConsolidation: true })

    expect(screen.getByTestId('compact-version-row')).toHaveStyle({ opacity: '0.55' })
  })

  it('renders the tree connector by default', () => {
    renderRow()

    expect(screen.getByTestId('compact-row-tree-connector-line')).toBeInTheDocument()
    expect(screen.getByTestId('compact-row-tree-connector-dot')).toBeInTheDocument()
  })

  it('hides the tree connector when requested', () => {
    renderRow({ hideTreeConnector: true })

    expect(screen.queryByTestId('compact-row-tree-connector-line')).toBeNull()
    expect(screen.queryByTestId('compact-row-tree-connector-dot')).toBeNull()
  })

  it('places the status chip and shortcut chip in a right-side stack per the style guide', () => {
    renderRow({ index: 2 })
    const stack = screen.getByTestId('compact-row-right-stack')
    const status = screen.getByTestId('compact-row-status-running')
    const shortcut = screen.getByTestId('compact-row-shortcut')
    expect(stack).toContainElement(status)
    expect(stack).toContainElement(shortcut)
    expect(shortcut).toHaveTextContent(/⌘4|Ctrl\s*\+?\s*4/)
  })

  it('omits the shortcut chip for rows beyond the indexed shortcut range', () => {
    renderRow({ index: 12 })
    expect(screen.queryByTestId('compact-row-shortcut')).toBeNull()
  })

  it('renders consolidation source indicators when source metadata exists', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          is_consolidation: true,
          consolidation_sources: ['feature_v1', 'feature_v3'],
        },
      },
      siblings: [
        {
          ...baseInfo,
          session_id: 'feature_v1',
          display_name: 'feature_v1',
          version_number: 1,
          original_agent_type: 'codex',
        },
        {
          ...baseInfo,
          session_id: 'feature_v3',
          display_name: 'feature_v3',
          version_number: 3,
          original_agent_type: 'gemini',
        },
      ],
    })

    const sources = screen.getByTestId('compact-row-consolidation-sources')
    expect(within(sources).getByText('←')).toBeInTheDocument()

    const dots = within(sources).getAllByTestId('compact-row-consolidation-source-dot')
    expect(dots).toHaveLength(2)
    expect(dots[0]).toHaveAttribute('title', 'codex (v1)')
    expect(dots[1]).toHaveAttribute('title', 'gemini (v3)')
  })
})
