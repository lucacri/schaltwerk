import clsx from 'clsx'
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc'
import { useTranslation } from '../../../common/i18n/useTranslation'
import type { SidebarViewMode } from '../../../store/atoms/sidebarViewMode'

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
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        void setSidebarViewMode(sidebarViewMode === 'board' ? 'list' : 'board')
                    }}
                    data-testid="sidebar-view-mode-toggle"
                    className="h-6 px-2 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors text-[11px] uppercase tracking-wider"
                    title={sidebarViewMode === 'board' ? 'Switch to list view' : 'Switch to board view'}
                    aria-label={sidebarViewMode === 'board' ? 'Switch to list view' : 'Switch to board view'}
                    aria-pressed={sidebarViewMode === 'board'}
                >
                    {sidebarViewMode === 'board' ? 'Board' : 'List'}
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
