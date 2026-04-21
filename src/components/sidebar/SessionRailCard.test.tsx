import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SessionRailCard } from './SessionRailCard'
import { TestProviders } from '../../tests/test-utils'
import { mockEnrichedSession } from '../../test-utils/sessionMocks'

describe('SessionRailCard', () => {
  it('shows the running indicator for spec sessions when the clarification terminal is active', () => {
    const session = mockEnrichedSession('spec-session', 'spec', false)

    const { container } = render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={true}
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(container.querySelector('.progress-dot-1')).toBeTruthy()
    expect(container.querySelector('[title="Spec"]')).toBeNull()
  })

  it('shows waiting for input for running sessions with waiting attention kind', () => {
    const session = mockEnrichedSession('waiting-session', 'running', false)
    session.info.attention_required = true
    session.info.attention_kind = 'waiting_for_input'

    render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={false}
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(screen.getByLabelText(/waiting for input/i)).toBeInTheDocument()
    expect(screen.queryByText(/idle/i)).toBeNull()
  })

  it('shows the running indicator for running sessions with stale waiting attention while live', () => {
    const session = mockEnrichedSession('live-waiting-session', 'running', false)
    session.info.attention_required = true
    session.info.attention_kind = 'waiting_for_input'

    const { container } = render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(container.querySelector('.progress-dot-1')).toBeTruthy()
    expect(screen.queryByText(/waiting for input/i)).toBeNull()
  })

  it('shows the running indicator for spec sessions with stale waiting attention while live', () => {
    const session = mockEnrichedSession('live-waiting-spec', 'spec', false)
    session.info.clarification_started = true
    session.info.attention_required = true
    session.info.attention_kind = 'waiting_for_input'

    const { container } = render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(container.querySelector('.progress-dot-1')).toBeTruthy()
    expect(screen.queryByText(/waiting for input/i)).toBeNull()
  })

  it('shows the running indicator for running sessions with stale idle attention while live', () => {
    const session = mockEnrichedSession('live-idle-session', 'running', false)
    session.info.attention_required = true
    session.info.attention_kind = 'idle'

    const { container } = render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(container.querySelector('.progress-dot-1')).toBeTruthy()
    expect(screen.queryByTitle('Idle')).toBeNull()
  })

  it('transitions from waiting for input to clarifying when spec attention clears and isRunning becomes true', () => {
    const waitingSession = mockEnrichedSession('transition-spec', 'spec', false)
    waitingSession.info.clarification_started = true
    waitingSession.info.attention_required = true
    waitingSession.info.attention_kind = 'waiting_for_input'
    waitingSession.info.spec_stage = 'ready'

    const { rerender } = render(
      <TestProviders>
        <SessionRailCard
          session={waitingSession}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={false}
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(screen.getByLabelText(/waiting for input/i)).toBeInTheDocument()

    const clearedSession = mockEnrichedSession('transition-spec', 'spec', false)
    clearedSession.info.clarification_started = true
    clearedSession.info.attention_required = undefined
    clearedSession.info.attention_kind = undefined
    clearedSession.info.spec_stage = 'ready'

    rerender(
      <TestProviders>
        <SessionRailCard
          session={clearedSession}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(screen.getByRole('button', { name: /clarifying/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /waiting for input/i })).toBeNull()
  })

  it('does not expose ready state in the collapsed rail', () => {
    const session = mockEnrichedSession('mergeable-session', 'running', true)
    session.info.ready_to_merge = true

    render(
      <TestProviders>
        <SessionRailCard
          session={session}
          index={0}
          isSelected={false}
          hasFollowUpMessage={false}
          isRunning={false}
          onSelect={vi.fn()}
        />
      </TestProviders>
    )

    expect(screen.getByRole('button')).not.toHaveAccessibleName(/ready/i)
    expect(screen.queryByTitle('Ready')).toBeNull()
  })
})
