import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { typography } from '../../common/typography'
import { theme } from '../../common/theme'
import { TauriCommands } from '../../common/tauriCommands'
import { useTranslation } from '../../common/i18n'
import { UiEvent, listenUiEvent, emitUiEvent, type NewSessionPrefillDetail } from '../../common/uiEvents'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { promptToSessionName } from '../../utils/promptToSessionName'
import { getPersistedSessionDefaults, type PersistedSessionDefaults } from '../../utils/sessionConfig'
import { useModal } from '../../contexts/ModalContext'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'
import { useFavorites } from '../../hooks/useFavorites'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { FavoriteCard } from '../shared/FavoriteCard'
import { ResizableModal } from '../shared/ResizableModal'
import { Button, FormGroup, TextInput } from '../ui'
import { MarkdownEditor, type MarkdownEditorRef } from '../specs/MarkdownEditor'
import { Dropdown } from '../inputs/Dropdown'
import { logger } from '../../utils/logger'
import type { AgentLaunchSlot } from '../../types/agentLaunch'
import type { AgentType } from '../../types/session'
import {
    SPEC_FAVORITE_ID,
    buildFavoriteOptions,
    type FavoriteOption,
} from './newSession/favoriteOptions'
import {
    BuildCreatePayloadError,
    buildCreatePayload,
    createEmptyAdvancedState,
    type AdvancedSessionState,
    type CreateSessionPayload,
    type PassthroughPrefillState,
} from './newSession/buildCreatePayload'
import { NewSessionAdvancedPanel } from './newSession/NewSessionAdvancedPanel'

export { SPEC_FAVORITE_ID }

interface Props {
    open: boolean
    initialIsDraft?: boolean
    cachedPrompt?: string
    onPromptChange?: (prompt: string) => void
    onClose: () => void
    onCreate: (data: CreateSessionPayload & {
        agentSlots?: AgentLaunchSlot[]
        agentTypes?: AgentType[]
        agentType?: AgentType
    }) => void | Promise<void>
}

const MODAL_STORAGE_KEY = 'new-session-modal'
const VERSION_COUNTS = [1, 2, 3, 4] as const

function buildVersionItems() {
    return VERSION_COUNTS.map(count => ({
        key: String(count),
        label: `${count}x version${count === 1 ? '' : 's'}`,
    }))
}

export function NewSessionModal({
    open,
    initialIsDraft: _initialIsDraft = false,
    cachedPrompt = '',
    onPromptChange,
    onClose,
    onCreate,
}: Props) {
    const modalId = MODAL_STORAGE_KEY
    const { registerModal, unregisterModal } = useModal()
    const { t } = useTranslation()
    const { isAvailable } = useAgentAvailability({ autoLoad: open })
    const { presets } = useAgentPresets()
    const { enabledAgents } = useEnabledAgents()
    const { favoriteOrder } = useFavorites()
    const projectFileIndex = useProjectFileIndex()

    const [name, setName] = useState<string>(() => generateDockerStyleName())
    const [userEditedName, setUserEditedName] = useState(false)
    const [prompt, setPrompt] = useState<string>(cachedPrompt)
    const [selectedFavoriteId, setSelectedFavoriteId] = useState<string>(SPEC_FAVORITE_ID)
    const [versionCount, setVersionCount] = useState<number>(1)
    const [customSettingsOpen, setCustomSettingsOpen] = useState(false)
    const [advanced, setAdvanced] = useState<AdvancedSessionState>(createEmptyAdvancedState)
    const [versionMenuOpen, setVersionMenuOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [generatingName, setGeneratingName] = useState(false)
    const [validationError, setValidationError] = useState<string>('')
    const [persistedDefaults, setPersistedDefaults] = useState<PersistedSessionDefaults>({
        baseBranch: '',
        agentType: 'claude',
    })
    const [passthrough, setPassthrough] = useState<PassthroughPrefillState>({})

    const markdownEditorRef = useRef<MarkdownEditorRef>(null)
    const nameInputRef = useRef<HTMLInputElement>(null)
    const lastGeneratedNameRef = useRef<string>('')
    const cachedPromptRef = useRef<string>(cachedPrompt)
    const promptRef = useRef<string>(cachedPrompt)
    const onPromptChangeRef = useRef(onPromptChange)
    cachedPromptRef.current = cachedPrompt
    onPromptChangeRef.current = onPromptChange

    const favoriteOptions = useMemo<FavoriteOption[]>(
        () =>
            buildFavoriteOptions({
                presets,
                enabledAgents,
                isAvailable,
                presetOrder: favoriteOrder,
            }),
        [presets, enabledAgents, isAvailable, favoriteOrder],
    )

    const selectedFavorite = useMemo<FavoriteOption>(() => {
        const found = favoriteOptions.find(option => option.id === selectedFavoriteId)
        return found ?? favoriteOptions[0] ?? {
            kind: 'spec',
            id: SPEC_FAVORITE_ID,
            title: 'Spec only',
            summary: 'Prompt-only setup',
            accentColor: 'var(--color-border-strong)',
            disabled: false,
        }
    }, [favoriteOptions, selectedFavoriteId])

    const versionItems = useMemo(buildVersionItems, [])
    const isRawAgentSelection = selectedFavorite.kind === 'agent'
    const isSpecSelection = selectedFavorite.kind === 'spec'

    useEffect(() => {
        if (!open) return
        registerModal(modalId)
        return () => {
            unregisterModal(modalId)
        }
    }, [open, modalId, registerModal, unregisterModal])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        getPersistedSessionDefaults()
            .then(defaults => {
                if (!cancelled) setPersistedDefaults(defaults)
            })
            .catch(err => {
                logger.warn('[NewSessionModal] Failed to load persisted session defaults', err)
            })
        return () => {
            cancelled = true
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const initial = generateDockerStyleName()
        const initialPrompt = cachedPromptRef.current
        setName(initial)
        lastGeneratedNameRef.current = initial
        setUserEditedName(false)
        setPrompt(initialPrompt)
        promptRef.current = initialPrompt
        setValidationError('')
        setCreating(false)
        setGeneratingName(false)
        setCustomSettingsOpen(false)
        setAdvanced(createEmptyAdvancedState())
        setVersionCount(1)
        setPassthrough({})
        setSelectedFavoriteId(SPEC_FAVORITE_ID)
        requestAnimationFrame(() => {
            markdownEditorRef.current?.focusEnd()
        })
    }, [open])

    useEffect(() => {
        if (!open) return
        if (favoriteOptions.length === 0) return
        const stillExists = favoriteOptions.some(option => option.id === selectedFavoriteId)
        if (!stillExists) {
            setSelectedFavoriteId(favoriteOptions[0].id)
        }
    }, [open, favoriteOptions, selectedFavoriteId])

    useEffect(() => {
        if (!open) return
        const unsubscribe = listenUiEvent(UiEvent.NewSessionPrefill, (detail: NewSessionPrefillDetail | undefined) => {
            if (!detail) return
            if (typeof detail.name === 'string' && detail.name.length > 0) {
                setName(detail.name)
                setUserEditedName(true)
                lastGeneratedNameRef.current = detail.name
            }
            if (typeof detail.taskContent === 'string') {
                setPrompt(detail.taskContent)
                promptRef.current = detail.taskContent
                onPromptChangeRef.current?.(detail.taskContent)
            }
            if (detail.presetId) {
                setSelectedFavoriteId(detail.presetId)
            } else if (detail.agentType) {
                const matchingAgent = favoriteOptions.find(
                    option => option.kind === 'agent' && option.agentType === detail.agentType,
                )
                if (matchingAgent) {
                    setSelectedFavoriteId(matchingAgent.id)
                }
            }
            setPassthrough(current => ({
                ...current,
                ...(detail.issueNumber !== undefined ? { issueNumber: detail.issueNumber } : {}),
                ...(detail.issueUrl !== undefined ? { issueUrl: detail.issueUrl } : {}),
                ...(detail.prNumber !== undefined ? { prNumber: detail.prNumber } : {}),
                ...(detail.prUrl !== undefined ? { prUrl: detail.prUrl } : {}),
                ...(detail.epicId !== undefined ? { epicId: detail.epicId } : {}),
                ...(detail.versionGroupId !== undefined ? { versionGroupId: detail.versionGroupId } : {}),
                ...(detail.isConsolidation !== undefined ? { isConsolidation: detail.isConsolidation } : {}),
                ...(detail.consolidationSourceIds !== undefined ? { consolidationSourceIds: detail.consolidationSourceIds } : {}),
                ...(detail.consolidationRoundId !== undefined ? { consolidationRoundId: detail.consolidationRoundId } : {}),
                ...(detail.consolidationRole !== undefined ? { consolidationRole: detail.consolidationRole } : {}),
                ...(detail.consolidationConfirmationMode !== undefined ? { consolidationConfirmationMode: detail.consolidationConfirmationMode } : {}),
            }))
        })
        return unsubscribe
    }, [open, favoriteOptions])

    const handlePromptChange = useCallback((next: string) => {
        setPrompt(next)
        promptRef.current = next
        onPromptChangeRef.current?.(next)
        if (!userEditedName) {
            const generated = promptToSessionName(next) || generateDockerStyleName()
            setName(generated)
            lastGeneratedNameRef.current = generated
        }
    }, [userEditedName])

    const handleNameChange = useCallback((value: string) => {
        setName(value)
        if (value !== lastGeneratedNameRef.current) {
            setUserEditedName(true)
        }
    }, [])

    const resolvedAgentType: AgentType = selectedFavorite.kind === 'agent'
        ? selectedFavorite.agentType
        : persistedDefaults.agentType
    const canGenerateName = prompt.trim().length > 0

    const handleGenerateName = useCallback(async () => {
        if (generatingName) return
        const content = promptRef.current.trim()
        if (!content) return
        setGeneratingName(true)
        try {
            const generated = await invoke<string | null>(
                TauriCommands.SchaltwerkCoreGenerateSessionName,
                { content, agentType: resolvedAgentType },
            )
            if (generated && generated.trim().length > 0) {
                const value = generated.trim()
                setName(value)
                lastGeneratedNameRef.current = value
                setUserEditedName(true)
            }
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to generate name:', error)
        } finally {
            setGeneratingName(false)
        }
    }, [generatingName, resolvedAgentType])

    const handleSelectFavorite = useCallback((option: FavoriteOption) => {
        if (option.disabled) return
        setSelectedFavoriteId(option.id)
        if (option.kind !== 'agent') {
            setVersionCount(1)
            setAdvanced(current => ({ ...current, multiAgentAllocations: {} }))
        }
        if (option.kind === 'spec') {
            setCustomSettingsOpen(false)
        }
    }, [])

    const handleCreate = useCallback(async () => {
        setValidationError('')
        try {
            const payload = buildCreatePayload({
                selection: selectedFavorite,
                name,
                prompt,
                userEditedName,
                baseBranch: persistedDefaults.baseBranch,
                advanced,
                versionCount,
                passthrough,
            })
            setCreating(true)
            await Promise.resolve(onCreate(payload))
            setCreating(false)
        } catch (error) {
            if (error instanceof BuildCreatePayloadError) {
                setValidationError(error.message)
            } else if (error instanceof Error) {
                setValidationError(error.message)
                logger.error('[NewSessionModal] Create failed', error)
            } else {
                setValidationError('Unknown error occurred')
                logger.error('[NewSessionModal] Create failed with unknown error', error)
            }
            setCreating(false)
        }
    }, [
        selectedFavorite,
        name,
        prompt,
        userEditedName,
        persistedDefaults.baseBranch,
        advanced,
        versionCount,
        onCreate,
        passthrough,
    ])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            const isMeta = event.metaKey || event.ctrlKey
            if (!isMeta) return
            if (event.key === 'Enter') {
                event.preventDefault()
                void handleCreate()
                return
            }
            if (/^[1-9]$/.test(event.key)) {
                const index = Number(event.key) - 1
                const target = favoriteOptions[index]
                if (target) {
                    event.preventDefault()
                    handleSelectFavorite(target)
                }
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, favoriteOptions, handleCreate, handleSelectFavorite])

    const title = (
        <div className="flex flex-col gap-1">
            <span style={{ ...typography.bodyLarge, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                Start New Agent
            </span>
            <span style={{ ...typography.caption, color: 'var(--color-text-secondary)' }}>
                Primary creation flow
            </span>
        </div>
    )

    const selectedVersionKey = String(versionCount)
    const onOpenAgentSettings = useCallback(() => {
        emitUiEvent(UiEvent.OpenSettings, { tab: 'agentConfiguration' })
    }, [])

    const footer = (
        <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
                <Dropdown
                    open={versionMenuOpen && isRawAgentSelection}
                    onOpenChange={setVersionMenuOpen}
                    items={versionItems}
                    selectedKey={selectedVersionKey}
                    onSelect={(key) => {
                        const next = Number(key)
                        if (!Number.isNaN(next)) setVersionCount(next)
                        setVersionMenuOpen(false)
                    }}
                    align="left"
                >
                    {({ toggle }) => (
                        <button
                            type="button"
                            data-testid="version-selector-button"
                            disabled={!isRawAgentSelection}
                            onClick={toggle}
                            className="inline-flex h-[32px] min-w-[140px] items-center justify-between gap-2 rounded-md border px-3"
                            style={{
                                ...typography.body,
                                backgroundColor: 'var(--color-bg-elevated)',
                                borderColor: 'var(--color-border-default)',
                                color: 'var(--color-text-primary)',
                                opacity: isRawAgentSelection ? 1 : 0.55,
                                cursor: isRawAgentSelection ? 'pointer' : 'not-allowed',
                            }}
                        >
                            <span>{versionCount}x version{versionCount === 1 ? '' : 's'}</span>
                            <span aria-hidden style={{ color: 'var(--color-text-secondary)' }}>⌄</span>
                        </button>
                    )}
                </Dropdown>
                {!isSpecSelection && (
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={customSettingsOpen}
                        onClick={() => setCustomSettingsOpen(open => !open)}
                    >
                        {customSettingsOpen ? 'Hide custom settings' : 'Custom settings…'}
                    </Button>
                )}
            </div>
            <div className="flex items-center gap-3">
                <Button variant="default" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={() => void handleCreate()} loading={creating}>
                    Create
                </Button>
            </div>
        </div>
    )

    return (
        <ResizableModal
            isOpen={open}
            onClose={onClose}
            title={title}
            storageKey={MODAL_STORAGE_KEY}
            defaultWidth={720}
            defaultHeight={620}
            minWidth={560}
            minHeight={480}
            footer={footer}
        >
            <div data-testid="new-session-modal-body" className="flex h-full min-h-0 flex-col gap-4 p-5">
                <FormGroup
                    label="Agent Name"
                    htmlFor="new-session-name"
                    help="Auto-generated from the prompt until you edit it"
                    error={validationError || undefined}
                >
                    <TextInput
                        id="new-session-name"
                        aria-label="Agent Name"
                        ref={nameInputRef}
                        value={name}
                        onChange={(event) => handleNameChange(event.target.value)}
                        rightElement={
                            <button
                                type="button"
                                data-testid="generate-name-button"
                                onClick={() => { void handleGenerateName() }}
                                disabled={generatingName || !canGenerateName}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded ${generatingName || !canGenerateName ? 'cursor-not-allowed opacity-40' : 'hover:bg-[rgba(var(--color-bg-hover-rgb),0.45)]'}`}
                                title={generatingName ? t.newSessionModal.tooltips.generatingName : t.newSessionModal.tooltips.generateName}
                            >
                                {generatingName ? (
                                    <span
                                        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                                        style={{ borderColor: 'var(--color-text-secondary)', borderTopColor: 'transparent' }}
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}>
                                        <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" /><path d="M11 6.2 9.7 5" /><path d="M11 11.8 9.7 13" /><path d="M8 15h2c4.7 0 4.7 4 0 4H4c-.5 0-1-.2-1-.5S2 17 4 17c5 0 3 4 0 4" />
                                    </svg>
                                )}
                            </button>
                        }
                    />
                </FormGroup>

                <section
                    aria-label="Favorites"
                    data-testid="favorite-carousel"
                    className="flex shrink-0 flex-wrap gap-2 pb-1"
                >
                    {favoriteOptions.map(option => (
                        <div key={option.id} style={{ width: 160 }}>
                            <FavoriteCard
                                title={option.title}
                                summary={option.summary}
                                accentColor={option.accentColor}
                                shortcut={option.shortcut}
                                disabled={option.disabled}
                                selected={option.id === selectedFavorite.id}
                                onClick={() => handleSelectFavorite(option)}
                            />
                        </div>
                    ))}
                </section>

                {customSettingsOpen && !isSpecSelection && (
                    <NewSessionAdvancedPanel
                        selection={selectedFavorite}
                        value={advanced}
                        onChange={setAdvanced}
                        onOpenAgentSettings={onOpenAgentSettings}
                        isAgentAvailable={isAvailable}
                    />
                )}

                <div className="flex flex-col gap-2 min-h-0 flex-1">
                    <div
                        className="flex items-center justify-between"
                        style={{ ...typography.caption, color: 'var(--color-text-secondary)' }}
                    >
                        <span>Prompt / Content</span>
                    </div>
                    <div
                        className="flex-1 min-h-[220px] rounded-md border"
                        style={{
                            backgroundColor: 'var(--color-bg-primary)',
                            borderColor: 'var(--color-border-default)',
                            fontFamily: theme.fontFamily.mono,
                        }}
                    >
                        <MarkdownEditor
                            ref={markdownEditorRef}
                            value={prompt}
                            onChange={handlePromptChange}
                            placeholder="# Describe what you want the agent to do…"
                            fileReferenceProvider={projectFileIndex}
                            ariaLabel="Prompt and context"
                        />
                    </div>
                    <span style={{ ...typography.caption, color: 'var(--color-text-muted)' }}>
                        Markdown content accepts file references, issue prompts, and PR context.
                    </span>
                </div>
            </div>
        </ResizableModal>
    )
}
