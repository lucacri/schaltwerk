import { useCallback, useEffect, useMemo, useState } from 'react'
import { logger } from '../../../utils/logger'
import {
    DEFAULT_SECTION_COLLAPSE_STATE,
    normalizeSectionCollapseState,
    type SidebarSectionCollapseState,
} from '../helpers/sectionCollapse'
import type { SidebarSectionKey } from '../helpers/versionGroupings'

interface UseSidebarCollapsePersistenceResult {
    collapsedEpicIds: Record<string, boolean>
    collapsedSections: SidebarSectionCollapseState
    getCollapsedEpicKey: (section: SidebarSectionKey, epicId: string) => string
    toggleEpicCollapsed: (section: SidebarSectionKey, epicId: string) => void
    toggleSectionCollapsed: (section: SidebarSectionKey) => void
}

export function useSidebarCollapsePersistence(projectPath: string | null): UseSidebarCollapsePersistenceResult {
    const [collapsedEpicIds, setCollapsedEpicIds] = useState<Record<string, boolean>>({})
    const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(DEFAULT_SECTION_COLLAPSE_STATE)

    const epicCollapseStorageKey = useMemo(
        () => (projectPath ? `schaltwerk:epic-collapse:${projectPath}` : null),
        [projectPath],
    )
    const sectionCollapseStorageKey = useMemo(
        () => (projectPath ? `schaltwerk:sidebar-sections:${projectPath}` : null),
        [projectPath],
    )

    useEffect(() => {
        if (!epicCollapseStorageKey) {
            setCollapsedEpicIds({})
            return
        }
        try {
            const raw = localStorage.getItem(epicCollapseStorageKey)
            if (!raw) {
                setCollapsedEpicIds({})
                return
            }
            const parsed = JSON.parse(raw) as Record<string, boolean>
            setCollapsedEpicIds(parsed ?? {})
        } catch (err) {
            logger.warn('[Sidebar] Failed to load epic collapse state, resetting:', err)
            setCollapsedEpicIds({})
        }
    }, [epicCollapseStorageKey])

    useEffect(() => {
        if (!epicCollapseStorageKey) {
            return
        }
        try {
            localStorage.setItem(epicCollapseStorageKey, JSON.stringify(collapsedEpicIds))
        } catch (err) {
            logger.warn('[Sidebar] Failed to persist epic collapse state:', err)
        }
    }, [epicCollapseStorageKey, collapsedEpicIds])

    useEffect(() => {
        if (!sectionCollapseStorageKey) {
            setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
            return
        }
        try {
            const raw = localStorage.getItem(sectionCollapseStorageKey)
            if (!raw) {
                setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
                return
            }
            setCollapsedSections(normalizeSectionCollapseState(JSON.parse(raw)))
        } catch (err) {
            logger.warn('[Sidebar] Failed to load section collapse state, resetting:', err)
            setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
        }
    }, [sectionCollapseStorageKey])

    useEffect(() => {
        if (!sectionCollapseStorageKey) {
            return
        }
        try {
            localStorage.setItem(sectionCollapseStorageKey, JSON.stringify(collapsedSections))
        } catch (err) {
            logger.warn('[Sidebar] Failed to persist section collapse state:', err)
        }
    }, [sectionCollapseStorageKey, collapsedSections])

    const getCollapsedEpicKey = useCallback(
        (section: SidebarSectionKey, epicId: string) => `${section}:${epicId}`,
        [],
    )

    const toggleEpicCollapsed = useCallback((section: SidebarSectionKey, epicId: string) => {
        const key = getCollapsedEpicKey(section, epicId)
        setCollapsedEpicIds((prev) => {
            const next = { ...prev }
            if (next[key]) {
                delete next[key]
            } else {
                next[key] = true
            }
            return next
        })
    }, [getCollapsedEpicKey])

    const toggleSectionCollapsed = useCallback((section: SidebarSectionKey) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [section]: !prev[section],
        }))
    }, [])

    return {
        collapsedEpicIds,
        collapsedSections,
        getCollapsedEpicKey,
        toggleEpicCollapsed,
        toggleSectionCollapsed,
    }
}
