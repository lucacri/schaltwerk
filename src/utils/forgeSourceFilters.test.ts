import { describe, it, expect } from 'vitest'
import { filterSourcesForIssues, filterSourcesForMrs } from './forgeSourceFilters'
import type { ForgeSourceConfig } from '../types/forgeTypes'

function makeSource(overrides: Partial<ForgeSourceConfig> = {}): ForgeSourceConfig {
  return {
    projectIdentifier: 'group/project',
    hostname: 'gitlab.example.com',
    label: 'Test',
    forgeType: 'gitlab',
    ...overrides,
  }
}

describe('filterSourcesForIssues', () => {
  it('keeps sources with issuesEnabled=true', () => {
    const sources = [makeSource({ issuesEnabled: true })]
    expect(filterSourcesForIssues(sources)).toHaveLength(1)
  })

  it('keeps sources with issuesEnabled=undefined (defaults to enabled)', () => {
    const sources = [makeSource()]
    expect(filterSourcesForIssues(sources)).toHaveLength(1)
  })

  it('removes sources with issuesEnabled=false', () => {
    const sources = [makeSource({ issuesEnabled: false })]
    expect(filterSourcesForIssues(sources)).toHaveLength(0)
  })

  it('filters mixed sources correctly', () => {
    const sources = [
      makeSource({ label: 'A', issuesEnabled: true }),
      makeSource({ label: 'B', issuesEnabled: false }),
      makeSource({ label: 'C' }),
    ]
    const filtered = filterSourcesForIssues(sources)
    expect(filtered.map((s) => s.label)).toEqual(['A', 'C'])
  })
})

describe('filterSourcesForMrs', () => {
  it('keeps sources with mrsEnabled=true', () => {
    const sources = [makeSource({ mrsEnabled: true })]
    expect(filterSourcesForMrs(sources)).toHaveLength(1)
  })

  it('keeps sources with mrsEnabled=undefined (defaults to enabled)', () => {
    const sources = [makeSource()]
    expect(filterSourcesForMrs(sources)).toHaveLength(1)
  })

  it('removes sources with mrsEnabled=false', () => {
    const sources = [makeSource({ mrsEnabled: false })]
    expect(filterSourcesForMrs(sources)).toHaveLength(0)
  })

  it('filters mixed sources correctly', () => {
    const sources = [
      makeSource({ label: 'A', mrsEnabled: true }),
      makeSource({ label: 'B', mrsEnabled: false }),
      makeSource({ label: 'C' }),
    ]
    const filtered = filterSourcesForMrs(sources)
    expect(filtered.map((s) => s.label)).toEqual(['A', 'C'])
  })
})
