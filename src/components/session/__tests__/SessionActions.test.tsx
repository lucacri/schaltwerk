import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { SessionActions } from '../SessionActions'
import { GithubIntegrationContext } from '../../../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../../../hooks/useGithubIntegration'
import { GitlabIntegrationContext } from '../../../contexts/GitlabIntegrationContext'
import type { GitlabIntegrationValue } from '../../../hooks/useGitlabIntegration'
import { forgeBaseAtom, type ForgeType } from '../../../store/atoms/forge'

const pushToast = vi.fn()

vi.mock('../../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast }),
}))

vi.mock('../../../hooks/usePrComments', () => ({
  usePrComments: () => ({
    fetchingComments: false,
    fetchAndPasteToTerminal: vi.fn(),
    fetchAndCopyToClipboard: vi.fn(),
  }),
}))

const defaultGitlabValue: GitlabIntegrationValue = {
  status: null,
  sources: [],
  loading: false,
  isGlabMissing: false,
  hasSources: false,
  refreshStatus: async () => {},
  loadSources: async () => {},
  saveSources: async () => {},
}

function createGithubStore() {
  const store = createStore()
  store.set(forgeBaseAtom, 'github')
  return store
}

function renderWithGithub(value: Partial<GithubIntegrationValue>) {
  const defaultValue: GithubIntegrationValue = {
    status: {
      installed: true,
      authenticated: true,
      userLogin: 'tester',
      repository: {
        nameWithOwner: 'owner/repo',
        defaultBranch: 'main',
      },
    },
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: vi.fn(),
    connectProject: vi.fn(),
    createReviewedPr: vi.fn(),
    getCachedPrUrl: () => undefined,
    canCreatePr: true,
    isGhMissing: false,
    hasRepository: true,
    refreshStatus: vi.fn(),
  }

  const contextValue: GithubIntegrationValue = { ...defaultValue, ...value }

  return render(
    <Provider store={createGithubStore()}>
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={contextValue}>
          <SessionActions
            sessionState="reviewed"
            isReadyToMerge={true}
            sessionId="session-123"
            onCreatePullRequest={vi.fn()}
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    </Provider>
  )
}

describe('SessionActions – GitHub PR button', () => {
  it('disables the PR button when integration is not ready', () => {
    renderWithGithub({ canCreatePr: false })
    const button = screen.getByLabelText('Create pull request') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('invokes the provided PR callback', async () => {
    const onCreatePullRequest = vi.fn()
    const defaultValue: GithubIntegrationValue = {
      status: {
        installed: true,
        authenticated: true,
        userLogin: 'tester',
        repository: {
          nameWithOwner: 'owner/repo',
          defaultBranch: 'main',
        },
      },
      loading: false,
      isAuthenticating: false,
      isConnecting: false,
      isCreatingPr: () => false,
      authenticate: vi.fn(),
      connectProject: vi.fn(),
      createReviewedPr: vi.fn(),
      getCachedPrUrl: () => undefined,
      canCreatePr: true,
      isGhMissing: false,
      hasRepository: true,
      refreshStatus: vi.fn(),
    }

    render(
      <Provider store={createGithubStore()}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={defaultValue}>
            <SessionActions
              sessionState="reviewed"
              isReadyToMerge={true}
              sessionId="session-123"
              onCreatePullRequest={onCreatePullRequest}
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )

    const button = screen.getByLabelText('Create pull request')
    fireEvent.click(button)

    await waitFor(() => {
      expect(onCreatePullRequest).toHaveBeenCalledWith('session-123')
    })
  })

  it('disables the PR button when callback is missing', () => {
    const defaultValue = {
      canCreatePr: true,
      isGhMissing: false,
      hasRepository: true,
    } as unknown as GithubIntegrationValue

    render(
      <Provider store={createGithubStore()}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={defaultValue}>
            <SessionActions
              sessionState="reviewed"
              isReadyToMerge={true}
              sessionId="session-123"
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )

    const button = screen.getByLabelText('Create pull request') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('SessionActions – Running state', () => {
  const mockGithub = {
    canCreatePr: true,
    isGhMissing: false,
    hasRepository: true,
  } as unknown as GithubIntegrationValue

  it('shows quick merge button when onQuickMerge is provided', () => {
    const onQuickMerge = vi.fn()
    render(
      <Provider store={createGithubStore()}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={mockGithub}>
            <SessionActions
              sessionState="running"
              isReadyToMerge={false}
              sessionId="session-123"
              onQuickMerge={onQuickMerge}
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )

    const button = screen.getByLabelText('Quick merge session')
    expect(button).toBeInTheDocument()
    fireEvent.click(button)
    expect(onQuickMerge).toHaveBeenCalledWith('session-123')
  })

  it('does not show quick merge button when onQuickMerge is missing', () => {
    render(
      <Provider store={createGithubStore()}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={mockGithub}>
            <SessionActions
              sessionState="running"
              isReadyToMerge={false}
              sessionId="session-123"
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )

    const button = screen.queryByLabelText('Quick merge session')
    expect(button).not.toBeInTheDocument()
  })
})

describe('SessionActions – Forge button visibility', () => {
  const mockGithub: GithubIntegrationValue = {
    status: {
      installed: true,
      authenticated: true,
      userLogin: 'tester',
      repository: { nameWithOwner: 'owner/repo', defaultBranch: 'main' },
    },
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: vi.fn(),
    connectProject: vi.fn(),
    createReviewedPr: vi.fn(),
    getCachedPrUrl: () => undefined,
    canCreatePr: true,
    isGhMissing: false,
    hasRepository: true,
    refreshStatus: vi.fn(),
  }

  function renderWithForge(forgeType: ForgeType) {
    const store = createStore()
    store.set(forgeBaseAtom, forgeType)
    return render(
      <Provider store={store}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={mockGithub}>
            <SessionActions
              sessionState="running"
              sessionId="session-forge"
              onCreatePullRequest={vi.fn()}
              onCreateGitlabMr={vi.fn()}
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )
  }

  it('shows GitHub button when forge is github', () => {
    renderWithForge('github')
    expect(screen.getByLabelText('Create pull request')).toBeInTheDocument()
    expect(screen.queryByLabelText('Create GitLab merge request')).not.toBeInTheDocument()
  })

  it('shows GitLab button when forge is gitlab', () => {
    renderWithForge('gitlab')
    expect(screen.getByLabelText('Create GitLab merge request')).toBeInTheDocument()
    expect(screen.queryByLabelText('Create pull request')).not.toBeInTheDocument()
  })

  it('shows no forge button when forge is unknown', () => {
    renderWithForge('unknown')
    expect(screen.queryByLabelText('Create pull request')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Create GitLab merge request')).not.toBeInTheDocument()
  })
})
