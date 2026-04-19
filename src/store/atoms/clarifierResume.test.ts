import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai'
import {
    clarifierResumedSpecsAtom,
    markClarifierResumedAtom,
    clearClarifierResumedAtom,
} from './clarifierResume'

describe('clarifierResumedSpecsAtom', () => {
    it('starts empty', () => {
        const store = createStore()
        expect(store.get(clarifierResumedSpecsAtom).size).toBe(0)
    })

    it('adds a session via markClarifierResumedAtom', () => {
        const store = createStore()
        store.set(markClarifierResumedAtom, 'spec-1')
        expect(store.get(clarifierResumedSpecsAtom).has('spec-1')).toBe(true)
    })

    it('does not duplicate identical entries', () => {
        const store = createStore()
        store.set(markClarifierResumedAtom, 'spec-1')
        const first = store.get(clarifierResumedSpecsAtom)
        store.set(markClarifierResumedAtom, 'spec-1')
        const second = store.get(clarifierResumedSpecsAtom)
        expect(first).toBe(second)
    })

    it('removes a session via clearClarifierResumedAtom', () => {
        const store = createStore()
        store.set(markClarifierResumedAtom, 'spec-1')
        store.set(clearClarifierResumedAtom, 'spec-1')
        expect(store.get(clarifierResumedSpecsAtom).has('spec-1')).toBe(false)
    })

    it('clearing a session that was never marked is a no-op', () => {
        const store = createStore()
        const before = store.get(clarifierResumedSpecsAtom)
        store.set(clearClarifierResumedAtom, 'spec-unknown')
        const after = store.get(clarifierResumedSpecsAtom)
        expect(after).toBe(before)
    })
})
