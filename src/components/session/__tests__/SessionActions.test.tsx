import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { SessionActions } from '../SessionActions'
import { GithubIntegrationContext } from '../../../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../../../hooks/useGithubIntegration'
import { GitlabIntegrationContext } from '../../../contexts/GitlabIntegrationContext'
import type { GitlabIntegrationValue } from '../../../hooks/useGitlabIntegration'
import { forgeBaseAtom } from '../../../store/atoms/forge'
import type { ForgeType } from '../../../store/atoms/forge'

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
  sourcesLoaded: true,
  isGlabMissing: false,
  hasSources: false,
  refreshStatus: async () => {},
  loadSources: async () => {},
  saveSources: async () => {},
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

  const store = createStore()
  store.set(forgeBaseAtom, 'github')

  return render(
    <Provider store={store}>
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

    const store = createStore()
    store.set(forgeBaseAtom, 'github')

    render(
      <Provider store={store}>
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

    const store = createStore()
    store.set(forgeBaseAtom, 'github')

    render(
      <Provider store={store}>
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

function renderWithForge(forgeType: ForgeType, github: GithubIntegrationValue, gitlab: GitlabIntegrationValue, props?: Partial<React.ComponentProps<typeof SessionActions>>) {
  const store = createStore()
  store.set(forgeBaseAtom, forgeType)
  return render(
    <Provider store={store}>
      <GitlabIntegrationContext.Provider value={gitlab}>
        <GithubIntegrationContext.Provider value={github}>
          <SessionActions
            sessionState="running"
            sessionId="s1"
            onCreatePullRequest={vi.fn()}
            onCreateGitlabMr={vi.fn()}
            {...props}
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    </Provider>
  )
}

describe('SessionActions – forge-aware buttons', () => {
  const noGithub: GithubIntegrationValue = {
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

  it('hides both forge buttons when forge is unknown', () => {
    renderWithForge('unknown', noGithub, defaultGitlabValue)

    expect(screen.queryByLabelText('Create pull request')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Create GitLab merge request')).not.toBeInTheDocument()
  })

  it('shows GitHub button and hides GitLab when forge is github', () => {
    const github: GithubIntegrationValue = {
      status: { installed: true, authenticated: true, userLogin: 'u', repository: { nameWithOwner: 'o/r', defaultBranch: 'main' } },
      loading: false, isAuthenticating: false, isConnecting: false,
      isCreatingPr: () => false, authenticate: vi.fn(), connectProject: vi.fn(),
      createReviewedPr: vi.fn(), getCachedPrUrl: () => undefined,
      canCreatePr: true, isGhMissing: false, hasRepository: true, refreshStatus: vi.fn(),
    }

    renderWithForge('github', github, defaultGitlabValue)

    expect(screen.getByLabelText('Create pull request')).toBeInTheDocument()
    expect(screen.queryByLabelText('Create GitLab merge request')).not.toBeInTheDocument()
  })

  it('shows GitLab button and hides GitHub when forge is gitlab', () => {
    const gitlab: GitlabIntegrationValue = {
      ...defaultGitlabValue,
      sources: [{ id: '1', label: 'Backend', projectPath: 'group/backend', hostname: 'gitlab.example.com', issuesEnabled: true, mrsEnabled: true, pipelinesEnabled: false }],
      hasSources: true,
    }

    renderWithForge('gitlab', noGithub, gitlab)

    expect(screen.queryByLabelText('Create pull request')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Create GitLab merge request')).toBeInTheDocument()
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
    )

    const button = screen.getByLabelText('Quick merge session')
    expect(button).toBeInTheDocument()
    fireEvent.click(button)
    expect(onQuickMerge).toHaveBeenCalledWith('session-123')
  })

  it('does not show quick merge button when onQuickMerge is missing', () => {
    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            sessionState="running"
            isReadyToMerge={false}
            sessionId="session-123"
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    const button = screen.queryByLabelText('Quick merge session')
    expect(button).not.toBeInTheDocument()
  })
})
