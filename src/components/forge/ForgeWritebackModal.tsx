import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAtomValue } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { projectPathAtom } from '../../store/atoms/project'
import { projectForgeAtom } from '../../store/atoms/forge'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../types/errors'
import type { ForgeSourceConfig } from '../../types/forgeTypes'

type WritebackState = 'idle' | 'generating' | 'editing' | 'posting' | 'error'

interface ForgeWritebackModalProps {
    sessionId: string
    sessionName: string
    prNumber?: number
    prUrl?: string
    issueNumber?: number
    issueUrl?: string
    forgeSource: ForgeSourceConfig | null
    onClose: () => void
}

export function ForgeWritebackModal({
    sessionId: _sessionId,
    sessionName,
    prNumber,
    issueNumber,
    forgeSource,
    onClose,
}: ForgeWritebackModalProps) {
    const [state, setState] = useState<WritebackState>('idle')
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [target, setTarget] = useState<'pr' | 'issue'>(prNumber ? 'pr' : 'issue')
    const projectPath = useAtomValue(projectPathAtom)
    const forge = useAtomValue(projectForgeAtom)

    const hasBothTargets = Boolean(prNumber) && Boolean(issueNumber)
    const targetId = target === 'pr' ? String(prNumber) : String(issueNumber)

    const handleGenerate = useCallback(async () => {
        setState('generating')
        setError(null)
        try {
            const result = await invoke<string | null>(TauriCommands.ForgeGenerateWriteback, {
                sessionName,
                projectPath: projectPath ?? undefined,
            })
            setDraft(result ?? '')
            setState('editing')
        } catch (e) {
            logger.error('[ForgeWritebackModal] Generation failed', e)
            setError(getErrorMessage(e))
            setState('error')
        }
    }, [sessionName, projectPath])

    const handlePost = useCallback(async () => {
        if (!forgeSource || !draft.trim()) return
        setState('posting')
        setError(null)
        try {
            const command = target === 'pr'
                ? TauriCommands.ForgeCommentOnPr
                : TauriCommands.ForgeCommentOnIssue
            await invoke(command, {
                projectPath: projectPath ?? '',
                source: forgeSource,
                id: targetId,
                message: draft,
            })
            onClose()
        } catch (e) {
            logger.error('[ForgeWritebackModal] Post failed', e)
            setError(getErrorMessage(e))
            setState('editing')
        }
    }, [draft, forgeSource, target, targetId, projectPath, onClose])

    return (
        <div
            data-testid="forge-writeback-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
            <div
                className="bg-bg-primary rounded-lg border border-border-subtle shadow-xl w-[480px] max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
                    <h2
                        className="font-semibold text-text-primary"
                        style={{ fontSize: theme.fontSize.heading }}
                    >
                        Post to {forge === 'gitlab' ? 'GitLab' : 'GitHub'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-text-muted hover:text-text-primary"
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    {hasBothTargets && (
                        <div className="mb-3 flex gap-2" data-testid="target-selector">
                            <button
                                type="button"
                                onClick={() => setTarget('pr')}
                                className={`px-3 py-1 rounded text-sm ${target === 'pr' ? 'bg-bg-elevated text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
                                aria-pressed={target === 'pr'}
                            >
                                PR #{prNumber}
                            </button>
                            <button
                                type="button"
                                onClick={() => setTarget('issue')}
                                className={`px-3 py-1 rounded text-sm ${target === 'issue' ? 'bg-bg-elevated text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
                                aria-pressed={target === 'issue'}
                            >
                                Issue #{issueNumber}
                            </button>
                        </div>
                    )}

                    {state === 'idle' && (
                        <div className="text-center py-8">
                            <button
                                type="button"
                                data-testid="generate-btn"
                                onClick={() => { void handleGenerate() }}
                                className="px-4 py-2 rounded bg-bg-elevated hover:bg-bg-hover text-text-primary border border-border-subtle transition-colors"
                                style={{ fontSize: theme.fontSize.body }}
                            >
                                Generate summary
                            </button>
                            <p
                                className="mt-2 text-text-muted"
                                style={{ fontSize: theme.fontSize.caption }}
                            >
                                Uses AI to generate a summary of this session&apos;s changes
                            </p>
                        </div>
                    )}

                    {state === 'generating' && (
                        <div className="text-center py-8" data-testid="generating-state">
                            <span className="inline-block h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin text-text-muted" />
                            <p className="mt-2 text-text-muted" style={{ fontSize: theme.fontSize.body }}>
                                Generating summary...
                            </p>
                        </div>
                    )}

                    {(state === 'editing' || state === 'posting') && (
                        <div data-testid="editing-state">
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                data-testid="writeback-textarea"
                                className="w-full h-48 p-3 rounded border border-border-subtle bg-bg-secondary text-text-primary resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                style={{
                                    fontFamily: theme.fontFamily.mono,
                                    fontSize: theme.fontSize.body,
                                }}
                                disabled={state === 'posting'}
                            />
                        </div>
                    )}

                    {state === 'error' && (
                        <div data-testid="error-state" className="text-center py-6">
                            <p className="text-red-400" style={{ fontSize: theme.fontSize.body }}>
                                {error}
                            </p>
                            <button
                                type="button"
                                data-testid="retry-btn"
                                onClick={() => { void handleGenerate() }}
                                className="mt-3 px-4 py-2 rounded bg-bg-elevated hover:bg-bg-hover text-text-primary border border-border-subtle"
                                style={{ fontSize: theme.fontSize.body }}
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {error && state === 'editing' && (
                        <p className="mt-2 text-red-400" style={{ fontSize: theme.fontSize.caption }}>
                            Failed to post: {error}
                        </p>
                    )}
                </div>

                {(state === 'editing' || state === 'posting') && (
                    <div className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 rounded text-text-muted hover:text-text-primary"
                            style={{ fontSize: theme.fontSize.body }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            data-testid="post-btn"
                            onClick={() => { void handlePost() }}
                            disabled={state === 'posting' || !draft.trim()}
                            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ fontSize: theme.fontSize.body }}
                        >
                            {state === 'posting' ? 'Posting...' : 'Post'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
