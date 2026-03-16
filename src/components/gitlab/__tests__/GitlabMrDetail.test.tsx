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
        id: 'test-review',
        name: 'Test Review',
        context: 'mr',
        promptTemplate: 'Review: {{mr.title}}',
        mode: 'session',
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
import { GitlabMrDetail } from '../GitlabMrDetail'
import { UiEvent } from '../../../common/uiEvents'
import type { GitlabMrDetails } from '../../../types/gitlabTypes'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const mockDetails: GitlabMrDetails = {
  iid: 10,
  title: 'Test MR',
  url: 'https://gitlab.example.com/group/project/-/merge_requests/10',
  description: 'MR description',
  labels: [],
  state: 'opened',
  sourceBranch: 'feature-branch',
  targetBranch: 'main',
  mergeStatus: null,
  pipelineStatus: null,
  pipelineUrl: null,
  notes: [],
  reviewers: [],
  sourceLabel: 'my-project',
}

describe('GitlabMrDetail', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    emitUiEventMock.mockReset()
  })

  it('opens URL via Tauri command when clicking Open in GitLab', () => {
    renderWithProviders(
      <GitlabMrDetail
        details={mockDetails}
        onBack={vi.fn()}
        onRefreshPipeline={vi.fn()}
        sourceProject="group/project"
      />
    )

    const openButton = screen.getByText('Open in GitLab')
    fireEvent.click(openButton)

    expect(invokeMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://gitlab.example.com/group/project/-/merge_requests/10',
    })
  })

  it('opens pipeline URL via Tauri command when pipeline link is clicked', () => {
    const detailsWithPipeline: GitlabMrDetails = {
      ...mockDetails,
      pipelineStatus: 'success',
      pipelineUrl: 'https://gitlab.example.com/group/project/-/pipelines/123',
    }

    renderWithProviders(
      <GitlabMrDetail
        details={detailsWithPipeline}
        onBack={vi.fn()}
        onRefreshPipeline={vi.fn()}
        sourceProject="group/project"
      />
    )

    const pipelineLink = screen.getByText('Passed')
    fireEvent.click(pipelineLink.closest('a')!)

    expect(invokeMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://gitlab.example.com/group/project/-/pipelines/123',
    })
  })

  it('emits ContextualActionCreateSession event when a session-mode action is triggered', () => {
    renderWithProviders(
      <GitlabMrDetail
        details={mockDetails}
        onBack={vi.fn()}
        onRefreshPipeline={vi.fn()}
        sourceProject="group/project"
      />
    )

    fireEvent.click(screen.getByText('Actions'))
    fireEvent.click(screen.getByText('Test Review'))

    expect(emitUiEventMock).toHaveBeenCalledWith(
      UiEvent.ContextualActionCreateSession,
      expect.objectContaining({
        prompt: 'Review: Test MR',
        actionName: 'Test Review',
      }),
    )
  })
})
