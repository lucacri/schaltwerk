import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabMrDetail } from '../GitlabMrDetail'
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
})
