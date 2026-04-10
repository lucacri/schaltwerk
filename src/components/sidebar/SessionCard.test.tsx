import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../tests/test-utils'
import { SessionCard } from './SessionCard'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'
import type { EnrichedSession, SessionInfo } from '../../types/session'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('../session/SessionActions', () => ({
  SessionActions: () => <div data-testid="session-actions" />,
}))

const baseInfo: SessionInfo = {
  session_id: 's1',
  display_name: 's1',
  branch: 'schaltwerk/s1',
  worktree_path: '/tmp/wt',
  base_branch: 'main',
  status: 'active',
  last_modified: new Date().toISOString(),
  has_uncommitted_changes: false,
  is_current: false,
  session_type: 'worktree',
  container_status: undefined,
  session_state: 'running',
  current_task: undefined,
  todo_percentage: undefined,
  is_blocked: false,
  diff_stats: { files_changed: 1, additions: 2, deletions: 3, insertions: 2 },
  dirty_files_count: 1,
  commits_ahead_count: 2,
  ready_to_merge: false,
  original_agent_type: 'claude',
}

const baseSession: EnrichedSession = {
  info: baseInfo,
  status: undefined,
  terminals: [] as string[],
}

const mockActions: SessionCardActions = {
  onSelect: vi.fn(),
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

describe('SessionCard dirty indicator', () => {
  it('shows dirty indicator for ready sessions with uncommitted changes', () => {
    const session: EnrichedSession = { 
      ...baseSession, 
      info: { 
        ...baseSession.info, 
        has_uncommitted_changes: true,
        ready_to_merge: false,
        session_state: 'running',
        status: 'dirty',
        top_uncommitted_paths: ['src/main.rs', 'README.md']
      } 
    }
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={session}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    const indicator = screen.getByRole('button', { name: /has uncommitted changes/i })
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('title')
  })

  it('shows dirty indicator for running sessions when dirty', () => {
    const session: EnrichedSession = {
      ...baseSession,
      info: {
        ...baseSession.info,
        has_uncommitted_changes: true,
        ready_to_merge: false,
        status: 'dirty',
      },
    }

    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={session}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByRole('button', { name: /has uncommitted changes/i })).toBeInTheDocument()
  })

  it('does not show dirty indicator when has_uncommitted_changes is false for ready session', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              ready_to_merge: true,
              session_state: 'running',
              status: 'active',
              dirty_files_count: 0,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByRole('button', { name: /has uncommitted changes/i })).toBeNull()
  })
})

describe('SessionCard stats-first layout', () => {
  it('shows stats and hides actions by default when not selected', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              dirty_files_count: 3,
              commits_ahead_count: 5,
              diff_stats: { files_changed: 4, additions: 42, deletions: 18, insertions: 42 },
            },
          }}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByRole('button', { name: /has uncommitted changes/i })).toHaveTextContent('3 dirty')
    expect(screen.getByTestId('session-card-stat-ahead')).toHaveTextContent('5')
    expect(screen.getByTestId('session-card-stat-diff')).toHaveTextContent('4')
    expect(screen.getByTestId('session-card-stat-diff')).toHaveTextContent('+42')
    expect(screen.getByTestId('session-card-stat-diff')).toHaveTextContent('-18')
    expect(screen.queryByTestId('session-actions')).toBeNull()
  })

  it('expands selected session cards by default', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={baseSession}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('session-actions')).toBeInTheDocument()
  })
})

describe('SessionCard running tag', () => {
  it('shows status strip and ready label when session is ready to merge but still running', () => {
    const session: EnrichedSession = {
      ...baseSession,
      info: {
        ...baseSession.info,
        ready_to_merge: true,
        session_state: 'running',
      },
    }

    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={session}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning
        />
      </SessionCardActionsProvider>
    )

    const card = screen.getByRole('button', { name: /selected session/i })
    const statusStrip = card.querySelector('.w-\\[3px\\]')
    expect(statusStrip).toBeInTheDocument()
    expect(screen.getByText(/✓ Ready/)).toBeInTheDocument()
  })
})

describe('SessionCard spec stage badges', () => {
  it('shows the clarified badge for spec sessions', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              session_state: 'spec',
              status: 'spec',
              spec_stage: 'clarified',
              worktree_path: '',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText('Clarified')).toBeInTheDocument()
  })

  it('shows not started for specs whose clarification has not been started', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              session_state: 'spec',
              status: 'spec',
              worktree_path: '',
              attention_required: false,
              clarification_started: false,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText(/not started/i)).toBeInTheDocument()
  })

  it('shows clarification running state for started specs', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              session_state: 'spec',
              status: 'spec',
              spec_stage: 'draft',
              worktree_path: '',
              attention_required: false,
              clarification_started: true,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    const card = screen.getByRole('button', { name: /selected session/i })
    expect(card.querySelector('.w-\\[3px\\]')).toBeInTheDocument()
    expect(screen.getByText(/^running$/i)).toBeInTheDocument()
  })

  it('shows waiting for input state for started specs that need input', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              session_state: 'spec',
              status: 'spec',
              spec_stage: 'draft',
              worktree_path: '',
              attention_required: true,
              clarification_started: true,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    const card = screen.getByRole('button', { name: /selected session/i })
    expect(card.querySelector('.w-\\[3px\\]')).toBeInTheDocument()
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()
  })
})

describe('SessionCard metadata badges', () => {
  it('shows issue and PR badges for running sessions before diff stats', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              issue_number: 42,
              issue_url: 'https://github.com/example/repo/issues/42',
              pr_number: 15,
              pr_url: 'https://github.com/example/repo/pull/15',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    const issueBadge = screen.getByRole('button', { name: 'Open issue #42' })
    const prBadge = screen.getByRole('button', { name: 'Open PR #15' })
    const additions = screen.getByText('+2')

    expect(issueBadge).toBeInTheDocument()
    expect(prBadge).toBeInTheDocument()
    expect(additions).toBeInTheDocument()
  })

  it('opens the linked URL when a metadata badge is clicked', async () => {
    invokeMock.mockResolvedValue(undefined)

    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              issue_number: 42,
              issue_url: 'https://github.com/example/repo/issues/42',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open issue #42' }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('open_external_url', { url: 'https://github.com/example/repo/issues/42' })
    })
  })

  it('shows linked badges for spec sessions', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              session_state: 'spec',
              status: 'spec',
              issue_number: 9,
              issue_url: 'https://github.com/example/repo/issues/9',
              pr_number: 12,
              pr_url: 'https://github.com/example/repo/pull/12',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open issue #9' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open PR #12' })).toBeInTheDocument()
  })
})

describe('SessionCard promoted badge', () => {
  it('shows promoted badge and reason when promotion_reason is set', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              promotion_reason: 'Best test coverage. Cherry-picked caching from v2.',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    const badge = screen.getByText(/Promoted/i)
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Best test coverage. Cherry-picked caching from v2.')
    expect(screen.getByText('Best test coverage. Cherry-picked caching from v2.')).toBeInTheDocument()
  })

  it('does not show promoted badge when promotion_reason is null', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={baseSession}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByText(/Promoted/i)).toBeNull()
  })
})
