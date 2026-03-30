import { render, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionVersionGroup } from './SessionVersionGroup'
import type { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import type { EnrichedSession } from '../../types/session'

vi.mock('./SessionCard', () => ({
  SessionCard: ({ session }: { session: EnrichedSession }) => (
    <div data-testid="session-card">{session.info.session_id}</div>
  )
}))

vi.mock('./CompactVersionRow', () => ({
  CompactVersionRow: ({ session }: { session: EnrichedSession }) => (
    <div data-testid="compact-version-row">{session.info.session_id}</div>
  )
}))

function createVersion({
  id,
  attentionRequired = false,
  sessionState = 'running',
  currentTask = 'Shared task summary',
  specContent,
}: {
  id: string
  attentionRequired?: boolean
  sessionState?: 'spec' | 'running' | 'reviewed'
  currentTask?: string
  specContent?: string
}): SessionVersionGroupType['versions'][number] {
  const info: EnrichedSession['info'] = {
    session_id: id,
    display_name: id,
    version_number: 1,
    branch: `${id}-branch`,
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    session_state: sessionState,
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: false,
    attention_required: attentionRequired,
    original_agent_type: 'claude',
    current_task: currentTask,
    spec_content: specContent
  }

  return {
    versionNumber: 1,
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
    createVersion({ id: 'feature-A_v1', attentionRequired: false }),
    createVersion({ id: 'feature-A_v2', attentionRequired: true })
  ]
}

const requiredCallbacks = {
  hasFollowUpMessage: () => false,
  onSelect: vi.fn(),
  onMarkReady: vi.fn(),
  onUnmarkReady: vi.fn(),
  onCancel: vi.fn()
}

describe('SessionVersionGroup status summary', () => {
  it('shows Running as the primary group status when any version is still running', () => {
    const { getByLabelText } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(getByLabelText('Group status: Running')).toBeInTheDocument()
  })

  it('shows Reviewed as the primary group status only after all versions finish', () => {
    const reviewedGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'reviewed' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'reviewed' }),
      ]
    }

    const { getByLabelText, queryByLabelText } = render(
      <SessionVersionGroup
        group={reviewedGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(getByLabelText('Group status: Reviewed')).toBeInTheDocument()
    expect(queryByLabelText('Group status: Running')).toBeNull()
  })

  it('keeps primary status visible when collapsed', () => {
    const { getByLabelText, getByRole, getByTestId } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(getByLabelText('Group status: Running')).toBeInTheDocument()

    const statusRow = getByTestId('version-group-status')
    expect(statusRow.className).not.toContain('flex-wrap')

    const toggle = getByRole('button', { name: /feature-A/i })
    fireEvent.click(toggle)

    expect(getByLabelText('Group status: Running')).toBeVisible()
  })

  it('shows consolidate button disabled when fewer than two running/reviewed sessions exist', () => {
    const onConsolidate = vi.fn()
    const groupWithSpecs: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'spec' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'running' }),
      ],
    }

    const { getByTestId } = render(
      <SessionVersionGroup
        group={groupWithSpecs}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        onConsolidate={onConsolidate}
        {...requiredCallbacks}
      />
    )

    const button = getByTestId('consolidate-versions-button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Needs at least 2 running/reviewed sessions to consolidate')

    fireEvent.click(button)
    expect(onConsolidate).not.toHaveBeenCalled()
  })

  it('enables consolidate button when at least two running/reviewed sessions exist', () => {
    const onConsolidate = vi.fn()

    const { getByTestId } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        onConsolidate={onConsolidate}
        {...requiredCallbacks}
      />
    )

    const button = getByTestId('consolidate-versions-button')
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(onConsolidate).toHaveBeenCalledTimes(1)
  })

  it('shows terminate-all button only when running sessions exist', () => {
    const onTerminateAll = vi.fn()

    const { getByTestId, queryByTestId, rerender } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        onTerminateAll={onTerminateAll}
        {...requiredCallbacks}
      />
    )

    const terminateButton = getByTestId('terminate-group-button')
    fireEvent.click(terminateButton)
    expect(onTerminateAll).toHaveBeenCalledTimes(1)

    const reviewedOnlyGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', sessionState: 'reviewed' }),
        createVersion({ id: 'feature-A_v2', sessionState: 'spec' }),
      ],
    }

    rerender(
      <SessionVersionGroup
        group={reviewedOnlyGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        onTerminateAll={onTerminateAll}
        {...requiredCallbacks}
      />
    )

    expect(queryByTestId('terminate-group-button')).toBeNull()
  })

  it('renders shared group task description once above compact version rows', () => {
    const { getByText, getAllByTestId, queryAllByTestId } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(getByText('Shared task summary')).toBeInTheDocument()
    expect(getAllByTestId('compact-version-row')).toHaveLength(2)
    expect(queryAllByTestId('session-card')).toHaveLength(0)
  })

  it('does not render shared task summary when version descriptions differ', () => {
    const mixedTasksGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', currentTask: 'Task one' }),
        createVersion({ id: 'feature-A_v2', currentTask: 'Task two' }),
      ],
    }

    const { queryByText } = render(
      <SessionVersionGroup
        group={mixedTasksGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(queryByText('Task one')).toBeNull()
    expect(queryByText('Task two')).toBeNull()
  })

  it('does not render shared task summary when some versions have no description', () => {
    const mixedCompletenessGroup: SessionVersionGroupType = {
      ...baseGroup,
      versions: [
        createVersion({ id: 'feature-A_v1', currentTask: 'Task one' }),
        createVersion({ id: 'feature-A_v2', currentTask: '' }),
      ],
    }

    const { queryByText } = render(
      <SessionVersionGroup
        group={mixedCompletenessGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(queryByText('Task one')).toBeNull()
  })
})
