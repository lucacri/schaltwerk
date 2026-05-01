import { useCallback, useMemo } from 'react'
import {
    flattenVersionGroups,
    groupVersionGroupsByEpic,
    splitVersionGroupsBySection,
    type SidebarSectionKey,
} from '../helpers/versionGroupings'
import { groupSessionsByVersion, SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import type { EnrichedSession } from '../../../types/session'
import type { SidebarSectionCollapseState } from '../helpers/sectionCollapse'

interface UseSidebarSectionedSessionsParams {
    sessions: EnrichedSession[]
    collapsedSections: SidebarSectionCollapseState
    collapsedEpicIds: Record<string, boolean>
    getCollapsedEpicKey: (section: SidebarSectionKey, epicId: string) => string
}

interface UseSidebarSectionedSessionsResult {
    sectionGroups: Record<SidebarSectionKey, SessionVersionGroupType[]>
    flattenedSessions: EnrichedSession[]
    selectionScopedSessions: EnrichedSession[]
}

export function useSidebarSectionedSessions({
    sessions,
    collapsedSections,
    collapsedEpicIds,
    getCollapsedEpicKey,
}: UseSidebarSectionedSessionsParams): UseSidebarSectionedSessionsResult {
    const versionGroups = useMemo(() => groupSessionsByVersion(sessions), [sessions])
    const sectionGroups = useMemo(() => splitVersionGroupsBySection(versionGroups), [versionGroups])

    const getVisibleGroupsForSection = useCallback((section: SidebarSectionKey, groups: SessionVersionGroupType[]) => {
        const sectionGrouping = groupVersionGroupsByEpic(groups)
        const expandedEpicGroups = sectionGrouping.epicGroups.flatMap((group) => (
            collapsedEpicIds[getCollapsedEpicKey(section, group.epic.id)] ? [] : group.groups
        ))
        return [...expandedEpicGroups, ...sectionGrouping.ungroupedGroups]
    }, [collapsedEpicIds, getCollapsedEpicKey])

    const visibleSpecGroups = useMemo(
        () => getVisibleGroupsForSection('specs', sectionGroups.specs),
        [getVisibleGroupsForSection, sectionGroups.specs],
    )
    const visibleRunningGroups = useMemo(
        () => getVisibleGroupsForSection('running', sectionGroups.running),
        [getVisibleGroupsForSection, sectionGroups.running],
    )

    const flattenedSessions = useMemo(() => {
        const visibleGroups: SessionVersionGroupType[] = []
        if (!collapsedSections.specs) {
            visibleGroups.push(...visibleSpecGroups)
        }
        if (!collapsedSections.running) {
            visibleGroups.push(...visibleRunningGroups)
        }
        return flattenVersionGroups(visibleGroups)
    }, [collapsedSections, visibleRunningGroups, visibleSpecGroups])

    const selectionScopedSessions = useMemo(
        () => [...flattenVersionGroups(visibleSpecGroups), ...flattenVersionGroups(visibleRunningGroups)],
        [visibleSpecGroups, visibleRunningGroups],
    )

    return { sectionGroups, flattenedSessions, selectionScopedSessions }
}
