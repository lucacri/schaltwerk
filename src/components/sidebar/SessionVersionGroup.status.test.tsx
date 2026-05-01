import { act, render, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('./CompactVersionRow', async () => {
  const { useSessionCardActions } = await import('../../contexts/SessionCardActionsContext')

  return {
    CompactVersionRow: ({
      session,
      hideTreeConnector,
      siblings,
      willBeDeleted,
      isMuted,
      isSelected,
    }: {
      session: EnrichedSession
      hideTreeConnector?: boolean
      siblings?: EnrichedSession['info'][]
      willBeDeleted?: boolean
      isMuted?: boolean
      isSelected?: boolean
    }) => {
      const { onSelect } = useSessionCardActions()

      return (
        <button
          type="button"
          data-testid="compact-version-row"
          data-session-id={session.info.session_id}
          data-consolidation-role={session.info.consolidation_role ?? 'none'}
          data-hide-tree-connector={hideTreeConnector ? 'true' : 'false'}
          data-sibling-count={siblings?.length ?? 0}
          data-will-be-deleted={willBeDeleted ? 'true' : 'false'}
          data-muted={isMuted ? 'true' : 'false'}
          data-session-selected={isSelected ? 'true' : 'false'}
          onClick={() => onSelect(session.info.session_id)}
        >
          {session.info.session_id}
        </button>
      )
    },
  }
})

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
  specStage,
  clarificationStarted,
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
  specStage?: 'draft' | 'ready'
  clarificationStarted?: boolean
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
    spec_stage: specStage,
    clarification_started: clarificationStarted,
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

function createConsolidationVersion({
  id,
  versionNumber = 1,
  consolidationRole,
  consolidationRoundId = 'round-123',
  consolidationSources = ['feature-A_v1', 'feature-A_v2'],
  consolidationRecommendedSessionId,
  consolidationBaseSessionId,
  consolidationReport,
}: {
  id: string
  versionNumber?: number
  consolidationRole?: 'judge'
  consolidationRoundId?: string
  consolidationSources?: string[]
  consolidationRecommendedSessionId?: string
  consolidationBaseSessionId?: string
  consolidationReport?: string
}): SessionVersionGroupType['versions'][number] {
  const version = createVersion({ id, sessionState: 'running', versionNumber })

  return {
    ...version,
    session: {
      ...version.session,
      info: {
        ...version.session.info,
        is_consolidation: true,
        consolidation_role: consolidationRole,
        consolidation_round_id: consolidationRoundId,
        consolidation_sources: consolidationSources,
        consolidation_recommended_session_id: consolidationRecommendedSessionId,
        consolidation_base_session_id: consolidationBaseSessionId,
        consolidation_report: consolidationReport,
      },
    },
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

  it('renders a VSC chevron toggle with expanded state in the header', () => {
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

    const toggle = screen.getByTestId('version-group-toggle')
    const chevron = screen.getByTestId('version-group-chevron')

    expect(toggle).toHaveAccessibleName(/feature-A/i)
    expect(chevron).toHaveAttribute('data-expanded', 'true')

    fireEvent.click(toggle)
    expect(chevron).toHaveAttribute('data-expanded', 'false')
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

  it('does not show ready state in the group header when the active version is ready', () => {
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

    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Running')
    expect(screen.getByTestId('version-group-header-status')).not.toHaveTextContent('Ready')
  })

  it('shows clarifying in the group header for a ready spec while its terminal is running', () => {
    const readyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_spec',
          sessionState: 'spec',
          specStage: 'ready',
          clarificationStarted: true,
          attentionRequired: true,
          attentionKind: 'waiting_for_input',
        }),
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={readyGroup}
          selection={{ kind: 'session', payload: 'feature-A_spec' }}
          startIndex={0}
          isSessionRunning={(sessionId) => sessionId === 'feature-A_spec'}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Clarifying')
    expect(screen.getByTestId('version-group-header-status')).not.toHaveTextContent('Ready')
  })

  it('transitions from ready to clarifying in the group header when attention clears and isSessionRunning returns true', () => {
    const waitingGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_spec',
          sessionState: 'spec',
          specStage: 'ready',
          clarificationStarted: true,
          attentionRequired: true,
          attentionKind: 'waiting_for_input',
        }),
      ],
    }

    const { rerender } = render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={waitingGroup}
          selection={{ kind: 'session', payload: 'feature-A_spec' }}
          startIndex={0}
          isSessionRunning={() => false}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent(/waiting for input/i)

    const clearedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_spec',
          sessionState: 'spec',
          specStage: 'ready',
          clarificationStarted: true,
          attentionRequired: false,
        }),
      ],
    }

    rerender(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={clearedGroup}
          selection={{ kind: 'session', payload: 'feature-A_spec' }}
          startIndex={0}
          isSessionRunning={(sessionId) => sessionId === 'feature-A_spec'}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Clarifying')
    expect(screen.getByTestId('version-group-header-status')).not.toHaveTextContent(/waiting for input/i)
  })

  it('shows ready in the group header for a ready spec with idle attention', () => {
    const readyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_spec',
          sessionState: 'spec',
          specStage: 'ready',
          clarificationStarted: true,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={readyGroup}
          selection={{ kind: 'session', payload: 'feature-A_spec' }}
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

    const toggle = screen.getByTestId('version-group-toggle')
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

  it('renders consolidation candidate rows without the recommendation lane before a judge recommendation exists', () => {
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

    expect(screen.queryByTestId('version-group-consolidation-divider')).toBeNull()
    expect(screen.queryByTestId('version-group-consolidation-lane')).toBeNull()
    expect(within(sourceList).getAllByTestId('compact-version-row')).toHaveLength(3)
    expect(within(sourceList).getByText('feature-A-merge')).toHaveAttribute('data-hide-tree-connector', 'true')
  })

  it('surfaces a reported consolidation candidate as the initial recommendation before a judge exists', () => {
    const onConfirmConsolidationWinner = vi.fn()
    const reportedCandidateGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-123',
              consolidation_report: 'Use v1 as the base and keep v2 tests.',
              consolidation_base_session_id: 'feature-A_v1',
              consolidation_recommended_session_id: 'feature-A-merge',
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
          group={reportedCandidateGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={onConfirmConsolidationWinner}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const lane = screen.getByTestId('version-group-consolidation-lane')
    const banner = screen.getByTestId('version-group-judge-recommendation')
    expect(banner).toHaveTextContent('Judge recommends claude v1')
    expect(within(lane).getByText('feature-A-merge')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('confirm-consolidation-winner-banner-button'))

    expect(onConfirmConsolidationWinner).toHaveBeenCalledWith('round-123', 'feature-A-merge')
  })

  it('does not surface a confirm action for an implementation candidate before its judge files (regression for "no judge recommendation to confirm yet")', () => {
    const onConfirmConsolidationWinner = vi.fn()
    const implementationGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-consolidation_v1', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-consolidation_v1', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-impl',
              consolidation_role: 'candidate',
              consolidation_report: 'Implementation report from candidate v1.',
              consolidation_base_session_id: 'feature-A_v2',
              consolidation_recommended_session_id: null,
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-consolidation_v2', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-consolidation_v2', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-impl',
              consolidation_role: 'candidate',
              consolidation_report: 'Implementation report from candidate v2.',
              consolidation_base_session_id: 'feature-A_v2',
              consolidation_recommended_session_id: null,
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
          group={implementationGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={onConfirmConsolidationWinner}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    expect(screen.queryByTestId('version-group-judge-recommendation')).toBeNull()
    expect(screen.queryByTestId('confirm-consolidation-winner-banner-button')).toBeNull()
    expect(screen.queryByTestId('confirm-consolidation-winner-button')).toBeNull()
    expect(onConfirmConsolidationWinner).not.toHaveBeenCalled()
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
    expect(sourceRows).toHaveLength(3)
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
          ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_base_session_id: 'feature-A_v2',
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_recommended_session_id: 'feature-A-merge_v1',
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

  it('renders the judge recommendation banner confirm action inside the consolidation lane', () => {
    const onConfirmConsolidationWinner = vi.fn()
    const judgeOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_base_session_id: 'feature-A_v2',
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_recommended_session_id: 'feature-A-merge_v1',
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
          onConfirmConsolidationWinner={onConfirmConsolidationWinner}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const lane = screen.getByTestId('version-group-consolidation-lane')
    expect(lane).toHaveTextContent('CONSOLIDATION')
    expect(within(lane).getByTestId('version-group-judge-recommendation')).toHaveTextContent('Judge recommends claude v2')

    fireEvent.click(within(lane).getByTestId('confirm-consolidation-winner-banner-button'))
    expect(onConfirmConsolidationWinner).toHaveBeenCalledWith('round-123', 'feature-A-merge_v1')
  })

  it('labels the judge recommendation using the winning candidate base session, not the candidate version', () => {
    const judgeGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        createVersion({ id: 'feature-A_v3', sessionState: 'running', versionNumber: 3 }),
        {
          ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running', versionNumber: 1 }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running', versionNumber: 1 }).session.info,
              is_consolidation: true,
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2', 'feature-A_v3'],
              consolidation_base_session_id: 'feature-A_v2',
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2', 'feature-A_v3'],
              consolidation_recommended_session_id: 'feature-A-merge_v1',
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
          group={judgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={vi.fn()}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const banner = screen.getByTestId('version-group-judge-recommendation')
    expect(banner).toHaveTextContent('Judge recommends claude v2')
    expect(banner).not.toHaveTextContent('claude v1')
  })

  it('degrades the judge recommendation label to agent-only when the winning candidate has no base session id', () => {
    const judgeGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running', versionNumber: 1 }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running', versionNumber: 1 }).session.info,
              is_consolidation: true,
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_recommended_session_id: 'feature-A-merge_v1',
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
          group={judgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={vi.fn()}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const banner = screen.getByTestId('version-group-judge-recommendation')
    expect(banner).toHaveTextContent('Judge recommends claude')
    expect(banner).not.toHaveTextContent(/v\d/)
  })

  it('renders the active judge as a clickable consolidation row while synthesis is running', () => {
    const activeJudgeGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        createConsolidationVersion({ id: 'feature-A-merge' }),
        createConsolidationVersion({
          id: 'feature-A-judge',
          consolidationRole: 'judge',
        }),
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={activeJudgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const lane = screen.getByTestId('version-group-consolidation-lane')
    const laneRows = within(lane).getAllByTestId('compact-version-row')

    expect(laneRows).toHaveLength(2)
    expect(laneRows.map(row => row.getAttribute('data-session-id'))).toEqual(['feature-A-merge', 'feature-A-judge'])
    expect(within(lane).getByText('feature-A-judge').closest('[data-testid="compact-version-row"]')).toHaveAttribute(
      'data-consolidation-role',
      'judge',
    )
    expect(screen.getByTestId('version-group-header-status')).toHaveTextContent('Running')

    fireEvent.click(within(lane).getByText('feature-A-judge'))
    expect(mockActions.onSelect).toHaveBeenCalledWith('feature-A-judge')
  })

  it('hides the judge row after the judge files a recommendation', () => {
    const completedJudgeGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        createConsolidationVersion({
          id: 'feature-A-merge',
          consolidationBaseSessionId: 'feature-A_v2',
        }),
        createConsolidationVersion({
          id: 'feature-A-judge',
          consolidationRole: 'judge',
          consolidationRecommendedSessionId: 'feature-A-merge',
        }),
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={completedJudgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={vi.fn()}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const lane = screen.getByTestId('version-group-consolidation-lane')
    const laneRows = within(lane).getAllByTestId('compact-version-row')

    expect(laneRows).toHaveLength(1)
    expect(laneRows[0]).toHaveAttribute('data-session-id', 'feature-A-merge')
    expect(within(lane).queryByText('feature-A-judge')).toBeNull()
    expect(screen.getByTestId('version-group-judge-recommendation')).toHaveTextContent('Judge recommends claude v2')
  })

  it('places consolidation candidate rows inside the recommendation lane when a judge recommendation exists', () => {
    const recommendedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-123',
            },
            status: undefined,
            terminals: [],
          },
        },
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_recommended_session_id: 'feature-A-merge',
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
          group={recommendedGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const sourceRows = within(screen.getByTestId('version-group-source-list')).getAllByTestId('compact-version-row')
    expect(sourceRows).toHaveLength(2)
    expect(sourceRows.map(row => row.getAttribute('data-session-id'))).toEqual(['feature-A_v1', 'feature-A_v2'])

    const lane = screen.getByTestId('version-group-consolidation-lane')
    const candidateRows = within(lane).getAllByTestId('compact-version-row')
    expect(candidateRows).toHaveLength(1)
    expect(candidateRows[0]).toHaveAttribute('data-session-id', 'feature-A-merge')
  })

  it('marks source rows for deletion as soon as a consolidation candidate exists (no judge yet)', () => {
    const candidateOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-123',
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
          group={candidateOnlyGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const rows = screen.getAllByTestId('compact-version-row')
    const rowBySessionId = new Map(rows.map(row => [row.getAttribute('data-session-id'), row]))
    expect(rowBySessionId.get('feature-A_v1')).toHaveAttribute('data-will-be-deleted', 'true')
    expect(rowBySessionId.get('feature-A_v2')).toHaveAttribute('data-will-be-deleted', 'true')
    expect(rowBySessionId.get('feature-A-merge')).toHaveAttribute('data-will-be-deleted', 'false')
    expect(rowBySessionId.get('feature-A_v1')).toHaveAttribute('data-muted', 'false')
    expect(rowBySessionId.get('feature-A_v2')).toHaveAttribute('data-muted', 'false')
  })

  it('mutes source rows once a judge session exists for the round', () => {
    const judgeGroup: SessionVersionGroupType = {
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
          group={judgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const rows = screen.getAllByTestId('compact-version-row')
    const rowBySessionId = new Map(rows.map(row => [row.getAttribute('data-session-id'), row]))
    expect(rowBySessionId.get('feature-A_v1')).toHaveAttribute('data-muted', 'true')
    expect(rowBySessionId.get('feature-A_v2')).toHaveAttribute('data-muted', 'true')
    expect(rowBySessionId.get('feature-A_v1')).toHaveAttribute('data-will-be-deleted', 'true')
    expect(rowBySessionId.get('feature-A_v2')).toHaveAttribute('data-will-be-deleted', 'true')
  })

  it('derives the group header pill from the judge once a judge session exists', () => {
    const idleSourcesJudgeRunningGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_v1',
          sessionState: 'running',
          versionNumber: 1,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
        createVersion({
          id: 'feature-A_v2',
          sessionState: 'running',
          versionNumber: 2,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
        {
          ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_role: 'judge',
              consolidation_round_id: 'round-123',
              attention_required: false,
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
          group={idleSourcesJudgeRunningGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const header = screen.getByTestId('version-group-header-status')
    expect(header).toHaveTextContent('Running')
    expect(header).not.toHaveTextContent('Idle')
  })

  it('keeps the header pill derived from a completed judge after the recommendation is filed', () => {
    const completedJudgeGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_v1',
          sessionState: 'running',
          versionNumber: 1,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
        createVersion({
          id: 'feature-A_v2',
          sessionState: 'running',
          versionNumber: 2,
          attentionRequired: true,
          attentionKind: 'waiting_for_input',
        }),
        createConsolidationVersion({
          id: 'feature-A-merge',
          consolidationBaseSessionId: 'feature-A_v2',
        }),
        createConsolidationVersion({
          id: 'feature-A-judge',
          consolidationRole: 'judge',
          consolidationRecommendedSessionId: 'feature-A-merge',
          consolidationBaseSessionId: 'feature-A_v2',
        }),
      ],
    }

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={completedJudgeGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const header = screen.getByTestId('version-group-header-status')
    expect(header).toHaveTextContent('Running')
    expect(header).not.toHaveTextContent('Idle')
    expect(header).not.toHaveTextContent(/waiting for input/i)
  })

  it('keeps the header pill derived from sources when only candidates (no judge) exist', () => {
    const candidateOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({
          id: 'feature-A_v1',
          sessionState: 'running',
          versionNumber: 1,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
        createVersion({
          id: 'feature-A_v2',
          sessionState: 'running',
          versionNumber: 2,
          attentionRequired: true,
          attentionKind: 'idle',
        }),
        {
          ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }),
          session: {
            info: {
              ...createVersion({ id: 'feature-A-merge', sessionState: 'running' }).session.info,
              is_consolidation: true,
              consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
              consolidation_round_id: 'round-123',
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
          group={candidateOnlyGroup}
          selection={{ kind: 'session', payload: 'feature-A_v1' }}
          startIndex={0}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const header = screen.getByTestId('version-group-header-status')
    expect(header).toHaveTextContent('Idle')
  })
})

describe('SessionVersionGroup action busy state', () => {
  const buildJudgeGroup = (): SessionVersionGroupType => ({
    ...baseGroup,
    versions: [
      createVersion({ id: 'feature-A_v1', sessionState: 'running', versionNumber: 1 }),
      createVersion({ id: 'feature-A_v2', sessionState: 'running', versionNumber: 2 }),
      {
        ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }),
        session: {
          info: {
            ...createVersion({ id: 'feature-A-merge_v1', sessionState: 'running' }).session.info,
            is_consolidation: true,
            consolidation_round_id: 'round-123',
            consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
            consolidation_base_session_id: 'feature-A_v2',
          },
          status: undefined,
          terminals: [],
        },
      },
      {
        ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }),
        session: {
          info: {
            ...createVersion({ id: 'feature-A-judge', sessionState: 'running' }).session.info,
            is_consolidation: true,
            consolidation_role: 'judge',
            consolidation_round_id: 'round-123',
            consolidation_sources: ['feature-A_v1', 'feature-A_v2'],
            consolidation_recommended_session_id: 'feature-A-merge_v1',
          },
          status: undefined,
          terminals: [],
        },
      },
    ],
  })

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('shows a spinner on the trigger-judge button while its async callback is in flight and disables sibling action buttons', async () => {
    const deferred = createDeferred<void>()
    const onTriggerConsolidationJudge = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={buildJudgeGroup()}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTriggerConsolidationJudge={onTriggerConsolidationJudge}
          onConfirmConsolidationWinner={vi.fn(() => Promise.resolve())}
          onConsolidate={vi.fn(() => Promise.resolve())}
          onTerminateAll={vi.fn(() => Promise.resolve())}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const triggerButton = screen.getByTestId('trigger-consolidation-judge-button')
    fireEvent.click(triggerButton)

    expect(onTriggerConsolidationJudge).toHaveBeenCalledTimes(1)
    expect(within(triggerButton).getByTestId('consolidation-action-spinner')).toBeInTheDocument()
    expect(triggerButton).toBeDisabled()
    expect(screen.getByTestId('confirm-consolidation-winner-button')).toBeDisabled()
    expect(screen.getByTestId('confirm-consolidation-winner-banner-button')).toBeDisabled()

    fireEvent.click(triggerButton)
    expect(onTriggerConsolidationJudge).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    await waitFor(() => {
      expect(within(triggerButton).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
    expect(triggerButton).not.toBeDisabled()
    expect(screen.getByTestId('confirm-consolidation-winner-button')).not.toBeDisabled()
  })

  it('shows a spinner on the header confirm button and disables the banner confirm button while confirming', async () => {
    const deferred = createDeferred<void>()
    const onConfirmConsolidationWinner = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={buildJudgeGroup()}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTriggerConsolidationJudge={vi.fn(() => Promise.resolve())}
          onConfirmConsolidationWinner={onConfirmConsolidationWinner}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const headerConfirm = screen.getByTestId('confirm-consolidation-winner-button')
    fireEvent.click(headerConfirm)

    expect(onConfirmConsolidationWinner).toHaveBeenCalledWith('round-123', 'feature-A-merge_v1')
    expect(within(headerConfirm).getByTestId('consolidation-action-spinner')).toBeInTheDocument()

    const bannerConfirm = screen.getByTestId('confirm-consolidation-winner-banner-button')
    expect(bannerConfirm).toBeDisabled()
    expect(within(bannerConfirm).queryByTestId('consolidation-action-spinner')).toBeNull()
    expect(screen.getByTestId('trigger-consolidation-judge-button')).toBeDisabled()

    fireEvent.click(bannerConfirm)
    expect(onConfirmConsolidationWinner).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    await waitFor(() => {
      expect(within(headerConfirm).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
    expect(bannerConfirm).not.toBeDisabled()
  })

  it('shows a spinner on the banner confirm button while its click is in flight', async () => {
    const deferred = createDeferred<void>()
    const onConfirmConsolidationWinner = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={buildJudgeGroup()}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConfirmConsolidationWinner={onConfirmConsolidationWinner}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const bannerConfirm = screen.getByTestId('confirm-consolidation-winner-banner-button')
    fireEvent.click(bannerConfirm)

    expect(onConfirmConsolidationWinner).toHaveBeenCalledTimes(1)
    expect(within(bannerConfirm).getByTestId('consolidation-action-spinner')).toBeInTheDocument()

    const headerConfirm = screen.getByTestId('confirm-consolidation-winner-button')
    expect(headerConfirm).toBeDisabled()
    expect(within(headerConfirm).queryByTestId('consolidation-action-spinner')).toBeNull()

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    await waitFor(() => {
      expect(within(bannerConfirm).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
  })

  it('shows a spinner on the terminate-all button while its callback is in flight', async () => {
    const deferred = createDeferred<void>()
    const onTerminateAll = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTerminateAll={onTerminateAll}
          onConsolidate={vi.fn(() => Promise.resolve())}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const terminateButton = screen.getByTestId('terminate-group-button')
    fireEvent.click(terminateButton)

    expect(onTerminateAll).toHaveBeenCalledTimes(1)
    expect(within(terminateButton).getByTestId('consolidation-action-spinner')).toBeInTheDocument()
    expect(screen.getByTestId('consolidate-versions-button')).toBeDisabled()

    fireEvent.click(terminateButton)
    expect(onTerminateAll).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    await waitFor(() => {
      expect(within(terminateButton).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
  })

  it('shows a spinner on the consolidate button while its callback is in flight', async () => {
    const deferred = createDeferred<void>()
    const onConsolidate = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={baseGroup}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onConsolidate={onConsolidate}
          onTerminateAll={vi.fn(() => Promise.resolve())}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const consolidateButton = screen.getByTestId('consolidate-versions-button')
    fireEvent.click(consolidateButton)

    expect(onConsolidate).toHaveBeenCalledTimes(1)
    expect(within(consolidateButton).getByTestId('consolidation-action-spinner')).toBeInTheDocument()
    expect(screen.getByTestId('terminate-group-button')).toBeDisabled()

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    await waitFor(() => {
      expect(within(consolidateButton).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
  })

  it('clears busy state after a callback rejects so the user can retry', async () => {
    const deferred = createDeferred<void>()
    const onTriggerConsolidationJudge = vi.fn(() => deferred.promise)

    render(
      <SessionCardActionsProvider actions={mockActions}>
        <SessionVersionGroup
          group={buildJudgeGroup()}
          selection={{ kind: 'session', payload: 'unrelated' }}
          startIndex={0}
          onTriggerConsolidationJudge={onTriggerConsolidationJudge}
          {...requiredCallbacks}
        />
      </SessionCardActionsProvider>
    )

    const triggerButton = screen.getByTestId('trigger-consolidation-judge-button')
    fireEvent.click(triggerButton)
    expect(within(triggerButton).getByTestId('consolidation-action-spinner')).toBeInTheDocument()

    await act(async () => {
      deferred.reject(new Error('boom'))
      await deferred.promise.catch(() => undefined)
    })

    await waitFor(() => {
      expect(within(triggerButton).queryByTestId('consolidation-action-spinner')).toBeNull()
    })
    expect(triggerButton).not.toBeDisabled()

    fireEvent.click(triggerButton)
    expect(onTriggerConsolidationJudge).toHaveBeenCalledTimes(2)
  })
})
