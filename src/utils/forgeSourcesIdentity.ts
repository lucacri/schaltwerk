import type { ForgeSourceConfig } from '../types/forgeTypes'

export function buildForgeSourcesIdentity(sources: ForgeSourceConfig[]): string {
  if (sources.length === 0) return 'none'
  return sources
    .map(
      (source) =>
        `${source.forgeType ?? 'unknown'}::${source.hostname ?? 'default'}::${source.projectIdentifier}`
    )
    .sort()
    .join('|')
}
