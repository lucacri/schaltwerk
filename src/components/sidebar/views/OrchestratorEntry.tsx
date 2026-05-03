import clsx from 'clsx'
import { VscCode, VscRefresh } from 'react-icons/vsc'
import { useTranslation } from '../../../common/i18n/useTranslation'
import { IconButton } from '../../common/IconButton'
import { ProgressIndicator } from '../../common/ProgressIndicator'

interface OrchestratorEntryProps {
    isCollapsed: boolean
    isSelected: boolean
    isRunning: boolean
    isResetting: boolean
    branch: string
    shortcut: string
    onSelect: () => void
    onSwitchModel: () => void
    onReset: () => void
}

export function OrchestratorEntry({
    isCollapsed,
    isSelected,
    isRunning,
    isResetting,
    branch,
    shortcut,
    onSelect,
    onSwitchModel,
    onReset,
}: OrchestratorEntryProps) {
    const { t } = useTranslation()

    return (
        <div className={clsx('pt-1', isCollapsed ? 'px-1' : 'px-2')}>
            <div
                role="button"
                tabIndex={0}
                onClick={onSelect}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect()
                    }
                }}
                className={clsx(
                    'w-full text-left py-2 rounded-md mb-1 group border transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-bg-secondary',
                    isCollapsed ? 'px-0 justify-center flex' : 'px-3',
                    isSelected
                        ? 'bg-bg-elevated/60 session-ring session-ring-blue border-transparent'
                        : 'hover:bg-bg-hover/30 border-border-subtle',
                    isRunning && !isSelected &&
                        'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20'
                )}
                aria-label={`${t.ariaLabels.selectOrchestrator} (⌘1)`}
                aria-pressed={isSelected}
                data-onboarding="orchestrator-entry"
                data-testid="orchestrator-entry"
            >
                <div className={clsx('flex items-center w-full', isCollapsed ? 'flex-col justify-center gap-1' : 'justify-between')}>
                    {!isCollapsed && (
                        <>
                            <div className="font-medium text-text-primary flex items-center gap-2">
                                {t.sidebar.orchestrator}
                                {isRunning && (
                                    <ProgressIndicator size="sm" />
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-0.5">
                                    <IconButton
                                        icon={<VscCode />}
                                        onClick={onSwitchModel}
                                        ariaLabel="Switch orchestrator model"
                                        tooltip="Switch model (⌘P)"
                                    />
                                    <IconButton
                                        icon={<VscRefresh />}
                                        onClick={onReset}
                                        ariaLabel="Reset orchestrator"
                                        tooltip="Reset orchestrator (⌘Y)"
                                        disabled={isResetting}
                                    />
                                </div>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-bg-hover/50 text-text-tertiary">
                                    {shortcut || '⌘1'}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-accent-blue">{branch}</span>
                            </div>
                        </>
                    )}
                    {isCollapsed && (
                        <>
                            <div className="text-text-tertiary">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                            </div>
                            <span className="text-[9px] text-accent-blue font-mono max-w-full truncate">
                                {(branch === 'main' || branch === 'master') ? 'main' : (branch || 'brch')}
                            </span>
                            {isRunning && (
                                <div className="mt-1"><ProgressIndicator size="sm" /></div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
