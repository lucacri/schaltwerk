import { EnrichedSession, type Epic } from '../../../types/session'
import { SessionVersionGroup as SessionVersionGroupType, getSessionVersionGroupAggregate } from '../../../utils/sessionVersions'

export type EpicVersionGroup = {
    epic: Epic
    groups: SessionVersionGroupType[]
}

export type EpicGroupingResult = {
    epicGroups: EpicVersionGroup[]
    ungroupedGroups: SessionVersionGroupType[]
}

export type SidebarSectionKey = 'specs' | 'running'

export const flattenVersionGroups = (sessionGroups: SessionVersionGroupType[]): EnrichedSession[] => {
    const flattenedSessions: EnrichedSession[] = []

    for (const group of sessionGroups) {
        for (const version of group.versions) {
            flattenedSessions.push(version.session)
        }
    }

    return flattenedSessions
}

export const epicForVersionGroup = (group: SessionVersionGroupType): Epic | null => {
    const epics = group.versions
        .map(version => version.session.info.epic)
        .filter(Boolean) as Epic[]

    if (epics.length === 0) {
        return null
    }

    const epicId = epics[0]?.id
    if (!epicId) {
        return null
    }

    if (!epics.every(epic => epic.id === epicId)) {
        return null
    }

    return epics[0] ?? null
}

export const groupVersionGroupsByEpic = (sessionGroups: SessionVersionGroupType[]): EpicGroupingResult => {
    const groupsByEpicId = new Map<string, EpicVersionGroup>()
    const ungroupedGroups: SessionVersionGroupType[] = []

    for (const group of sessionGroups) {
        const epic = epicForVersionGroup(group)
        if (!epic) {
            ungroupedGroups.push(group)
            continue
        }

        const existing = groupsByEpicId.get(epic.id)
        if (existing) {
            existing.groups.push(group)
        } else {
            groupsByEpicId.set(epic.id, { epic, groups: [group] })
        }
    }

    const epicGroups = [...groupsByEpicId.values()].sort((a, b) => a.epic.name.localeCompare(b.epic.name))
    return { epicGroups, ungroupedGroups }
}

export const splitVersionGroupsBySection = (
    sessionGroups: SessionVersionGroupType[],
): Record<SidebarSectionKey, SessionVersionGroupType[]> => {
    const sections: Record<SidebarSectionKey, SessionVersionGroupType[]> = {
        specs: [],
        running: [],
    }

    for (const group of sessionGroups) {
        const aggregate = getSessionVersionGroupAggregate(group)
        if (aggregate.state === 'spec') {
            sections.specs.push(group)
            continue
        }
        sections.running.push(group)
    }

    return sections
}
