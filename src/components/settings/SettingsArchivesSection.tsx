import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { TauriCommands } from '../../common/tauriCommands'
import { formatDateTime } from '../../utils/dateTime'
import { useTranslation } from '../../common/i18n/useTranslation'
import { Button, FormGroup, SectionHeader, TextInput } from '../ui'

type NotificationType = 'success' | 'error' | 'info'

type ArchivedSpec = {
    id: string
    session_name: string
    repository_path: string
    repository_name: string
    content: string
    archived_at: number | string
}

interface Props {
    onClose: () => void
    onOpenSpec: (spec: { name: string; content: string }) => void
    onNotify: (message: string, type: NotificationType) => void
}

export function SettingsArchivesSection({ onClose: _onClose, onOpenSpec, onNotify }: Props) {
    const { t } = useTranslation()
    const [archives, setArchives] = useState<ArchivedSpec[]>([])
    const [archiveMax, setArchiveMax] = useState<number>(50)
    const [archivesLoading, setArchivesLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [savingLimit, setSavingLimit] = useState(false)

    const isMountedRef = useRef(true)

    void _onClose

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    const fetchArchives = useCallback(async () => {
        if (!isMountedRef.current) {
            return
        }

        setArchivesLoading(true)
        try {
            const list = await invoke<ArchivedSpec[]>(TauriCommands.SchaltwerkCoreListArchivedSpecs)
            const max = await invoke<number>(TauriCommands.SchaltwerkCoreGetArchiveMaxEntries)

            if (isMountedRef.current) {
                setArchives(list)
                setArchiveMax(max)
                setLoadError(null)
            }
        } catch (error) {
            logger.error('Failed to load archived specs', error)
            if (isMountedRef.current) {
                setLoadError('Failed to load archived specs.')
            }
        } finally {
            if (isMountedRef.current) {
                setArchivesLoading(false)
            }
        }
    }, [])

    useEffect(() => {
        void fetchArchives()
    }, [fetchArchives])

    const handleSaveLimit = useCallback(async () => {
        if (savingLimit) return

        setSavingLimit(true)
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetArchiveMaxEntries, { limit: archiveMax })
            onNotify('Archive limit saved', 'success')
        } catch (error) {
            logger.error('Failed to save archive limit', error)
            onNotify('Failed to save archive limit', 'error')
        } finally {
            setSavingLimit(false)
        }
    }, [archiveMax, onNotify, savingLimit])

    const handleRestore = useCallback(async (spec: ArchivedSpec) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreRestoreArchivedSpec, { id: spec.id, newName: null })
            await fetchArchives()
            onNotify('Restored to specs', 'success')
        } catch (error) {
            logger.error('Failed to restore archived spec', error)
            onNotify('Failed to restore', 'error')
        }
    }, [fetchArchives, onNotify])

    const handleDelete = useCallback(async (spec: ArchivedSpec) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreDeleteArchivedSpec, { id: spec.id })
            await fetchArchives()
        } catch (error) {
            logger.error('Failed to delete archived spec', error)
            onNotify('Failed to delete', 'error')
        }
    }, [fetchArchives, onNotify])

    const archiveDisplay = useMemo(() => {
        if (archivesLoading) {
            return (
                <div className="py-6">
                    <AnimatedText text="loading" size="sm" />
                </div>
            )
        }

        if (loadError) {
            return <div className="text-body text-accent-red">{loadError}</div>
        }

        if (archives.length === 0) {
            return <div className="text-body text-text-muted">{t.settings.archives.noArchived}</div>
        }

        return (
            <div className="space-y-3 w-full">
                {archives.map(item => (
                    <div
                        key={item.id}
                        className="flex min-w-0 items-start justify-between gap-3 rounded border border-border-subtle bg-bg-elevated p-3"
                    >
                        <div
                            className="flex-1 min-w-0 overflow-hidden pr-2 cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ maxWidth: 'calc(100% - 140px)' }}
                            onClick={() => onOpenSpec({ name: item.session_name, content: item.content })}
                        >
                            <div className="truncate text-body text-text-primary">{item.session_name}</div>
                            <div className="text-caption text-text-muted">{formatDateTime(item.archived_at)}</div>
                            <div className="mt-1 max-w-full overflow-hidden break-all text-caption text-text-muted line-clamp-2">{item.content}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                                size="sm"
                                onClick={() => { void handleRestore(item) }}
                            >
                                {t.settings.common.restore}
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={() => { void handleDelete(item) }}
                            >
                                {t.settings.common.delete}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        )
    }, [archives, archivesLoading, handleDelete, handleRestore, loadError, onOpenSpec, t])

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <SectionHeader
                            title={t.settings.archives.title}
                            description={t.settings.archives.description}
                            className="border-b-0 pb-0"
                        />
                        <div className="mb-4 flex items-end gap-3">
                            <FormGroup label={t.settings.archives.maxEntries} className="w-24">
                                <TextInput
                                    type="number"
                                    value={archiveMax}
                                    onChange={(event) => {
                                        const nextValue = parseInt(event.target.value || '0', 10)
                                        setArchiveMax(Number.isNaN(nextValue) ? 0 : nextValue)
                                    }}
                                />
                            </FormGroup>
                            <Button
                                onClick={() => { void handleSaveLimit() }}
                                disabled={savingLimit}
                            >
                                {t.settings.common.save}
                            </Button>
                        </div>
                        {archiveDisplay}
                    </div>
                </div>
            </div>
        </div>
    )
}
