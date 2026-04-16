import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAtomValue } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { projectPathAtom } from '../../store/atoms/project'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../types/errors'
import { theme } from '../../common/theme'

interface SessionAutoFixToggleProps {
    sessionName: string
    hasPr: boolean
}

export function SessionAutoFixToggle({ sessionName, hasPr }: SessionAutoFixToggleProps) {
    const [enabled, setEnabled] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const projectPath = useAtomValue(projectPathAtom)

    useEffect(() => {
        let cancelled = false
        void (async () => {
            try {
                const result = await invoke<boolean>(TauriCommands.SessionGetAutofix, {
                    sessionName,
                    projectPath: projectPath ?? undefined,
                })
                if (!cancelled) {
                    setEnabled(result)
                    setLoading(false)
                }
            } catch (e) {
                if (!cancelled) {
                    logger.warn('[SessionAutoFixToggle] Failed to load autofix state', e)
                    setLoading(false)
                }
            }
        })()
        return () => { cancelled = true }
    }, [sessionName, projectPath])

    const handleToggle = useCallback(async () => {
        const next = !enabled
        setEnabled(next)
        setError(null)
        try {
            await invoke(TauriCommands.SessionSetAutofix, {
                sessionName,
                enabled: next,
                projectPath: projectPath ?? undefined,
            })
        } catch (e) {
            setEnabled(!next)
            const msg = getErrorMessage(e)
            setError(msg)
            logger.error('[SessionAutoFixToggle] Failed to toggle autofix', e)
        }
    }, [enabled, sessionName, projectPath])

    if (!hasPr) return null
    if (loading) return null

    return (
        <div data-testid="autofix-toggle" className="flex items-center gap-2 px-2 py-1">
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                data-testid="autofix-switch"
                onClick={() => { void handleToggle() }}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                    enabled ? 'bg-blue-600' : 'bg-bg-elevated'
                }`}
            >
                <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                        enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
            </button>
            <span
                className="text-text-secondary"
                style={{ fontSize: theme.fontSize.caption }}
            >
                Auto-fix CI
            </span>
            {error && (
                <span
                    data-testid="autofix-error"
                    className="text-red-400"
                    style={{ fontSize: theme.fontSize.caption }}
                >
                    {error}
                </span>
            )}
        </div>
    )
}
