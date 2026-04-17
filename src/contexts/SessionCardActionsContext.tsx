import { createContext, useContext, useRef, useMemo, type ReactNode } from 'react'

export interface SessionCardActions {
  onSelect: (sessionId: string) => void
  onCancel: (sessionId: string, hasUncommitted: boolean) => void
  onConvertToSpec: (sessionId: string) => void
  onRunDraft: (sessionId: string) => void
  onRefineSpec: (sessionId: string) => void
  onDeleteSpec: (sessionId: string) => void
  onImprovePlanSpec: (sessionId: string) => void
  improvePlanStartingSessionId?: string | null
  onReset: (sessionId: string) => void
  onSwitchModel: (sessionId: string) => void
  onCreatePullRequest: (sessionId: string) => void
  onCreateGitlabMr: (sessionId: string) => void
  onMerge: (sessionId: string) => void
  onQuickMerge: (sessionId: string) => void
  onRename: (sessionId: string, newName: string) => Promise<void>
  onLinkPr: (sessionId: string, prNumber: number, prUrl: string) => void
  onPostToForge: (sessionId: string) => void
}

const SessionCardActionsContext = createContext<SessionCardActions | null>(null)

export function useSessionCardActions(): SessionCardActions {
  const ctx = useContext(SessionCardActionsContext)
  if (!ctx) throw new Error('useSessionCardActions must be used within SessionCardActionsProvider')
  return ctx
}

interface ProviderProps {
  actions: SessionCardActions
  children: ReactNode
}

export function SessionCardActionsProvider({ actions, children }: ProviderProps) {
  const ref = useRef(actions)
  ref.current = actions

  const stableCallbacks = useMemo(() => ({
    onSelect: (...args: Parameters<SessionCardActions['onSelect']>) => ref.current.onSelect(...args),
    onCancel: (...args: Parameters<SessionCardActions['onCancel']>) => ref.current.onCancel(...args),
    onConvertToSpec: (...args: Parameters<SessionCardActions['onConvertToSpec']>) => ref.current.onConvertToSpec(...args),
    onRunDraft: (...args: Parameters<SessionCardActions['onRunDraft']>) => ref.current.onRunDraft(...args),
    onRefineSpec: (...args: Parameters<SessionCardActions['onRefineSpec']>) => ref.current.onRefineSpec(...args),
    onDeleteSpec: (...args: Parameters<SessionCardActions['onDeleteSpec']>) => ref.current.onDeleteSpec(...args),
    onImprovePlanSpec: (...args: Parameters<SessionCardActions['onImprovePlanSpec']>) => ref.current.onImprovePlanSpec(...args),
    onReset: (...args: Parameters<SessionCardActions['onReset']>) => ref.current.onReset(...args),
    onSwitchModel: (...args: Parameters<SessionCardActions['onSwitchModel']>) => ref.current.onSwitchModel(...args),
    onCreatePullRequest: (...args: Parameters<SessionCardActions['onCreatePullRequest']>) => ref.current.onCreatePullRequest(...args),
    onCreateGitlabMr: (...args: Parameters<SessionCardActions['onCreateGitlabMr']>) => ref.current.onCreateGitlabMr(...args),
    onMerge: (...args: Parameters<SessionCardActions['onMerge']>) => ref.current.onMerge(...args),
    onQuickMerge: (...args: Parameters<SessionCardActions['onQuickMerge']>) => ref.current.onQuickMerge(...args),
    onRename: (...args: Parameters<SessionCardActions['onRename']>) => ref.current.onRename(...args),
    onLinkPr: (...args: Parameters<SessionCardActions['onLinkPr']>) => ref.current.onLinkPr(...args),
    onPostToForge: (...args: Parameters<SessionCardActions['onPostToForge']>) => ref.current.onPostToForge(...args),
  }), [])

  const stable = useMemo<SessionCardActions>(() => ({
    ...stableCallbacks,
    improvePlanStartingSessionId: actions.improvePlanStartingSessionId ?? null,
  }), [stableCallbacks, actions.improvePlanStartingSessionId])

  return (
    <SessionCardActionsContext.Provider value={stable}>
      {children}
    </SessionCardActionsContext.Provider>
  )
}
