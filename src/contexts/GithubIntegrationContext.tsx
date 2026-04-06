import { createContext, useContext, ReactNode } from 'react'
import { GithubIntegrationValue, useGithubIntegration } from '../hooks/useGithubIntegration'

export const GithubIntegrationContext = createContext<GithubIntegrationValue | undefined>(undefined)

type StyleGuideWindow = Window & {
  __LUCODE_STYLE_GUIDE_GITHUB__?: GithubIntegrationValue
}

export function GithubIntegrationProvider({ children }: { children: ReactNode }) {
  const value = useGithubIntegration()
  return (
    <GithubIntegrationContext.Provider value={value}>
      {children}
    </GithubIntegrationContext.Provider>
  )
}

export function useGithubIntegrationContext(): GithubIntegrationValue {
  const context = useContext(GithubIntegrationContext)
  if (!context) {
    const fallback = typeof window !== 'undefined' ? (window as StyleGuideWindow).__LUCODE_STYLE_GUIDE_GITHUB__ : undefined
    if (fallback) {
      return fallback
    }
    throw new Error('useGithubIntegrationContext must be used within GithubIntegrationProvider')
  }
  return context
}
