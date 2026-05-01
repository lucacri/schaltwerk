import { type ReactNode } from 'react'
import { useTranslation } from '../../../common/i18n/useTranslation'
import { theme } from '../../../common/theme'
import { type Epic } from '../../../types/session'
import { SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import { groupVersionGroupsByEpic, type SidebarSectionKey } from '../helpers/versionGroupings'
import { getEpicAccentScheme } from '../../../utils/epicColors'
import { EpicGroupHeader } from '../EpicGroupHeader'
import { SidebarSectionHeader } from '../SidebarSectionHeader'

interface SidebarSectionViewProps {
    sectionKey: SidebarSectionKey
    title: string
    groups: SessionVersionGroupType[]
    collapsed: boolean
    collapsedEpicIds: Record<string, boolean>
    epicMenuOpenId: string | null
    setEpicMenuOpenId: (id: string | null) => void
    getCollapsedEpicKey: (section: SidebarSectionKey, epicId: string) => string
    onToggleEpicCollapsed: (section: SidebarSectionKey, epicId: string) => void
    onToggleSectionCollapsed: (section: SidebarSectionKey) => void
    onEditEpic: (epic: Epic) => void
    onDeleteEpic: (epic: Epic) => void
    renderVersionGroup: (group: SessionVersionGroupType) => ReactNode
}

export function SidebarSectionView({
    sectionKey,
    title,
    groups,
    collapsed,
    collapsedEpicIds,
    epicMenuOpenId,
    setEpicMenuOpenId,
    getCollapsedEpicKey,
    onToggleEpicCollapsed,
    onToggleSectionCollapsed,
    onEditEpic,
    onDeleteEpic,
    renderVersionGroup,
}: SidebarSectionViewProps) {
    const { t } = useTranslation()

    if (groups.length === 0) {
        return null
    }

    const grouping = groupVersionGroupsByEpic(groups)
    const hasEpics = grouping.epicGroups.length > 0
    const toggleLabel = collapsed
        ? (sectionKey === 'specs' ? t.sidebar.sections.expandSpecs : t.sidebar.sections.expandRunning)
        : (sectionKey === 'specs' ? t.sidebar.sections.collapseSpecs : t.sidebar.sections.collapseRunning)

    const sectionElements: ReactNode[] = []

    if (!collapsed) {
        if (!hasEpics) {
            sectionElements.push(...groups.map(renderVersionGroup))
        } else {
            for (const epicGroup of grouping.epicGroups) {
                const epic = epicGroup.epic
                const sessionCount = epicGroup.groups.reduce((acc, group) => acc + group.versions.length, 0)
                const epicCollapsed = Boolean(collapsedEpicIds[getCollapsedEpicKey(sectionKey, epic.id)])
                const countLabel = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`
                const epicScheme = getEpicAccentScheme(epic.color)

                sectionElements.push(
                    <div key={`epic-group-${sectionKey}-${epic.id}`} className="mt-2 mb-2">
                        <EpicGroupHeader
                            epic={epic}
                            collapsed={epicCollapsed}
                            countLabel={countLabel}
                            menuOpen={epicMenuOpenId === epic.id}
                            onMenuOpenChange={(open) => setEpicMenuOpenId(open ? epic.id : null)}
                            onToggleCollapsed={() => onToggleEpicCollapsed(sectionKey, epic.id)}
                            onEdit={() => onEditEpic(epic)}
                            onDelete={() => onDeleteEpic(epic)}
                        />
                        {!epicCollapsed && (
                            <div
                                className="ml-1 pl-2 pb-1"
                                style={{
                                    borderLeft: `2px solid ${epicScheme?.DEFAULT ?? 'var(--color-border-subtle)'}`,
                                    marginLeft: '6px',
                                }}
                            >
                                {epicGroup.groups.map(group => renderVersionGroup(group))}
                            </div>
                        )}
                    </div>
                )
            }

            if (grouping.ungroupedGroups.length > 0) {
                sectionElements.push(
                    <div
                        key={`ungrouped-header-${sectionKey}`}
                        data-testid="epic-ungrouped-header"
                        className="mt-4 mb-2 px-2 flex items-center gap-2"
                        style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                    >
                        <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border-subtle)' }} />
                        <span>{t.sidebar.ungrouped}</span>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border-subtle)' }} />
                    </div>
                )

                for (const group of grouping.ungroupedGroups) {
                    sectionElements.push(renderVersionGroup(group))
                }
            }
        }
    }

    return (
        <div
            key={`sidebar-section-${sectionKey}`}
            data-testid={`sidebar-section-${sectionKey}`}
            className="mt-2 first:mt-0"
        >
            <SidebarSectionHeader
                title={title}
                count={groups.length}
                collapsed={collapsed}
                toggleLabel={toggleLabel}
                onToggle={() => onToggleSectionCollapsed(sectionKey)}
            />
            {!collapsed && (
                <div className="mt-1">
                    {sectionElements}
                </div>
            )}
        </div>
    )
}
