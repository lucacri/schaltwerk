import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { sidebarViewModeAtom, SIDEBAR_VIEW_MODES } from './sidebarViewMode'

describe('sidebarViewModeAtom', () => {
    beforeEach(() => {
        try {
            window.localStorage.clear()
            window.sessionStorage.clear()
        } catch {
            // ignore in non-browser environments
        }
    })

    it('defaults to list view', () => {
        const store = createStore()
        expect(store.get(sidebarViewModeAtom)).toBe('list')
    })

    it('can be toggled to board view and back', () => {
        const store = createStore()
        void store.set(sidebarViewModeAtom, 'board')
        expect(store.get(sidebarViewModeAtom)).toBe('board')

        void store.set(sidebarViewModeAtom, 'list')
        expect(store.get(sidebarViewModeAtom)).toBe('list')
    })

    it('persists to localStorage under the schaltwerk:sidebar:viewMode key', () => {
        const store = createStore()
        void store.set(sidebarViewModeAtom, 'board')

        const raw = window.localStorage.getItem('schaltwerk:sidebar:viewMode')
        expect(raw).toBe(JSON.stringify('board'))
    })

    it('SIDEBAR_VIEW_MODES enumerates both modes', () => {
        expect(SIDEBAR_VIEW_MODES).toEqual(['list', 'board'])
    })
})
