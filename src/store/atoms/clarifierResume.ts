import { atom } from 'jotai'

export const clarifierResumedSpecsAtom = atom<ReadonlySet<string>>(new Set<string>())

export const markClarifierResumedAtom = atom(null, (get, set, sessionId: string) => {
    const current = get(clarifierResumedSpecsAtom)
    if (current.has(sessionId)) return
    const next = new Set(current)
    next.add(sessionId)
    set(clarifierResumedSpecsAtom, next)
})

export const clearClarifierResumedAtom = atom(null, (get, set, sessionId: string) => {
    const current = get(clarifierResumedSpecsAtom)
    if (!current.has(sessionId)) return
    const next = new Set(current)
    next.delete(sessionId)
    set(clarifierResumedSpecsAtom, next)
})
