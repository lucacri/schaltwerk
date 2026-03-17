import React, { useEffect, useMemo } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { RunProvider } from '../contexts/RunContext'
import { ModalProvider } from '../contexts/ModalContext'
import { ToastProvider } from '../common/toast/ToastProvider'
import { GithubIntegrationContext } from '../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../hooks/useGithubIntegration'
import { GitlabIntegrationContext } from '../contexts/GitlabIntegrationContext'
import type { GitlabIntegrationValue } from '../hooks/useGitlabIntegration'
import { ForgeIntegrationContext, type ForgeIntegrationContextValue } from '../contexts/ForgeIntegrationContext'
import type { ChangedFile } from '../common/events'
import { Provider, createStore, useSetAtom } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'
import {
  initializeSelectionEventsActionAtom,
  resetSelectionAtomsForTest,
  setProjectPathActionAtom,
} from '../store/atoms/selection'
import {
  initializeSessionsEventsActionAtom,
  initializeSessionsSettingsActionAtom,
  refreshSessionsActionAtom,
  __resetSessionsTestingState,
} from '../store/atoms/sessions'
import { __resetTerminalAtomsForTest } from '../store/atoms/terminal'

type GithubOverrides = Partial<GithubIntegrationValue>

function createGithubIntegrationValue(overrides?: GithubOverrides): GithubIntegrationValue {
  const unimplemented = (method: string) => async () => {
    throw new Error(
      `GithubIntegration mock "${method}" not configured. Provide githubOverrides when using renderWithProviders/TestProviders.`
    )
  }

  const base: GithubIntegrationValue = {
    status: null,
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: unimplemented('authenticate'),
    connectProject: unimplemented('connectProject'),
    createReviewedPr: unimplemented('createReviewedPr'),
    getCachedPrUrl: () => undefined,
    canCreatePr: false,
    isGhMissing: false,
    hasRepository: false,
    refreshStatus: async () => {},
  }

  return overrides ? { ...base, ...overrides } : base
}

type GitlabOverrides = Partial<GitlabIntegrationValue>

function createGitlabIntegrationValue(overrides?: GitlabOverrides): GitlabIntegrationValue {
  const unimplemented = (method: string) => async () => {
    throw new Error(
      `GitlabIntegration mock "${method}" not configured. Provide gitlabOverrides when using renderWithProviders/TestProviders.`
    )
  }

  const base: GitlabIntegrationValue = {
    status: null,
    sources: [],
    loading: false,
    sourcesLoaded: true,
    isGlabMissing: false,
    hasSources: false,
    refreshStatus: async () => {},
    loadSources: async () => {},
    saveSources: unimplemented('saveSources'),
  }

  return overrides ? { ...base, ...overrides } : base
}

type ForgeOverrides = Partial<ForgeIntegrationContextValue>

function createForgeIntegrationValue(overrides?: ForgeOverrides): ForgeIntegrationContextValue {
  const unimplemented = (method: string) => async () => {
    throw new Error(
      `ForgeIntegration mock "${method}" not configured. Provide forgeOverrides when using renderWithProviders/TestProviders.`
    )
  }

  const base: ForgeIntegrationContextValue = {
    status: null,
    loading: false,
    forgeType: 'unknown',
    sources: [],
    hasRepository: false,
    hasSources: false,
    refreshStatus: async () => {},
    searchIssues: unimplemented('searchIssues') as ForgeIntegrationContextValue['searchIssues'],
    getIssueDetails: unimplemented('getIssueDetails') as ForgeIntegrationContextValue['getIssueDetails'],
    searchPrs: unimplemented('searchPrs') as ForgeIntegrationContextValue['searchPrs'],
    getPrDetails: unimplemented('getPrDetails') as ForgeIntegrationContextValue['getPrDetails'],
    createSessionPr: unimplemented('createSessionPr') as ForgeIntegrationContextValue['createSessionPr'],
    getReviewComments: unimplemented('getReviewComments') as ForgeIntegrationContextValue['getReviewComments'],
    approvePr: unimplemented('approvePr') as ForgeIntegrationContextValue['approvePr'],
    mergePr: unimplemented('mergePr') as ForgeIntegrationContextValue['mergePr'],
    commentOnPr: unimplemented('commentOnPr') as ForgeIntegrationContextValue['commentOnPr'],
  }

  return overrides ? { ...base, ...overrides } : base
}

function ForgeIntegrationTestProvider({
  overrides,
  children,
}: {
  overrides?: ForgeOverrides
  children: React.ReactNode
}) {
  const value = useMemo(() => createForgeIntegrationValue(overrides), [overrides])
  return (
    <ForgeIntegrationContext.Provider value={value}>
      {children}
    </ForgeIntegrationContext.Provider>
  )
}

function GitlabIntegrationTestProvider({
  overrides,
  children,
}: {
  overrides?: GitlabOverrides
  children: React.ReactNode
}) {
  const value = useMemo(() => createGitlabIntegrationValue(overrides), [overrides])
  return (
    <GitlabIntegrationContext.Provider value={value}>
      {children}
    </GitlabIntegrationContext.Provider>
  )
}

function GithubIntegrationTestProvider({
  overrides,
  children,
}: {
  overrides?: GithubOverrides
  children: React.ReactNode
}) {
  const value = useMemo(() => createGithubIntegrationValue(overrides), [overrides])
  return (
    <GithubIntegrationContext.Provider value={value}>
      {children}
    </GithubIntegrationContext.Provider>
  )
}

interface ProviderTreeProps {
  children: React.ReactNode
  githubOverrides?: GithubOverrides
  gitlabOverrides?: GitlabOverrides
  forgeOverrides?: ForgeOverrides
  includeTestInitializer?: boolean
}

function ProviderTree({ children, githubOverrides, gitlabOverrides, forgeOverrides, includeTestInitializer = false }: ProviderTreeProps) {
  const store = useMemo(() => createStore(), [])

  const inner = (
    <FocusProvider>
      <ReviewProvider>
        <RunProvider>
          <ForgeIntegrationTestProvider overrides={forgeOverrides}>
            <GithubIntegrationTestProvider overrides={githubOverrides}>
              <GitlabIntegrationTestProvider overrides={gitlabOverrides}>
                {children}
              </GitlabIntegrationTestProvider>
            </GithubIntegrationTestProvider>
          </ForgeIntegrationTestProvider>
        </RunProvider>
      </ReviewProvider>
    </FocusProvider>
  )

  const content = includeTestInitializer ? (
    <SelectionTestInitializer>
      <TestProjectInitializer>{inner}</TestProjectInitializer>
    </SelectionTestInitializer>
  ) : (
    inner
  )

  return (
    <Provider store={store}>
      <ToastProvider>
        <ModalProvider>
          {content}
        </ModalProvider>
      </ToastProvider>
    </Provider>
  )
}

interface RenderWithProvidersOptions extends RenderOptions {
  githubOverrides?: GithubOverrides
  gitlabOverrides?: GitlabOverrides
  forgeOverrides?: ForgeOverrides
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const { githubOverrides, gitlabOverrides, forgeOverrides, ...renderOptions } = options
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ProviderTree githubOverrides={githubOverrides} gitlabOverrides={gitlabOverrides} forgeOverrides={forgeOverrides}>{children}</ProviderTree>
  )
  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

// Component to set project path for tests
function TestProjectInitializer({ children }: { children: React.ReactNode }) {
  const setProjectPath = useSetAtom(projectPathAtom)

  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
  }, [setProjectPath])

  return <>{children}</>
}

function SelectionTestInitializer({ children }: { children: React.ReactNode }) {
  const initializeSelectionEvents = useSetAtom(initializeSelectionEventsActionAtom)
  const setSelectionProjectPath = useSetAtom(setProjectPathActionAtom)
  const initializeSessionsEvents = useSetAtom(initializeSessionsEventsActionAtom)
  const initializeSessionsSettings = useSetAtom(initializeSessionsSettingsActionAtom)
  const refreshSessions = useSetAtom(refreshSessionsActionAtom)

  useEffect(() => {
    void initializeSelectionEvents()
    void setSelectionProjectPath('/test/project')
    void initializeSessionsEvents()
    void initializeSessionsSettings()
    void refreshSessions()

    return () => {
      resetSelectionAtomsForTest()
      __resetSessionsTestingState()
      __resetTerminalAtomsForTest()
    }
  }, [
    initializeSelectionEvents,
    setSelectionProjectPath,
    initializeSessionsEvents,
    initializeSessionsSettings,
    refreshSessions,
  ])

  return <>{children}</>
}

export function TestProviders({
  children,
  githubOverrides,
  gitlabOverrides,
  forgeOverrides,
}: {
  children: React.ReactNode
  githubOverrides?: GithubOverrides
  gitlabOverrides?: GitlabOverrides
  forgeOverrides?: ForgeOverrides
}) {
  return (
    <ProviderTree githubOverrides={githubOverrides} gitlabOverrides={gitlabOverrides} forgeOverrides={forgeOverrides} includeTestInitializer>
      {children}
    </ProviderTree>
  )
}

export function createChangedFile(
  file: Partial<ChangedFile> & { path: string }
): ChangedFile {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return {
    path: file.path,
    change_type: file.change_type ?? 'modified',
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    is_binary: file.is_binary,
  }
}
