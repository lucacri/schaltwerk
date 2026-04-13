import { render, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionVersionGroup } from './SessionVersionGroup'
import type { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import type { EnrichedSession } from '../../types/session'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'

vi.mock('./SessionCard', () => ({
  SessionCard: ({ session }: { session: EnrichedSession }) => (
    <div data-testid="session-card">{session.info.session_id}</div>
  )
}))

vi.mock('./CompactVersionRow', () => ({
  CompactVersionRow: ({
    session,
    hideTreeConnector,
    siblings,
  }: {
    session: EnrichedSession
    hideTreeConnector?: boolean
    siblings?: EnrichedSession['info'][]
  }) => (
    <div
      data-testid="compact-version-row"
      data-session-id={session.info.session_id}
      data-hide-tree-connector={hideTreeConnector ? 'true' : 'false'}
      data-sibling-count={siblings?.length ?? 0}
    >
      {session.info.session_id}
    </div>
  )
}))

function createVersion({
  id,
  attentionRequired = false,
  attentionKind,
  sessionState = 'running',
  currentTask = 'Shared task summary',
  specContent,
  versionNumber = 1,
  readyToMerge = false,
  isBlocked = false,
}: {
  id: string
  attentionRequired?: boolean
  attentionKind?: 'idle' | 'waiting_for_input'
  sessionState?: 'spec' | 'running'
  currentTask?: string
  specContent?: string
  versionNumber?: number
  readyToMerge?: boolean
  isBlocked?: boolean
}): SessionVersionGroupType['versions'][number] {
  const info: EnrichedSession['info'] = {
    session_id: id,
    display_name: id,
    version_number: versionNumber,
    branch: `${id}-branch`,
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    session_state: sessionState,
    is_current: false,
    session_type: 'worktree',
    attention_kind: attentionKind,
    ready_to_merge: readyToMerge,
    attention_required: attentionRequired,
    original_agent_type: 'claude',
    current_task: currentTask,
    spec_content: specContent,
    is_blocked: isBlocked,
  }

  return {
    versionNumber,
    session: {
      info,
      status: undefined,
      terminals: []
    }
  }
}

const baseGroup: SessionVersionGroupType = {
  id: 'feature-A-group-id',
  baseName: 'feature-A',
  isVersionGroup: true,
  versions: [
    createVersion({ id: 'feature-A_v1', attentionRequired: false, versionNumber: 1 }),
    createVersion({ id: 'feature-A_v2', attentionRequired: true, attentionKind: 'idle', versionNumber: 2 })
  ]
}

const requiredCallbacks = {
  hasFollowUpMessage: () => false,
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
}

describe('SessionVersionGroup status summary', () => {
  it('shows selected version count and status in the group header', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'feature-A_v2' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-count')).toHaveTextContent('2 / 2')
    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Idle')
  })

  it('falls back to the first source version when no grouped version is selected', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-count')).toHaveTextContent('1 / 2')
    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Running')
  })

  it('shows ready state in the group header when the active version is ready', () => {
    const readyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1, readyToMerge: true }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
      ]
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={readyGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Ready')
  })

  it('keeps the header status area visible when collapsed', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-header-status')).toBeVisible()

    const toggle = screen.getByRole('button', { name: /feature-A/i })
    fireEvent.click(toggle)

    expect(screen.getByTestId('version-group-header-status')).toBeVisible()
  })

  it('shows consolidate button disabled when fewer than two running sessions exist', () => {
    const onConsolidate = vi.fn()
    const groupWithSpecs: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'spec' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running' }),
      ],
    }

    const { getByTestId } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={groupWithSpecs}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConsolidate={onConsolidate}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const button = getByTestId('consolidate-versions-button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Needs at least 2 running sessions to consolidate')

    fireEvent.click(button)
    expect(onConsolidate).not.toHaveBeenCalled()
  })

  it('enables consolidate button when at least two running sessions exist', () => {
    const onConsolidate = vi.fn()

    const { getByTestId } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConsolidate={onConsolidate}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const button = getByTestId('consolidate-versions-button')
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(onConsolidate).toHaveBeenCalledTimes(1)
  })

  it('disables consolidate button when the group already contains a consolidation session', () => {
    const onConsolidate = vi.fn()
    const consolidatedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running' }),
        createVersion({
          id: 'feature-A-consolidation',
          sessionState: 'running',
        }),
      ].map((version, index) => index === 2
        ? {
            ...version,
            session: {
              ...version.session,
              info: {
                ...version.session.info,
                is_consolidation: true,
              },
            },
          }
        : version),
    }

    const { getByTestId } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={consolidatedGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConsolidate={onConsolidate}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const button = getByTestId('consolidate-versions-button')
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(onConsolidate).not.toHaveBeenCalled()
  })

  it('shows terminate-all button only when running sessions exist', () => {
    const onTerminateAll = vi.fn()

    const { getByTestId, queryByTestId, rerender } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTerminateAll={onTerminateAll}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const terminateButton = getByTestId('terminate-group-button')
    fireEvent.click(terminateButton)
    expect(onTerminateAll).toHaveBeenCalledTimes(1)

    const specOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'spec' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'spec' }),
      ],
    }

    rerender(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={specOnlyGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTerminateAll={onTerminateAll}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(queryByTestId('terminate-group-button')).toBeNull()
  })

  it('renders the first available group description above compact version rows', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-description')).toHaveTextContent('Shared task summary')
    expect(screen.getAllByTestId('compact-version-row')).toHaveLength(2)
    expect(screen.queryAllByTestId('session-card')).toHaveLength(0)
  })

  it('renders the first available description when version descriptions differ', () => {
    const mixedTasksGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', currentTask: 'Task one' }),
        createVersion({ id: 'feature-A_v2', currentTask: 'Task two' }),
      ],
    }

    const { getByText, queryByText } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={mixedTasksGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(getByText('Task one')).toBeInTheDocument()
    expect(queryByText('Task two')).toBeNull()
  })

  it('renders the first available description when some versions have no description', () => {
    const mixedCompletenessGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', currentTask: 'Task one' }),
        createVersion({ id: 'feature-A_v2', currentTask: '' }),
      ],
    }

    const { getByText } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={mixedCompletenessGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(getByText('Task one')).toBeInTheDocument()
  })

  it('renders consolidation rows outside the source list with a dedicated lane container', () => {
    const consolidatedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running' }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
            },
            status: undefined,
            terminals: [],
          },
        },
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={consolidatedGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const sourceList = screen.getByTestId('version-group-source-list')
    const consolidationContainer = screen.getByTestId('version-group-consolidation-lane')

    expect(screen.getByTestId('version-group-consolidation-divider')).toBeInTheDocument()
    expect(within(sourceList).getAllByTestId('compact-version-row')).toHaveLength(2)
    expect(within(consolidationContainer).getByTestId('compact-version-row')).toHaveAttribute('data-session-id', 'feature-A-merge')
    expect(within(consolidationContainer).getByTestId('compact-version-row')).toHaveAttribute('data-hide-tree-connector', 'true')
  })

  it('renders source versions without tree connectors in the parity source list', () => {
    const consolidatedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running' }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
            },
            status: undefined,
            terminals: [],
          },
        },
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={consolidatedGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const sourceRows = within(screen.getByTestId('version-group-source-list')).getAllByTestId('compact-version-row')
    expect(sourceRows).toHaveLength(2)
    sourceRows.forEach(row => expect(row).toHaveAttribute('data-hide-tree-connector', 'true'))
  })

  it('renders grouped source rows without the legacy source-tree wrapper', () => {
    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByTestId('version-group-source-tree')).toBeNull()
    screen.getAllByTestId('compact-version-row').forEach((row) => {
      expect(row).toHaveAttribute('data-hide-tree-connector', 'true')
    })
  })

  it('keeps judge actions available when only a judge recommendation remains', () => {
    const judgeOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_recommended_session_id: 'feature-A_v2',
            },
            status: undefined,
            terminals: [],
          },
        },
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={judgeOnlyGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTriggerConsolidationJudge={vi.fn()}
          onConfirmConsolidationWinner={vi.fn()}
          onConsolidate={vi.fn()}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-consolidation-lane')).toBeInTheDocument()
    expect(screen.getByTestId('version-group-judge-recommendation')).toHaveTextContent('claude v2')
    expect(screen.getByTestId('trigger-consolidation-judge-button')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-consolidation-winner-button')).toBeInTheDocument()
  })
})
