import { describe, expect, it } from 'vitest'
import { groupReferences } from './refGrouping'

describe('groupReferences', () => {
  it('promotes a Lucode-managed branch to the primary visible branch pill', () => {
    const groupedRefs = groupReferences([
      { id: 'main', name: 'main', icon: 'branch' },
      {
        id: 'lucode-session',
        name: 'lucode/history-panel',
        icon: 'branch',
        sessionAgentType: 'codex',
        sessionAgentLabel: 'Codex',
      },
      { id: 'feature', name: 'feature/other', icon: 'branch' },
    ])

    expect(groupedRefs).toHaveLength(2)
    expect(groupedRefs[0]).toMatchObject({
      id: 'lucode-session',
      name: 'lucode/history-panel',
      showDescription: true,
      sessionAgentType: 'codex',
      sessionAgentLabel: 'Codex',
    })
    expect(groupedRefs[1]).toMatchObject({
      id: 'main',
      count: 2,
      showDescription: false,
    })
  })
})
