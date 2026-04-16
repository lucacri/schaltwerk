import { atomWithStorage } from 'jotai/utils'
import { layoutStorage } from './layout'

export type SidebarViewMode = 'list' | 'board'

export const SIDEBAR_VIEW_MODES: readonly SidebarViewMode[] = ['list', 'board']

export const sidebarViewModeAtom = atomWithStorage<SidebarViewMode>(
    'schaltwerk:sidebar:viewMode',
    'list',
    layoutStorage,
    { getOnInit: true },
)
