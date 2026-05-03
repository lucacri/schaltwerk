import clsx from 'clsx'
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc'
import { useTranslation } from '../../../common/i18n/useTranslation'

// Phase 8 W.1: sidebarViewMode atom retired. Kanban toggle is a static
// disabled affordance; the prop type stays so the existing SidebarHeaderBar
// shape is preserved (Sidebar.tsx hardcodes `'list'`).
type SidebarViewMode = 'list' | 'board'

interface SidebarHeaderBarProps {
    isCollapsed: boolean
    sidebarViewMode: SidebarViewMode
    setSidebarViewMode: (mode: SidebarViewMode) => void | Promise<void>
    leftSidebarShortcut: string
    onToggleSidebar?: () => void
}

export function SidebarHeaderBar({
    isCollapsed,
    sidebarViewMode,
    setSidebarViewMode,
    leftSidebarShortcut,
    onToggleSidebar,
}: SidebarHeaderBarProps) {
    const { t } = useTranslation()

    return (
        <div className={clsx('flex items-center shrink-0 h-9', isCollapsed ? 'justify-center px-0' : 'justify-between px-2 pt-2')}>
            {!isCollapsed && (
                <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider ml-1">{t.sidebar.header}</span>
            )}
            {!isCollapsed && (
                // Phase 7 close-out: kanban (board) view is disabled during
                // the v2 cutover — the kanban renderer still renders sessions
                // (not tasks), so leaving it active would silently break for
                // the new task surface. The toggle stays visible as a
                // disabled affordance so users see where the view returns.
                <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    onClick={(e) => {
                        e.stopPropagation()
                        // Force list mode if the persisted value is stale.
                        if (sidebarViewMode !== 'list') {
                            void setSidebarViewMode('list')
                        }
                    }}
                    data-testid="sidebar-view-mode-toggle"
                    className="h-6 px-2 flex items-center justify-center rounded text-text-tertiary text-[11px] uppercase tracking-wider opacity-60 cursor-not-allowed"
                    title="Kanban view returns in v2.1 — list view is the recommended task surface during the v2 transition."
                    aria-label="Kanban view disabled during v2 transition; list view is the recommended task surface"
                >
                    List · Board v2.1
                </button>
            )}
            {onToggleSidebar && (
                <div className="flex items-center gap-2">
                    {!isCollapsed && leftSidebarShortcut && (
                        <span className="text-[11px] text-text-muted" aria-hidden="true">
                            {leftSidebarShortcut}
                        </span>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggleSidebar()
                        }}
                        className={clsx(
                            "h-6 w-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors",
                            !isCollapsed && "ml-auto"
                        )}
                        title={isCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                        aria-label={isCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                    >
                        {isCollapsed ? <VscLayoutSidebarLeftOff /> : <VscLayoutSidebarLeft />}
                    </button>
                </div>
            )}
        </div>
    )
}
