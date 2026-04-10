import { createContext, useContext, useRef, useMemo, type ReactNode } from 'react'

export interface SessionCardActions {
  onSelect: (sessionId: string) => void
  onCancel: (sessionId: string, hasUncommitted: boolean) => void
  onConvertToSpec: (sessionId: string) => void
  onRunDraft: (sessionId: string) => void
  onRefineSpec: (sessionId: string) => void
  onDeleteSpec: (sessionId: string) => void
  onReset: (sessionId: string) => void
  onRestartTerminals: (sessionId: string) => void
  onSwitchModel: (sessionId: string) => void
  onCreatePullRequest: (sessionId: string) => void
  onCreateGitlabMr: (sessionId: string) => void
  onMerge: (sessionId: string) => void
  onQuickMerge: (sessionId: string) => void
  onRename: (sessionId: string, newName: string) => Promise<void>
  onLinkPr: (sessionId: string, prNumber: number, prUrl: string) => void
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

  const stable = useMemo<SessionCardActions>(() => ({
    onSelect: (...args) => ref.current.onSelect(...args),
    onCancel: (...args) => ref.current.onCancel(...args),
    onConvertToSpec: (...args) => ref.current.onConvertToSpec(...args),
    onRunDraft: (...args) => ref.current.onRunDraft(...args),
    onRefineSpec: (...args) => ref.current.onRefineSpec(...args),
    onDeleteSpec: (...args) => ref.current.onDeleteSpec(...args),
    onReset: (...args) => ref.current.onReset(...args),
    onRestartTerminals: (...args) => ref.current.onRestartTerminals(...args),
    onSwitchModel: (...args) => ref.current.onSwitchModel(...args),
    onCreatePullRequest: (...args) => ref.current.onCreatePullRequest(...args),
    onCreateGitlabMr: (...args) => ref.current.onCreateGitlabMr(...args),
    onMerge: (...args) => ref.current.onMerge(...args),
    onQuickMerge: (...args) => ref.current.onQuickMerge(...args),
    onRename: (...args) => ref.current.onRename(...args),
    onLinkPr: (...args) => ref.current.onLinkPr(...args),
  }), [])

  return (
    <SessionCardActionsContext.Provider value={stable}>
      {children}
    </SessionCardActionsContext.Provider>
  )
}
