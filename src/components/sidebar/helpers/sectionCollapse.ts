import type { SidebarSectionKey } from './versionGroupings'

export type SidebarSectionCollapseState = Record<SidebarSectionKey, boolean>

export const DEFAULT_SECTION_COLLAPSE_STATE: SidebarSectionCollapseState = {
    specs: false,
    running: false,
}

export const normalizeSectionCollapseState = (value: unknown): SidebarSectionCollapseState => {
    if (!value || typeof value !== 'object') {
        return DEFAULT_SECTION_COLLAPSE_STATE
    }

    const record = value as Partial<Record<SidebarSectionKey, boolean>>
    return {
        specs: record.specs === true,
        running: record.running === true,
    }
}
