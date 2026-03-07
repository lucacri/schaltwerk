import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { useForgeType } from './useForgeType'
import { GithubIntegrationContext } from '../contexts/GithubIntegrationContext'
import { GitlabIntegrationContext } from '../contexts/GitlabIntegrationContext'
import type { GithubIntegrationValue } from './useGithubIntegration'
import type { GitlabIntegrationValue } from './useGitlabIntegration'

const baseGithub: GithubIntegrationValue = {
  status: null,
  loading: false,
  isAuthenticating: false,
  isConnecting: false,
  isCreatingPr: () => false,
  authenticate: vi.fn(),
  connectProject: vi.fn(),
  createReviewedPr: vi.fn(),
  getCachedPrUrl: () => undefined,
  canCreatePr: false,
  isGhMissing: false,
  hasRepository: false,
  refreshStatus: vi.fn(),
}

const baseGitlab: GitlabIntegrationValue = {
  status: null,
  sources: [],
  loading: false,
  isGlabMissing: false,
  hasSources: false,
  refreshStatus: vi.fn(),
  loadSources: vi.fn(),
  saveSources: vi.fn(),
}

function renderForgeType(github: Partial<GithubIntegrationValue>, gitlab: Partial<GitlabIntegrationValue>) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(GithubIntegrationContext.Provider, { value: { ...baseGithub, ...github } },
      createElement(GitlabIntegrationContext.Provider, { value: { ...baseGitlab, ...gitlab } }, children)
    )

  return renderHook(() => useForgeType(), { wrapper })
}

describe('useForgeType', () => {
  it('returns github when hasRepository and no gitlab sources', () => {
    const { result } = renderForgeType({ hasRepository: true }, { hasSources: false })
    expect(result.current).toBe('github')
  })

  it('returns gitlab when hasSources and no github repository', () => {
    const { result } = renderForgeType({ hasRepository: false }, { hasSources: true })
    expect(result.current).toBe('gitlab')
  })

  it('returns unknown when neither has integration', () => {
    const { result } = renderForgeType({ hasRepository: false }, { hasSources: false })
    expect(result.current).toBe('unknown')
  })

  it('returns unknown when both have integrations', () => {
    const { result } = renderForgeType({ hasRepository: true }, { hasSources: true })
    expect(result.current).toBe('unknown')
  })
})
