import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
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
  onMarkReady: vi.fn(),
  onUnmarkReady: vi.fn(),
  onCancel: vi.fn(),
  onConvertToSpec: vi.fn(),
  onRunDraft: vi.fn(),
  onRefineSpec: vi.fn(),
  onDeleteSpec: vi.fn(),
  onReset: vi.fn(),
  onRestartTerminals: vi.fn(),
  onSwitchModel: vi.fn(),
  onCreatePullRequest: vi.fn(),
  onCreateGitlabMr: vi.fn(),
  onMerge: vi.fn(),
  onQuickMerge: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onLinkPr: vi.fn(),
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
    isMarkReadyDisabled: false,
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
    expect(screen.getByText('v2 · claude')).toBeInTheDocument()
    expect(screen.getByText('+42')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open issue #8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open PR #11' })).toBeInTheDocument()
    expect(screen.getByTestId('compact-row-status-running')).toBeInTheDocument()
    expect(screen.getByTestId('compact-stat-dirty')).toHaveTextContent('2 dirty')
    expect(screen.getByText('4 ahead')).toBeInTheDocument()
    expect(screen.queryByTestId('session-actions')).toBeNull()
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

  it('renders reviewed state when session is reviewed', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          session_state: 'reviewed',
          status: 'dirty',
        },
      },
    })

    expect(screen.getByTestId('compact-row-status-reviewed')).toBeInTheDocument()
    expect(screen.getByText(/reviewed/i)).toBeInTheDocument()
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

  it('applies tagMinWidth to the version badge', () => {
    renderRow({ tagMinWidth: '14ch' })
    const badge = screen.getByText('v2 · claude')
    expect(badge.style.minWidth).toBe('14ch')
  })

  it('does not set minWidth when tagMinWidth is undefined', () => {
    renderRow()
    const badge = screen.getByText('v2 · claude')
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

    expect(screen.getByText('v2 · kilocode')).toBeInTheDocument()
  })

  it('renders consolidation sessions with a merge badge instead of a duplicate version label', () => {
    renderRow({
      session: {
        ...baseSession,
        info: {
          ...baseSession.info,
          is_consolidation: true,
        },
      },
    })

    expect(screen.getByText('merge · claude')).toBeInTheDocument()
    expect(screen.queryByText('v2 · claude')).toBeNull()
  })
})
