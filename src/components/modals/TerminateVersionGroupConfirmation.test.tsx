import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminateVersionGroupConfirmation } from './TerminateVersionGroupConfirmation'

describe('TerminateVersionGroupConfirmation', () => {
  it('lists running sessions and warns when any have uncommitted changes', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    const { getByText } = render(
      <TerminateVersionGroupConfirmation
        open
        baseName="feature-a"
        sessions={[
          {
            id: 'feature-a_v1',
            name: 'feature-a_v1',
            displayName: 'feature-a_v1',
            branch: 'feature-a-v1',
            hasUncommittedChanges: false,
          },
          {
            id: 'feature-a_v2',
            name: 'feature-a_v2',
            displayName: 'feature-a_v2',
            branch: 'feature-a-v2',
            hasUncommittedChanges: true,
          },
        ]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    expect(getByText('feature-a_v1')).toBeInTheDocument()
    expect(getByText('feature-a_v2')).toBeInTheDocument()
    expect(getByText('Warning: some sessions have uncommitted changes.')).toBeInTheDocument()

    fireEvent.click(getByText('Terminate All'))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(getByText('Keep Sessions'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
