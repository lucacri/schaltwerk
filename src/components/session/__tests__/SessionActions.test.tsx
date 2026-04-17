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
            sessionState="running"
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
              sessionState="running"
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
              sessionState="running"
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

  it('does not render a manual reviewed action for running sessions', () => {
    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            sessionState="running"
            isReadyToMerge={true}
            sessionId="session-123"
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument()
  })

  it('does not render merge checks in sidebar actions', () => {
    const legacyReadinessProps = {
      readinessChecks: [
        { key: 'worktree_exists', passed: true },
        { key: 'no_uncommitted_changes', passed: false },
      ],
    }

    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            {...legacyReadinessProps}
            sessionState="running"
            isReadyToMerge={false}
            sessionId="session-123"
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    expect(screen.queryByText('Merge checks')).not.toBeInTheDocument()
  })

  it('does not render restart terminals alongside the remaining session controls', () => {
    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            sessionState="running"
            isReadyToMerge={true}
            sessionId="session-123"
            onReset={vi.fn()}
            onSwitchModel={vi.fn()}
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    expect(screen.getByLabelText('Reset session')).toBeInTheDocument()
    expect(screen.getByLabelText('Switch model')).toBeInTheDocument()
    expect(screen.queryByLabelText('Restart terminals')).not.toBeInTheDocument()
  })
})

describe('SessionActions – Improve Plan action', () => {
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

  function renderSpec(props: Partial<React.ComponentProps<typeof SessionActions>>) {
    const store = createStore()
    store.set(forgeBaseAtom, 'unknown')
    return render(
      <Provider store={store}>
        <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
          <GithubIntegrationContext.Provider value={noGithub}>
            <SessionActions
              sessionState="spec"
              sessionId="spec-1"
              {...props}
            />
          </GithubIntegrationContext.Provider>
        </GitlabIntegrationContext.Provider>
      </Provider>
    )
  }

  it('renders Improve Plan for clarified specs and invokes the handler', () => {
    const onImprovePlanSpec = vi.fn()
    renderSpec({ onImprovePlanSpec, canImprovePlanSpec: true, improvePlanActive: false })

    const button = screen.getByLabelText('Improve Plan') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onImprovePlanSpec).toHaveBeenCalledWith('spec-1')
  })

  it('hides the Improve Plan action for draft specs', () => {
    const onImprovePlanSpec = vi.fn()
    renderSpec({ onImprovePlanSpec, canImprovePlanSpec: false, improvePlanActive: false })

    expect(screen.queryByLabelText('Improve Plan')).not.toBeInTheDocument()
  })

  it('disables Improve Plan and does not call the handler when a round is active', () => {
    const onImprovePlanSpec = vi.fn()
    renderSpec({ onImprovePlanSpec, canImprovePlanSpec: false, improvePlanActive: true })

    const button = screen.getByLabelText('Improve Plan') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onImprovePlanSpec).not.toHaveBeenCalled()
  })

  it('shows a loading state while starting and blocks extra invocations', () => {
    const onImprovePlanSpec = vi.fn()
    renderSpec({ onImprovePlanSpec, canImprovePlanSpec: true, improvePlanStarting: true })

    const button = screen.getByLabelText('Improve Plan') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onImprovePlanSpec).not.toHaveBeenCalled()
  })

  it('does nothing when onImprovePlanSpec prop is not supplied', () => {
    renderSpec({})
    expect(screen.queryByLabelText('Improve Plan')).not.toBeInTheDocument()
  })

  it('leaves refine and run controls intact alongside Improve Plan', () => {
    const onImprovePlanSpec = vi.fn()
    const onRefineSpec = vi.fn()
    const onRunSpec = vi.fn()
    renderSpec({
      onImprovePlanSpec,
      canImprovePlanSpec: true,
      onRefineSpec,
      onRunSpec,
    })

    expect(screen.getByLabelText('Clarify spec')).toBeInTheDocument()
    expect(screen.getByLabelText('Run spec')).toBeInTheDocument()
    expect(screen.getByLabelText('Improve Plan')).toBeInTheDocument()
  })
})
