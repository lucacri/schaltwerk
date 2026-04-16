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
  onSwitchModel: vi.fn(),
  onCreatePullRequest: vi.fn(),
  onCreateGitlabMr: vi.fn(),
  onMerge: vi.fn(),
  onQuickMerge: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onLinkPr: vi.fn(),
  onPostToForge: vi.fn(),
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

  it('keeps the shared task, shortcut, stats, and metadata anatomy for running cards', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              current_task: 'Stabilize primitive contract',
              diff_stats: { files_changed: 4, additions: 42, deletions: 18, insertions: 42 },
              dirty_files_count: 3,
              commits_ahead_count: 5,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText('Stabilize primitive contract')).toBeInTheDocument()
    expect(screen.getByText(/⌘2|Ctrl\s*\+?\s*2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /has uncommitted changes/i })).toHaveTextContent('3 dirty')
    expect(screen.getByTestId('session-card-stat-ahead')).toHaveTextContent('5 ahead')
    expect(screen.getByTestId('session-card-stat-diff')).toHaveTextContent('4 files')
    expect(screen.getByTitle('Agent: claude')).toHaveTextContent('claude')
    expect(screen.getByText('schaltwerk/s1')).toBeInTheDocument()
  })

  it('matches the style guide status strip and two-line task treatment', () => {
    const longTask = 'Refine auth handoff and cleanup across the sidebar cards without truncating the second task line'

    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              current_task: longTask,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning
        />
      </SessionCardActionsProvider>
    )

    const card = screen.getByRole('button', { name: /selected session/i })
    const statusStrip = card.querySelector('.w-\\[6px\\]')
    const task = screen.getByText(longTask)

    expect(statusStrip).toBeInTheDocument()
    expect(task).not.toHaveClass('truncate')
    expect(task.getAttribute('style')).toContain('font-size: var(--font-session-task)')
    expect(task.getAttribute('style')).toContain('height: var(--font-session-task-height)')
    expect(task).toHaveStyle({
      overflow: 'hidden',
    })
  })

  it('uses compact neutral dirty and diff badges with an accented ahead badge', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              has_uncommitted_changes: true,
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

    const dirty = screen.getByRole('button', { name: /has uncommitted changes/i })
    const ahead = screen.getByTestId('session-card-stat-ahead')
    const diff = screen.getByTestId('session-card-stat-diff')

    expect(dirty).toHaveClass('px-1.5', 'py-[1px]')
    expect(dirty).not.toHaveClass('bg-rose-900/30', 'text-rose-200', 'border-rose-700/60', 'hover:bg-rose-800/40')
    expect(dirty.getAttribute('style')).toContain('background-color: var(--color-bg-elevated)')
    expect(dirty.getAttribute('style')).toContain('border-color: var(--color-border-subtle)')
    expect(dirty.getAttribute('style')).toContain('color: var(--color-text-tertiary)')
    expect(ahead).toHaveClass('px-1.5', 'py-[1px]')
    expect(ahead.getAttribute('style')).toContain('background-color: var(--color-accent-blue-bg)')
    expect(ahead.getAttribute('style')).toContain('border-color: var(--color-accent-blue-border)')
    expect(diff).toHaveClass('gap-1.5', 'px-1.5', 'py-[1px]')
    expect(diff.getAttribute('style')).toContain('background-color: var(--color-bg-hover)')
    expect(diff.getAttribute('style')).toContain('border-color: var(--color-border-subtle)')
  })

  it('renders the shortcut chip inside the bottom metadata row to match the style guide', () => {
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

    const metaRow = screen.getByTestId('session-card-meta-row')
    const shortcut = screen.getByTestId('session-card-shortcut')
    expect(metaRow).toContainElement(shortcut)
    expect(shortcut).toHaveTextContent(/⌘2|Ctrl\s*\+?\s*2/)
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
  it('does not show a ready label when a session is ready to merge', () => {
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
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByText('Ready')).toBeNull()
  })

  it('shows the running indicator instead of the ready label when a ready session is still active', () => {
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
    const statusStrip = card.querySelector('.w-\\[6px\\]')
    expect(statusStrip).toBeInTheDocument()
    expect(statusStrip).toHaveClass('session-status-pulse')
    expect(screen.queryByText(/✓ Ready/)).toBeNull()
  })
})

describe('SessionCard spec status pill', () => {
  it('shows the clarified status pill for clarified spec sessions', () => {
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

    const pill = screen.getByTestId('session-card-status-pill')
    expect(pill).toHaveTextContent(/^Clarified$/)
    expect(pill.getAttribute('style')).toContain('background-color: var(--color-accent-green-bg)')
    expect(screen.getAllByText(/^Clarified$/)).toHaveLength(1)
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

  it('shows clarification running state for draft specs with an active clarification agent', () => {
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
          isRunning
        />
      </SessionCardActionsProvider>
    )

    const card = screen.getByRole('button', { name: /selected session/i })
    expect(card.querySelector('.w-\\[6px\\]')).toBeInTheDocument()
    expect(screen.getByText(/^clarifying$/i)).toBeInTheDocument()
  })

  it('does not render an inline Draft stage badge next to the spec name', () => {
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
          isRunning
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByText(/^Draft$/)).toBeNull()
    expect(screen.getByText(/^Clarifying$/i)).toBeInTheDocument()
  })

  it('shows clarified for clarified specs without attention when not running', () => {
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

    expect(screen.getByTestId('session-card-status-pill')).toHaveTextContent(/^Clarified$/)
    expect(screen.getAllByText(/^Clarified$/)).toHaveLength(1)
  })

  it('shows waiting for input for clarified specs with waiting attention when not running', () => {
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
              attention_required: true,
              attention_kind: 'waiting_for_input',
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

    expect(screen.getByTestId('session-card-status-pill')).toHaveTextContent(/waiting for input/i)
    expect(screen.queryByText(/^Clarified$/)).toBeNull()
  })

  it('shows clarifying for clarified specs with stale waiting attention while running', () => {
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
              attention_required: true,
              attention_kind: 'waiting_for_input',
              clarification_started: true,
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('session-card-status-pill')).toHaveTextContent(/^Clarifying$/)
    expect(screen.queryByText(/waiting for input/i)).toBeNull()
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
    expect(card.querySelector('.w-\\[6px\\]')).toBeInTheDocument()
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()
    expect(screen.queryByText(/^running$/i)).toBeNull()
  })

  it('keeps started specs with idle attention in the idle state', () => {
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
              attention_kind: 'idle',
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

    expect(screen.getByText(/idle/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting for input/i)).toBeNull()
  })

  it('shows waiting for input state for running sessions with waiting attention kind', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              attention_required: true,
              attention_kind: 'waiting_for_input',
              session_state: 'running',
              status: 'active',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()
    expect(screen.queryByText(/^idle$/i)).toBeNull()
  })

  it('keeps the idle state for running sessions with idle attention kind', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              attention_required: true,
              attention_kind: 'idle',
              session_state: 'running',
              status: 'active',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText(/idle/i)).toBeInTheDocument()
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

  it('shows consolidation report text for consolidation sessions', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              is_consolidation: true,
              consolidation_report: '## Decision\nKeep v1 base and port v2 tests.',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByText('## Decision Keep v1 base and port v2 tests.')).toBeInTheDocument()
  })

  it('shows Auto-filed badge for stub-sourced consolidation reports', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              is_consolidation: true,
              consolidation_report: '## Auto-filed stub report (session exited without filing)',
              consolidation_report_source: 'auto_stub',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('consolidation-auto-stub-badge')).toBeInTheDocument()
  })

  it('hides Auto-filed badge when the report was filed by an agent', () => {
    renderWithProviders(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionCard
          session={{
            ...baseSession,
            info: {
              ...baseSession.info,
              is_consolidation: true,
              consolidation_report: '## Real analysis',
              consolidation_report_source: 'agent',
            },
          }}
          index={0}
          isSelected
          hasFollowUpMessage={false}
          isRunning={false}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByTestId('consolidation-auto-stub-badge')).toBeNull()
  })
})
