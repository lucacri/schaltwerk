import type { ForgeSourceConfig } from '../types/forgeTypes'

export function filterSourcesForIssues(sources: ForgeSourceConfig[]): ForgeSourceConfig[] {
  return sources.filter((s) => s.issuesEnabled !== false)
}

export function filterSourcesForMrs(sources: ForgeSourceConfig[]): ForgeSourceConfig[] {
  return sources.filter((s) => s.mrsEnabled !== false)
}
