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
