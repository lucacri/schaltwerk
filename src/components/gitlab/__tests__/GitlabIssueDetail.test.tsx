import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'

const emitUiEventMock = vi.fn()

vi.mock('../../../common/uiEvents', async () => {
  const actual = await vi.importActual<typeof import('../../../common/uiEvents')>('../../../common/uiEvents')
  return {
    ...actual,
    emitUiEvent: (...args: unknown[]) => emitUiEventMock(...args),
  }
})

vi.mock('../../../hooks/useContextualActions', () => ({
  useContextualActions: () => ({
    actions: [
      {
        id: 'test-spec',
        name: 'Draft Spec',
        context: 'issue',
        promptTemplate: 'Spec for: {{issue.title}}',
        mode: 'spec',
        isBuiltIn: true,
      },
    ],
    loading: false,
    error: null,
    saveActions: vi.fn(),
    resetToDefaults: vi.fn(),
    reloadActions: vi.fn(),
  }),
}))

import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabIssueDetail } from '../GitlabIssueDetail'
import { UiEvent } from '../../../common/uiEvents'
import type { GitlabIssueDetails } from '../../../types/gitlabTypes'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const mockDetails: GitlabIssueDetails = {
  iid: 42,
  title: 'Test issue',
  url: 'https://gitlab.example.com/group/project/-/issues/42',
  description: 'A test description',
  labels: [],
  state: 'opened',
  notes: [],
  sourceLabel: 'my-project',
}

describe('GitlabIssueDetail', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    emitUiEventMock.mockReset()
  })

  it('opens URL via Tauri command when clicking Open in GitLab', () => {
    renderWithProviders(
      <GitlabIssueDetail details={mockDetails} onBack={vi.fn()} />
    )

    const openButton = screen.getByText('Open in GitLab')
    fireEvent.click(openButton)

    expect(invokeMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://gitlab.example.com/group/project/-/issues/42',
    })
  })

  it('emits ContextualActionCreateSpec event when a spec-mode action is triggered', () => {
    renderWithProviders(
      <GitlabIssueDetail details={mockDetails} onBack={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Actions'))
    fireEvent.click(screen.getByText('Draft Spec'))

    expect(emitUiEventMock).toHaveBeenCalledWith(
      UiEvent.ContextualActionCreateSpec,
      {
        prompt: 'Spec for: Test issue',
        name: 'Draft Spec',
      },
    )
  })
})
