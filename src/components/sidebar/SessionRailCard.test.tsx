import { render } from '@testing-library/react'
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
})
