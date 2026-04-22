import type { HistoryItemRef } from './types'

interface GroupedRef extends HistoryItemRef {
  count?: number
  showDescription?: boolean
  showIconOnly?: boolean
}

export function groupReferences(refs: HistoryItemRef[]): GroupedRef[] {
  if (refs.length === 0) return []

  const branches = refs.filter(ref => ref.icon === 'branch' || !ref.icon)
  const tags = refs.filter(ref => ref.icon === 'tag')
  const remotes = refs.filter(ref => ref.icon === 'remote')
  const bases = refs.filter(ref => ref.icon === 'base')

  const result: GroupedRef[] = []
  const hasBranch = branches.length > 0

  if (hasBranch) {
    const primaryBranch = branches.find(ref => ref.sessionAgentType) ?? branches[0]
    const remainingBranches = branches.filter(ref => ref.id !== primaryBranch.id)

    result.push({
      ...primaryBranch,
      showDescription: true
    })

    if (remainingBranches.length === 1) {
      result.push({
        ...remainingBranches[0],
        showDescription: false,
        showIconOnly: true
      })
    } else if (remainingBranches.length > 1) {
      result.push({
        ...remainingBranches[0],
        count: remainingBranches.length,
        showDescription: false
      })
    }
  }

  if (tags.length > 0) {
    if (tags.length === 1) {
      result.push({
        ...tags[0],
        showDescription: !hasBranch,
        showIconOnly: hasBranch
      })
    } else {
      result.push({
        ...tags[0],
        count: tags.length,
        showDescription: false
      })
    }
  }

  if (remotes.length > 0) {
    if (remotes.length === 1) {
      result.push({
        ...remotes[0],
        showDescription: !hasBranch,
        showIconOnly: hasBranch
      })
    } else {
      result.push({
        ...remotes[0],
        count: remotes.length,
        showDescription: false
      })
    }
  }

  if (bases.length > 0) {
    if (bases.length === 1) {
      result.push({
        ...bases[0],
        showDescription: !hasBranch,
        showIconOnly: hasBranch
      })
    } else {
      result.push({
        ...bases[0],
        count: bases.length,
        showDescription: false
      })
    }
  }

  return result
}
