import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { TauriCommands } from '../../common/tauriCommands'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { promptToSessionName } from '../../utils/promptToSessionName'
import { titleToSessionName } from '../../utils/titleToSessionName'
import { invoke } from '@tauri-apps/api/core'
import { SessionConfigurationPanel } from '../shared/SessionConfigurationPanel'
import { getPersistedSessionDefaults } from '../../utils/sessionConfig'
import { Dropdown } from '../inputs/Dropdown'
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS, createAgentRecord } from '../../types/session'
import { UiEvent, listenUiEvent, NewSessionPrefillDetail } from '../../common/uiEvents'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import {
    AgentCliArgsState,
    AgentEnvVar,
    AgentEnvVarState,
    createEmptyCliArgsState,
    createEmptyEnvVarState,
    displayNameForAgent,
} from '../shared/agentDefaults'
import { AgentDefaultsSection } from '../shared/AgentDefaultsSection'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { MarkdownEditor, type MarkdownEditorRef } from '../specs/MarkdownEditor'
import { ResizableModal } from '../shared/ResizableModal'
import { UnifiedSearchModal } from './UnifiedSearchModal'
import { FormGroup, TextInput } from '../ui'
import type { GithubIssueSelectionResult, GithubPrSelectionResult } from '../../types/githubIssues'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { FALLBACK_CODEX_MODELS, getCodexModelMetadata } from '../../common/codexModels'
import { loadCodexModelCatalog, CodexModelCatalog } from '../../services/codexModelCatalog'
import { EpicSelect } from '../shared/EpicSelect'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useFavorites } from '../../hooks/useFavorites'
import type { AgentVariant } from '../../types/agentVariant'
import type { AgentLaunchSlot } from '../../types/agentLaunch'
import { useEpics } from '../../hooks/useEpics'
import { FavoriteCard } from '../shared/FavoriteCard'
import { CustomizeAccordion } from '../shared/CustomizeAccordion'
import {
    MAX_VERSION_COUNT,
    MULTI_AGENT_TYPES,
    VERSION_DROPDOWN_ITEMS,
    MultiAgentAllocationDropdown,
    type MultiAgentAllocations,
    sumAllocations,
    normalizeAllocations,
} from './MultiAgentAllocationDropdown'

const SESSION_NAME_ALLOWED_PATTERN = /^[\p{L}\p{M}\p{N}_\- ]+$/u

export const SPEC_FAVORITE_ID = '__schaltwerk_spec__'
export const CUSTOM_FAVORITE_ID = '__schaltwerk_custom__'
const QUICK_MODE_IDS: ReadonlySet<string> = new Set([SPEC_FAVORITE_ID, CUSTOM_FAVORITE_ID])

function isQuickModeId(id: string | null): boolean {
    return id !== null && QUICK_MODE_IDS.has(id)
}

type AgentPreferenceField = 'model' | 'reasoningEffort'

interface AgentPreferenceState {
    model?: string
    reasoningEffort?: string
}

interface FavoriteConfigSnapshot {
    createAsDraft: boolean
    baseBranch: string
    customBranch: string
    useExistingBranch: boolean
    agentType: AgentType
    skipPermissions: boolean
    autonomyEnabled: boolean
    versionCount: number
    multiAgentMode: boolean
    multiAgentAllocations: MultiAgentAllocations
    selectedVariantId: string | null
    selectedPresetId: string | null
    presetTabActive: boolean
    agentEnvVars: AgentEnvVarState
    agentCliArgs: AgentCliArgsState
    agentPreferences: Record<AgentType, AgentPreferenceState>
}

const createEmptyPreferenceState = () =>
    createAgentRecord<AgentPreferenceState>(() => ({ model: '', reasoningEffort: '' }))

const favoriteConfigSignature = (config: FavoriteConfigSnapshot): string => JSON.stringify(config)

function favoriteAccentColor(agentType: AgentType | null): string {
    switch (agentType) {
        case 'claude':
            return 'var(--color-accent-blue)'
        case 'codex':
            return 'var(--color-accent-violet)'
        case 'gemini':
            return 'var(--color-accent-amber)'
        case 'copilot':
            return 'var(--color-accent-copilot)'
        case 'droid':
            return 'var(--color-accent-green)'
        case 'qwen':
            return 'var(--color-accent-purple)'
        case 'amp':
            return 'var(--color-accent-magenta)'
        case 'kilocode':
            return 'var(--color-accent-red)'
        case 'terminal':
            return 'var(--color-border-strong)'
        case 'opencode':
        default:
            return 'var(--color-accent-cyan)'
    }
}

function favoriteShortcutLabel(index: number): string {
    return `⌘${index + 1}`
}

function isBranchValidationError(errorMessage: string): boolean {
    return errorMessage.includes('Branch') || errorMessage.includes('worktree')
}

interface Props {
    open: boolean
    initialIsDraft?: boolean
    cachedPrompt?: string
    onPromptChange?: (prompt: string) => void
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        customBranch?: string
        useExistingBranch?: boolean
        syncWithOrigin?: boolean
        userEditedName?: boolean
        isSpec?: boolean
        draftContent?: string
        versionCount?: number
        agentType?: AgentType
        agentTypes?: AgentType[]
        agentSlots?: AgentLaunchSlot[]
        skipPermissions?: boolean
        autonomyEnabled?: boolean
        issueNumber?: number
        issueUrl?: string
        prNumber?: number
        prUrl?: string
        epicId?: string | null
        versionGroupId?: string
        isConsolidation?: boolean
        consolidationSourceIds?: string[]
    }) => void | Promise<void>
}

type CreateSessionPayload = Parameters<Props['onCreate']>[0]

export function NewSessionModal({ open, initialIsDraft = false, cachedPrompt = '', onPromptChange, onClose, onCreate }: Props) {
    const { t } = useTranslation()
    const { registerModal, unregisterModal } = useModal()
    const { isAvailable } = useAgentAvailability({ autoLoad: open })
    const { epics, ensureLoaded: ensureEpicsLoaded } = useEpics()
    const { variants: agentVariantsList } = useAgentVariants()
    const { presets: agentPresetsList } = useAgentPresets()
    const { favorites, favoriteOrderLoaded, loading: favoritesLoading } = useFavorites()
    const githubIntegration = useGithubIntegrationContext()
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [customBranch, setCustomBranch] = useState('')
    const [useExistingBranch, setUseExistingBranch] = useState(false)
    const [agentType, setAgentType] = useState<AgentType>('claude')
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [autonomyEnabled, setAutonomyEnabled] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const [createAsDraft, setCreateAsDraft] = useState(false)
    const [versionCount, setVersionCount] = useState<number>(1)
    const [multiAgentMode, setMultiAgentMode] = useState(false)
    const [multiAgentAllocations, setMultiAgentAllocations] = useState<MultiAgentAllocations>({})
    const [showVersionMenu, setShowVersionMenu] = useState<boolean>(false)
    const [nameLocked, setNameLocked] = useState(false)
    const [epicId, setEpicId] = useState<string | null>(null)
    const [isConsolidation, setIsConsolidation] = useState(false)
    const [consolidationSourceIds, setConsolidationSourceIds] = useState<string[]>([])
    const [versionGroupId, setVersionGroupId] = useState<string | undefined>(undefined)
    const [prefillPrNumber, setPrefillPrNumber] = useState<number | null>(null)
    const [prefillPrUrl, setPrefillPrUrl] = useState<string | null>(null)
    const [prefillIssueNumber, setPrefillIssueNumber] = useState<number | null>(null)
    const [prefillIssueUrl, setPrefillIssueUrl] = useState<string | null>(null)
    const [repositoryIsEmpty, setRepositoryIsEmpty] = useState(false)
    const [isPrefillPending, setIsPrefillPending] = useState(false)
    const [hasPrefillData, setHasPrefillData] = useState(false)
    const [originalSpecName, setOriginalSpecName] = useState<string>('')
    const [agentEnvVars, setAgentEnvVars] = useState<AgentEnvVarState>(createEmptyEnvVarState)
    const [agentCliArgs, setAgentCliArgs] = useState<AgentCliArgsState>(createEmptyCliArgsState)
    const [agentPreferences, setAgentPreferences] = useState<Record<AgentType, AgentPreferenceState>>(createEmptyPreferenceState)
    const [agentConfigLoading, setAgentConfigLoading] = useState(false)
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
    const [presetTabActive, setPresetTabActive] = useState(false)
    const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
    const [variantDropdownOpen, setVariantDropdownOpen] = useState(false)
    const [selectedFavoriteId, setSelectedFavoriteId] = useState<string | null>(null)
    const [customizeExpanded, setCustomizeExpanded] = useState(true)
    const [favoriteBaseline, setFavoriteBaseline] = useState<FavoriteConfigSnapshot | null>(null)
    const [ignorePersistedAgentType, setIgnorePersistedAgentType] = useState(false)
    const [persistedDefaultsLoaded, setPersistedDefaultsLoaded] = useState(false)
    const [promptSource, setPromptSource] = useState<'custom' | 'github_issue' | 'github_pull_request'>('custom')
    const [manualPromptDraft, setManualPromptDraft] = useState(cachedPrompt)
    const [githubIssueSelection, setGithubIssueSelection] = useState<GithubIssueSelectionResult | null>(null)
    const [githubPrSelection, setGithubPrSelection] = useState<GithubPrSelectionResult | null>(null)
    const [githubIssueLoading, setGithubIssueLoading] = useState(false)
    const [githubPrLoading, setGithubPrLoading] = useState(false)
    const [generatingName, setGeneratingName] = useState(false)
    const [unifiedSearchOpen, setUnifiedSearchOpen] = useState(false)
    const unifiedSearchOpenRef = useRef(false)
    unifiedSearchOpenRef.current = unifiedSearchOpen
    const nameInputRef = useRef<HTMLInputElement>(null)
    const markdownEditorRef = useRef<MarkdownEditorRef>(null)
    const hasFocusedDuringOpenRef = useRef(false)
    const focusTimeoutRef = useRef<number | undefined>(undefined)
    const projectFileIndex = useProjectFileIndex()
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')
    const lastAgentTypeRef = useRef<AgentType>('claude')
    const lastFavoriteIdRef = useRef<string | null>(null)
    const hasAgentOverrideRef = useRef(false)
    const lastSupportedSkipPermissionsRef = useRef(false)
    const lastOpenStateRef = useRef(false)
    const githubPromptReady = githubIntegration.canCreatePr && !githubIntegration.loading
    const preferencesInitializedRef = useRef(false)
    const agentPreferencesRef = useRef(agentPreferences)
    const manualFavoriteConfigRef = useRef<FavoriteConfigSnapshot | null>(null)
    const favoriteSelectionInitializedRef = useRef(false)
    const [codexCatalog, setCodexCatalog] = useState<CodexModelCatalog>(() => ({
        models: FALLBACK_CODEX_MODELS,
        defaultModelId: FALLBACK_CODEX_MODELS[0]?.id ?? ''
    }))
    const codexModelIds = useMemo(() => codexCatalog.models.map(meta => meta.id), [codexCatalog.models])
    const defaultCodexModelId = codexCatalog.defaultModelId
    const selectedEpic = useMemo(() => (epicId ? epics.find(epic => epic.id === epicId) ?? null : null), [epics, epicId])
    const normalizedAgentTypes = useMemo<AgentType[]>(
        () => (multiAgentMode ? normalizeAllocations(multiAgentAllocations) : []),
        [multiAgentMode, multiAgentAllocations]
    )
    const totalMultiAgentCount = multiAgentMode ? normalizedAgentTypes.length : 0
    const multiAgentSummaryLabel = useMemo(() => {
        const parts: string[] = []
        MULTI_AGENT_TYPES.forEach(agent => {
            const count = multiAgentAllocations[agent]
            if (count && count > 0) {
                parts.push(`${count}x ${displayNameForAgent(agent)}`)
            }
        })
        return parts.length > 0 ? parts.join(', ') : t.newSessionModal.multipleAgents
    }, [multiAgentAllocations])
    const favoriteMap = useMemo(() => new Map(favorites.map(favorite => [favorite.id, favorite])), [favorites])
    const resetMultiAgentSelections = useCallback(() => {
        setMultiAgentMode(false)
        setMultiAgentAllocations({})
    }, [])
    const currentFavoriteConfig = useMemo<FavoriteConfigSnapshot>(() => ({
        createAsDraft,
        baseBranch,
        customBranch,
        useExistingBranch,
        agentType,
        skipPermissions,
        autonomyEnabled,
        versionCount,
        multiAgentMode,
        multiAgentAllocations,
        selectedVariantId,
        selectedPresetId,
        presetTabActive,
        agentEnvVars,
        agentCliArgs,
        agentPreferences,
    }), [
        createAsDraft,
        baseBranch,
        customBranch,
        useExistingBranch,
        agentType,
        skipPermissions,
        autonomyEnabled,
        versionCount,
        multiAgentMode,
        multiAgentAllocations,
        selectedVariantId,
        selectedPresetId,
        presetTabActive,
        agentEnvVars,
        agentCliArgs,
        agentPreferences,
    ])
    const favoriteModified = useMemo(() => (
        selectedFavoriteId !== null
        && favoriteBaseline !== null
        && favoriteConfigSignature(currentFavoriteConfig) !== favoriteConfigSignature(favoriteBaseline)
    ), [currentFavoriteConfig, favoriteBaseline, selectedFavoriteId])

    const applyFavoriteConfigSnapshot = useCallback((config: FavoriteConfigSnapshot) => {
        setCreateAsDraft(config.createAsDraft)
        setBaseBranch(config.baseBranch)
        setCustomBranch(config.customBranch)
        setUseExistingBranch(config.useExistingBranch)
        setAgentType(config.agentType)
        setSkipPermissions(config.skipPermissions)
        setAutonomyEnabled(config.autonomyEnabled)
        setVersionCount(config.versionCount)
        setMultiAgentMode(config.multiAgentMode)
        setMultiAgentAllocations(config.multiAgentAllocations)
        setSelectedVariantId(config.selectedVariantId)
        setSelectedPresetId(config.selectedPresetId)
        setPresetTabActive(config.presetTabActive)
        setAgentEnvVars(config.agentEnvVars)
        setAgentCliArgs(config.agentCliArgs)
        setAgentPreferences(config.agentPreferences)
        setIgnorePersistedAgentType(true)
        lastAgentTypeRef.current = config.agentType
        hasAgentOverrideRef.current = true
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[config.agentType]) {
            lastSupportedSkipPermissionsRef.current = config.skipPermissions
        }
    }, [])

    const buildVariantFavoriteConfig = useCallback((config: FavoriteConfigSnapshot, variant: AgentVariant): FavoriteConfigSnapshot => {
        return {
            ...config,
            agentType: variant.agentType,
            selectedVariantId: variant.id,
            selectedPresetId: null,
            presetTabActive: false,
            multiAgentMode: false,
            multiAgentAllocations: {},
            agentCliArgs: {
                ...config.agentCliArgs,
                [variant.agentType]: variant.cliArgs?.join(' ') ?? '',
            },
            agentEnvVars: {
                ...config.agentEnvVars,
                [variant.agentType]: Object.entries(variant.envVars ?? {}).map(([key, value]) => ({ key, value })),
            },
            agentPreferences: {
                ...config.agentPreferences,
                [variant.agentType]: {
                    model: variant.model ?? '',
                    reasoningEffort: variant.reasoningEffort ?? '',
                },
            },
        }
    }, [])

    const buildPresetFavoriteConfig = useCallback((config: FavoriteConfigSnapshot, presetId: string): FavoriteConfigSnapshot | null => {
        const preset = agentPresetsList.find(item => item.id === presetId)
        if (!preset) {
            return null
        }

        const primarySlot = preset.slots[0]
        const primaryAgentType = (primarySlot?.agentType as AgentType | undefined) ?? config.agentType
        let nextConfig: FavoriteConfigSnapshot = {
            ...config,
            agentType: primaryAgentType,
            skipPermissions: primarySlot?.skipPermissions ?? config.skipPermissions,
            autonomyEnabled: primarySlot?.autonomyEnabled ?? config.autonomyEnabled,
            versionCount: Math.max(1, preset.slots.length),
            multiAgentMode: false,
            multiAgentAllocations: {},
            selectedVariantId: null,
            selectedPresetId: preset.id,
            presetTabActive: true,
            agentCliArgs: { ...config.agentCliArgs },
            agentEnvVars: { ...config.agentEnvVars },
            agentPreferences: { ...config.agentPreferences },
        }

        preset.slots.forEach(slot => {
            const variant = slot.variantId ? agentVariantsList.find(item => item.id === slot.variantId) : null
            if (!variant) {
                return
            }
            nextConfig = {
                ...nextConfig,
                agentCliArgs: {
                    ...nextConfig.agentCliArgs,
                    [slot.agentType]: variant.cliArgs?.join(' ') ?? '',
                },
                agentEnvVars: {
                    ...nextConfig.agentEnvVars,
                    [slot.agentType]: Object.entries(variant.envVars ?? {}).map(([key, value]) => ({ key, value })),
                },
                agentPreferences: {
                    ...nextConfig.agentPreferences,
                    [slot.agentType]: {
                        model: variant.model ?? '',
                        reasoningEffort: variant.reasoningEffort ?? '',
                    },
                },
            }
        })

        return nextConfig
    }, [agentPresetsList, agentVariantsList])

    const selectQuickMode = useCallback((modeId: typeof SPEC_FAVORITE_ID | typeof CUSTOM_FAVORITE_ID) => {
        favoriteSelectionInitializedRef.current = true
        if (modeId === SPEC_FAVORITE_ID) {
            if (selectedFavoriteId === null) {
                manualFavoriteConfigRef.current = currentFavoriteConfig
            }
            setCreateAsDraft(true)
            setSelectedPresetId(null)
            setSelectedVariantId(null)
            setPresetTabActive(false)
            resetMultiAgentSelections()
            setSelectedFavoriteId(SPEC_FAVORITE_ID)
            setFavoriteBaseline(null)
            setCustomizeExpanded(false)
            if (validationError) {
                setValidationError('')
            }
            return
        }

        if (selectedFavoriteId === null) {
            manualFavoriteConfigRef.current = currentFavoriteConfig
        } else if (selectedFavoriteId !== CUSTOM_FAVORITE_ID && manualFavoriteConfigRef.current) {
            applyFavoriteConfigSnapshot(manualFavoriteConfigRef.current)
        }
        setCreateAsDraft(false)
        setSelectedPresetId(null)
        setSelectedVariantId(null)
        setPresetTabActive(false)
        resetMultiAgentSelections()
        setSelectedFavoriteId(CUSTOM_FAVORITE_ID)
        setFavoriteBaseline(null)
        setCustomizeExpanded(true)
        if (validationError) {
            setValidationError('')
        }
    }, [
        applyFavoriteConfigSnapshot,
        currentFavoriteConfig,
        resetMultiAgentSelections,
        selectedFavoriteId,
        validationError,
    ])

    const selectFavorite = useCallback((favoriteId: string) => {
        const favorite = favoriteMap.get(favoriteId)
        if (!favorite || favorite.disabled) {
            return
        }
        favoriteSelectionInitializedRef.current = true

        if (selectedFavoriteId === favoriteId) {
            selectQuickMode(CUSTOM_FAVORITE_ID)
            return
        }

        if (selectedFavoriteId === null || isQuickModeId(selectedFavoriteId)) {
            const baselineSource = manualFavoriteConfigRef.current ?? currentFavoriteConfig
            manualFavoriteConfigRef.current = baselineSource
        }

        const nextConfig = favorite.kind === 'variant'
            ? buildVariantFavoriteConfig(currentFavoriteConfig, favorite.variant!)
            : buildPresetFavoriteConfig(currentFavoriteConfig, favorite.id)

        if (!nextConfig) {
            return
        }

        applyFavoriteConfigSnapshot(nextConfig)
        lastFavoriteIdRef.current = favorite.id
        setSelectedFavoriteId(favorite.id)
        setFavoriteBaseline(nextConfig)
        setCustomizeExpanded(false)
    }, [
        applyFavoriteConfigSnapshot,
        buildPresetFavoriteConfig,
        buildVariantFavoriteConfig,
        currentFavoriteConfig,
        favoriteMap,
        selectQuickMode,
        selectedFavoriteId,
    ])

    const handleVariantSelect = useCallback((variant: AgentVariant | null) => {
        if (!variant) {
            setSelectedVariantId(null)
            return
        }
        setSelectedVariantId(variant.id)
        setAgentType(variant.agentType)
        setIgnorePersistedAgentType(true)
        if (variant.model || variant.reasoningEffort) {
            setAgentPreferences(prev => ({
                ...prev,
                [variant.agentType]: {
                    model: variant.model ?? prev[variant.agentType]?.model ?? '',
                    reasoningEffort: variant.reasoningEffort ?? prev[variant.agentType]?.reasoningEffort ?? '',
                },
            }))
        }
        if (variant.cliArgs && variant.cliArgs.length > 0) {
            setAgentCliArgs(prev => ({
                ...prev,
                [variant.agentType]: variant.cliArgs!.join(' '),
            }))
        }
        if (variant.envVars && Object.keys(variant.envVars).length > 0) {
            setAgentEnvVars(prev => ({
                ...prev,
                [variant.agentType]: Object.entries(variant.envVars!).map(([key, value]) => ({ key, value })),
            }))
        }
    }, [])

    const isBranchError = isBranchValidationError(validationError)
    const branchError = isBranchError ? validationError : undefined
    const nameError = isBranchError ? '' : validationError

    const updateManualPrompt = useCallback(
        (value: string) => {
            setManualPromptDraft(value)
            setTaskContent(value)
            onPromptChange?.(value)
            if (!wasEditedRef.current && value.trim()) {
                const derivedName = promptToSessionName(value)
                setName(derivedName)
            }
        },
        [onPromptChange]
    )



    const handleVersionSelect = useCallback((key: string) => {
        if (key === 'multi') {
            if (!multiAgentMode) {
                setMultiAgentMode(true)
            }
            setMultiAgentAllocations(prev => {
                if (sumAllocations(prev) > 0 || agentType === 'terminal') {
                    return prev
                }
                return { ...prev, [agentType]: 1 }
            })
            return
        }

        const parsed = parseInt(key, 10)
        const nextCount = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(MAX_VERSION_COUNT, parsed))
        resetMultiAgentSelections()
        setVersionCount(nextCount)
    }, [agentType, multiAgentMode, resetMultiAgentSelections])

    const handleAgentToggle = useCallback((agent: AgentType, enabled: boolean) => {
        if (agent === 'terminal') {
            return
        }
        setMultiAgentAllocations(prev => {
            if (!enabled) {
                if (!prev[agent]) {
                    return prev
                }
                const next = { ...prev }
                delete next[agent]
                return next
            }

            const otherTotal = sumAllocations(prev)
            const availableSlots = MAX_VERSION_COUNT - otherTotal
            if (availableSlots <= 0) {
                return prev
            }
            return { ...prev, [agent]: 1 }
        })
    }, [])

    const handleAgentCountChange = useCallback((agent: AgentType, requestedCount: number) => {
        if (agent === 'terminal') {
            return
        }
        setMultiAgentAllocations(prev => {
            if (!prev[agent]) {
                return prev
            }
            const otherTotal = sumAllocations(prev, agent)
            const allowed = Math.max(0, Math.min(requestedCount, MAX_VERSION_COUNT - otherTotal))
            if (allowed <= 0) {
                const next = { ...prev }
                delete next[agent]
                return next
            }
            if (prev[agent] === allowed) {
                return prev
            }
            return { ...prev, [agent]: allowed }
        })
    }, [])

    const handleBranchChange = (branch: string) => {
        setBaseBranch(branch)
        // Clear validation error when user changes branch
        if (validationError && validationError.includes('Branch')) {
            setValidationError('')
        }
    }

    const handleAgentTypeChange = useCallback((type: AgentType) => {
        const previousAgent = lastAgentTypeRef.current
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[previousAgent]) {
            lastSupportedSkipPermissionsRef.current = skipPermissions
        }

        logger.info(`[NewSessionModal] Agent type change requested ${JSON.stringify({
            nextType: type,
            previousType: previousAgent,
            overrideBefore: hasAgentOverrideRef.current
        })}`)

        setAgentType(type)
        lastAgentTypeRef.current = type
        hasAgentOverrideRef.current = true
        let nextSkipState = skipPermissions
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[type]) {
            const restoredPreference = lastSupportedSkipPermissionsRef.current
            setSkipPermissions(restoredPreference)
            nextSkipState = restoredPreference
            logger.info('[NewSessionModal] Restored skip permissions preference for supported agent', {
                agentType: type,
                restoredPreference
            })
        } else if (skipPermissions) {
            setSkipPermissions(false)
            nextSkipState = false
            logger.info('[NewSessionModal] Cleared skip permissions for unsupported agent', { agentType: type })
        }

        logger.info(`[NewSessionModal] Agent type change applied ${JSON.stringify({
            lastAgentType: lastAgentTypeRef.current,
            overrideAfter: hasAgentOverrideRef.current,
            skipPermissions: nextSkipState
        })}`)
    }, [skipPermissions])

    const handleSkipPermissionsChange = (enabled: boolean) => {
        setSkipPermissions(enabled)
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[lastAgentTypeRef.current]) {
            lastSupportedSkipPermissionsRef.current = enabled
        }
    }

    useEffect(() => {
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[agentType]) {
            lastSupportedSkipPermissionsRef.current = skipPermissions
        }
    }, [agentType, skipPermissions])

    const persistAgentCliArgs = useCallback(async (agent: AgentType, value: string) => {
        try {
            await invoke(TauriCommands.SetAgentCliArgs, { agentType: agent, cliArgs: value })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist CLI args for agent', agent, error)
        }
    }, [])

    const persistAgentEnvVars = useCallback(async (agent: AgentType, vars: AgentEnvVar[]) => {
        const envVarPayload = vars.reduce<Record<string, string>>((acc, item) => {
            const trimmedKey = item.key.trim()
            if (trimmedKey) {
                acc[trimmedKey] = item.value
            }
            return acc
        }, {})

        try {
            await invoke(TauriCommands.SetAgentEnvVars, { agentType: agent, envVars: envVarPayload })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist env vars for agent', agent, error)
        }
    }, [])

    const persistAgentPreferences = useCallback(async (agent: AgentType, preferences: AgentPreferenceState) => {
        try {
            const normalizedModel = preferences.model?.trim() || ''
            const normalizedReasoning = preferences.reasoningEffort?.trim() || ''

            await invoke(TauriCommands.SetAgentPreferences, {
                agentType: agent,
                preferences: {
                    model: normalizedModel ? normalizedModel : null,
                    reasoning_effort: normalizedReasoning ? normalizedReasoning : null,
                },
            })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist agent preferences', agent, error)
        }
    }, [])

    const updateEnvVarsForAgent = useCallback(
        (updater: (vars: AgentEnvVar[]) => AgentEnvVar[]) => {
            setAgentEnvVars(prev => {
                const currentList = prev[agentType] || []
                const updatedList = updater(currentList)
                const next = { ...prev, [agentType]: updatedList }
                void persistAgentEnvVars(agentType, updatedList)
                return next
            })
        },
        [agentType, persistAgentEnvVars]
    )

    const handleCliArgsChange = useCallback(
        (value: string) => {
            setAgentCliArgs(prev => {
                if (prev[agentType] === value) {
                    return prev
                }
                return { ...prev, [agentType]: value }
            })
            void persistAgentCliArgs(agentType, value)
        },
        [agentType, persistAgentCliArgs]
    )

    const handleEnvVarChange = useCallback(
        (index: number, field: 'key' | 'value', value: string) => {
            updateEnvVarsForAgent(current =>
                current.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
            )
        },
        [updateEnvVarsForAgent]
    )

    const handleAgentPreferenceChange = useCallback(
        (agent: AgentType, field: AgentPreferenceField, value: string) => {
            setAgentPreferences(prev => {
                const current = prev[agent] ?? { model: '', reasoningEffort: '' }
                const updated = {
                    ...current,
                    [field]: value,
                }

                if (agent === 'codex' && field === 'model') {
                    const meta = getCodexModelMetadata(value, codexCatalog.models)
                    const supportedEfforts = meta?.reasoningOptions?.map(option => option.id) ?? []
                    if (supportedEfforts.length > 0 && !supportedEfforts.includes(updated.reasoningEffort ?? '')) {
                        updated.reasoningEffort = meta?.defaultReasoning ?? supportedEfforts[0]
                    }
                }

                if (agent === 'codex' && field === 'reasoningEffort') {
                    const modelId = (prev.codex?.model ?? updated.model) || ''
                    const meta = getCodexModelMetadata(modelId, codexCatalog.models)
                    const supportedEfforts = meta?.reasoningOptions?.map(option => option.id) ?? []
                    if (supportedEfforts.length > 0 && !supportedEfforts.includes(value)) {
                        return prev
                    }
                }

                const nextState = {
                    ...prev,
                    [agent]: updated,
                }
                void persistAgentPreferences(agent, nextState[agent])
                return nextState
            })
        },
        [persistAgentPreferences, codexCatalog.models]
    )

    useEffect(() => {
        agentPreferencesRef.current = agentPreferences
    }, [agentPreferences])

    const handleAddEnvVar = useCallback(() => {
        updateEnvVarsForAgent(current => [...current, { key: '', value: '' }])
    }, [updateEnvVarsForAgent])

    const handleRemoveEnvVar = useCallback(
        (index: number) => {
            updateEnvVarsForAgent(current => current.filter((_, idx) => idx !== index))
        },
        [updateEnvVarsForAgent]
    )

    const validateSessionName = useCallback((sessionName: string): string | null => {
        if (!sessionName.trim()) {
            return t.newSessionModal.validation.nameRequired
        }
        if (sessionName.length > 100) {
            return t.newSessionModal.validation.nameTooLong
        }
        if (!SESSION_NAME_ALLOWED_PATTERN.test(sessionName)) {
            return t.newSessionModal.validation.nameInvalidChars
        }
        return null
    }, [t])

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value
        setName(newName)
        setWasEdited(true)
        wasEditedRef.current = true
        
        // Clear validation error when user starts typing again
        if (validationError) {
            setValidationError('')
        }
    }

    const handleGenerateName = useCallback(async () => {
        if (generatingName) return
        const content = promptSource === 'github_issue'
            ? githubIssueSelection?.prompt ?? ''
            : promptSource === 'github_pull_request'
                ? githubPrSelection?.prompt ?? ''
                : taskContent
        if (!content.trim()) return

        setGeneratingName(true)
        try {
            const generated = await invoke<string | null>(
                TauriCommands.SchaltwerkCoreGenerateSessionName,
                { content, agentType }
            )
            if (generated) {
                setName(generated)
                setWasEdited(true)
                wasEditedRef.current = true
            }
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to generate name:', error)
        } finally {
            setGeneratingName(false)
        }
    }, [generatingName, promptSource, githubIssueSelection, githubPrSelection, taskContent, agentType])

    const handleCreate = useCallback(async () => {
        if (creating) return
        // Read directly from input when available to avoid any stale state in tests
        const currentValue = nameInputRef.current?.value ?? name
        // Generate name from prompt if available, fallback to Docker style
        let finalName = currentValue.trim() || (taskContent.trim() ? promptToSessionName(taskContent) : generateDockerStyleName())
        
        const error = validateSessionName(finalName)
        if (error) {
            setValidationError(error)
            return
        }
        
        const issuePrompt = githubIssueSelection?.prompt ?? ''
        const prPrompt = githubPrSelection?.prompt ?? ''
        const currentPrompt =
            promptSource === 'github_issue' 
                ? issuePrompt 
                : promptSource === 'github_pull_request'
                    ? prPrompt
                    : taskContent

        if (promptSource === 'github_issue' && !githubIssueSelection) {
            setValidationError(t.newSessionModal.validation.selectIssue)
            return
        }

        if (promptSource === 'github_pull_request' && !githubPrSelection) {
            setValidationError(t.newSessionModal.validation.selectPr)
            return
        }

        // Validate that base branch is selected
        if (!createAsDraft && !baseBranch) {
            setValidationError(t.newSessionModal.validation.selectBranch)
            return
        }

        // Validate spec content if creating as spec
         if (createAsDraft && !currentPrompt.trim()) {
             setValidationError(t.newSessionModal.validation.enterSpecContent)
             return
         }
        if (!createAsDraft && multiAgentMode && normalizedAgentTypes.length === 0) {
            setValidationError(t.newSessionModal.validation.selectAgent)
            return
        }

        // Replace spaces with underscores for the actual session name
        finalName = finalName.replace(/ /g, '_')
        
        const userEdited = wasEditedRef.current || (
            initialGeneratedNameRef.current && currentValue.trim() !== initialGeneratedNameRef.current
        )

        try {
            setCreating(true)

            const selectedPreset = presetTabActive && selectedPresetId
                ? agentPresetsList.find(p => p.id === selectedPresetId)
                : null
            const presetAgentSlots = selectedPreset
                ? selectedPreset.slots.map(slot => ({
                    agentType: slot.agentType as AgentType,
                    skipPermissions: slot.skipPermissions,
                    autonomyEnabled: slot.autonomyEnabled,
                }))
                : null
            const useMultiAgentTypes = !createAsDraft && (multiAgentMode && normalizedAgentTypes.length > 0)
            const usePreset = !createAsDraft && !!presetAgentSlots && presetAgentSlots.length > 0
            const effectiveAgentTypes = usePreset
                ? presetAgentSlots.map(slot => slot.agentType)
                : useMultiAgentTypes
                    ? normalizedAgentTypes
                    : null
            const agentTypesPayload = usePreset ? undefined : (effectiveAgentTypes ?? undefined)
            const agentSlotsPayload = usePreset ? presetAgentSlots ?? undefined : undefined
            const effectiveVersionCount = createAsDraft
                ? 1
                : usePreset
                    ? (presetAgentSlots?.length ?? 1)
                    : effectiveAgentTypes
                        ? effectiveAgentTypes.length
                    : versionCount
            const primaryAgentType = effectiveAgentTypes
                ? (effectiveAgentTypes[0] ?? agentType)
                : agentType
            const effectiveAutonomyEnabled = primaryAgentType === 'terminal' ? false : autonomyEnabled

            const isPrFromSameRepo = promptSource === 'github_pull_request'
                && githubPrSelection
                && !githubPrSelection.details.isFork


            const effectiveUseExistingBranch = isPrFromSameRepo || useExistingBranch
            const effectiveCustomBranch = isPrFromSameRepo
                ? githubPrSelection.details.headRefName
                : useExistingBranch
                    ? baseBranch
                    : customBranch.trim() || undefined

            const prInfo = promptSource === 'github_pull_request' && githubPrSelection
                ? { prNumber: githubPrSelection.details.number, prUrl: githubPrSelection.details.url }
                : prefillPrNumber != null
                    ? { prNumber: prefillPrNumber, ...(prefillPrUrl ? { prUrl: prefillPrUrl } : {}) }
                    : {}
            const issueInfo = promptSource === 'github_issue' && githubIssueSelection
                ? { issueNumber: githubIssueSelection.details.number, issueUrl: githubIssueSelection.details.url }
                : prefillIssueNumber != null
                    ? { issueNumber: prefillIssueNumber, ...(prefillIssueUrl ? { issueUrl: prefillIssueUrl } : {}) }
                    : {}

            const createData: CreateSessionPayload = {
                name: finalName,
                prompt: createAsDraft ? undefined : (currentPrompt || undefined),
                baseBranch: createAsDraft ? '' : baseBranch,
                customBranch: effectiveCustomBranch,
                useExistingBranch: effectiveUseExistingBranch,
                syncWithOrigin: effectiveUseExistingBranch,
                userEditedName: !!userEdited,
                isSpec: createAsDraft,
                draftContent: createAsDraft ? currentPrompt : undefined,
                versionCount: effectiveVersionCount,
                agentType: primaryAgentType,
                skipPermissions: createAsDraft ? skipPermissions : (usePreset ? undefined : skipPermissions),
                autonomyEnabled: createAsDraft ? undefined : (usePreset ? undefined : effectiveAutonomyEnabled),
                epicId,
                versionGroupId,
                ...issueInfo,
                ...prInfo,
                ...(isConsolidation ? { isConsolidation: true, consolidationSourceIds } : {}),
            }
            if (agentSlotsPayload) {
                createData.agentSlots = agentSlotsPayload
            }
            if (agentTypesPayload) {
                createData.agentTypes = agentTypesPayload
            }

            logger.info('[NewSessionModal] Creating session with data:', {
                ...createData,
                createAsDraft,
                taskContent: taskContent ? taskContent.substring(0, 100) + (taskContent.length > 100 ? '...' : '') : undefined,
                promptWillBe: createData.prompt ? createData.prompt.substring(0, 100) + (createData.prompt.length > 100 ? '...' : '') : undefined
            })
            await Promise.resolve(onCreate(createData))
        } catch (e) {
            let errorMessage = 'Unknown error occurred'
            if (e instanceof Error) {
                errorMessage = e.message
            } else if (typeof e === 'string') {
                errorMessage = e
            } else if (e && typeof e === 'object') {
                const err = e as { data?: { message?: string }; message?: string }
                errorMessage = err.data?.message ?? err.message ?? errorMessage
            }
            if (isBranchValidationError(errorMessage)) {
                logger.warn(`Failed to create session (validation): ${name}`, e)
            } else {
                logger.error(`Failed to create session: ${name}`, e)
            }
            setValidationError(errorMessage)
            setCreating(false)
        }
    }, [creating, name, taskContent, baseBranch, customBranch, useExistingBranch, onCreate, validateSessionName, createAsDraft, versionCount, agentType, skipPermissions, autonomyEnabled, epicId, promptSource, githubIssueSelection, githubPrSelection, multiAgentMode, normalizedAgentTypes, isConsolidation, consolidationSourceIds, versionGroupId, selectedPresetId, agentPresetsList, prefillPrNumber, prefillPrUrl, prefillIssueNumber, prefillIssueUrl])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = () => { void handleCreate() }

    // Track if the modal was previously open and with what initialIsDraft value
    const wasOpenRef = useRef(false)
    const lastInitialIsDraftRef = useRef<boolean | undefined>(undefined)
    useEffect(() => {
        if (!open) return

        let cancelled = false

        const loadAgentDefaults = async () => {
            setAgentConfigLoading(true)
            try {
                const envResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<Record<string, string>>(TauriCommands.GetAgentEnvVars, { agentType: agent })
                            return result || {}
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load env vars for agent', agent, error)
                            return {}
                        }
                    })
                )

                const cliResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<string>(TauriCommands.GetAgentCliArgs, { agentType: agent })
                            return result || ''
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load CLI args for agent', agent, error)
                            return ''
                        }
                    })
                )

                const preferenceResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<{ model?: string | null; reasoning_effort?: string | null }>(
                                TauriCommands.GetAgentPreferences,
                                { agentType: agent }
                            )
                            return result ?? {}
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load agent preferences', agent, error)
                            return {}
                        }
                    })
                )

                if (cancelled) {
                    return
                }

                setAgentEnvVars(() => {
                    const next = createEmptyEnvVarState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const raw = envResults[index] || {}
                        next[agent] = Object.entries(raw).map(([key, value]) => ({ key, value }))
                    })
                    return next
                })

                setAgentCliArgs(() => {
                    const next = createEmptyCliArgsState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const result = cliResults[index]
                        next[agent] = typeof result === 'string' ? result : ''
                    })
                    return next
                })

                setAgentPreferences(() => {
                    const next = createEmptyPreferenceState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const raw = preferenceResults[index] || {}
                        next[agent] = {
                            model: raw.model ?? '',
                            reasoningEffort: raw.reasoning_effort ?? '',
                        }
                    })
                    return next
                })
            } catch (error) {
                if (!cancelled) {
                    logger.warn('[NewSessionModal] Failed to load agent defaults', error)
                    setAgentEnvVars(createEmptyEnvVarState())
                    setAgentCliArgs(createEmptyCliArgsState())
                    setAgentPreferences(createEmptyPreferenceState())
                }
            } finally {
                if (!cancelled) {
                    setAgentConfigLoading(false)
                    preferencesInitializedRef.current = true
                }
            }
        }

        void loadAgentDefaults()

        return () => {
            cancelled = true
        }
    }, [open])

    useEffect(() => {
        if (!open) {
            return
        }

        let cancelled = false

        const loadCatalog = async () => {
            try {
                const catalog = await loadCodexModelCatalog()
                if (!cancelled) {
                    setCodexCatalog(catalog)
                }
            } catch (error) {
                logger.warn('[NewSessionModal] Failed to refresh Codex model catalog', error)
            }
        }

        void loadCatalog()

        return () => {
            cancelled = true
        }
    }, [open])

    useEffect(() => {
        if (agentType !== 'codex') {
            return
        }
        if (agentConfigLoading) {
            return
        }
        if (!preferencesInitializedRef.current) {
            return
        }

        const currentPrefs = agentPreferencesRef.current.codex ?? { model: '', reasoningEffort: '' }

        const currentModel = currentPrefs.model?.trim() ?? ''
        if (!currentModel || !codexModelIds.includes(currentModel)) {
            if (defaultCodexModelId && defaultCodexModelId !== currentModel) {
                handleAgentPreferenceChange('codex', 'model', defaultCodexModelId)
                return
            }
        }

        const activeModel = currentModel && codexModelIds.includes(currentModel)
            ? currentModel
            : defaultCodexModelId
        const modelMeta = activeModel ? getCodexModelMetadata(activeModel, codexCatalog.models) : undefined
        const supportedEfforts = modelMeta?.reasoningOptions?.map(option => option.id) ?? []
        const currentReasoning = currentPrefs.reasoningEffort?.trim() ?? ''

        if (supportedEfforts.length === 0) {
            if (currentReasoning) {
                handleAgentPreferenceChange('codex', 'reasoningEffort', '')
            }
            return
        }

        if (!supportedEfforts.includes(currentReasoning)) {
            const fallbackReasoning = modelMeta?.defaultReasoning ?? supportedEfforts[0]
            handleAgentPreferenceChange('codex', 'reasoningEffort', fallbackReasoning)
        }
    }, [agentType, agentPreferences, agentConfigLoading, handleAgentPreferenceChange, codexModelIds, defaultCodexModelId, codexCatalog.models])

    // Register/unregister modal with context using layout effect to minimize timing gaps
    useLayoutEffect(() => {
        if (open) {
            registerModal('NewSessionModal')
        } else {
            unregisterModal('NewSessionModal')
        }
    }, [open, registerModal, unregisterModal])

    useEffect(() => {
        if (!open) {
            resetMultiAgentSelections()
        }
    }, [open, resetMultiAgentSelections])

    useEffect(() => {
        if (!open) {
            return
        }
        ensureEpicsLoaded().catch((err) => {
            logger.warn('[NewSessionModal] Failed to load epics:', err)
        })
    }, [open, ensureEpicsLoaded])

    useEffect(() => {
        if (createAsDraft || agentType === 'terminal') {
            resetMultiAgentSelections()
        }
    }, [createAsDraft, agentType, resetMultiAgentSelections])

    useLayoutEffect(() => {
        const openedThisRender = open && !lastOpenStateRef.current
        const closedThisRender = !open && lastOpenStateRef.current
        lastOpenStateRef.current = open

        if (open) {
            if (openedThisRender) {
                logger.info('[NewSessionModal] Modal opened with:', {
                    initialIsDraft,
                    isPrefillPending,
                    hasPrefillData,
                    currentCreateAsDraft: createAsDraft,
                    wasOpen: wasOpenRef.current,
                    lastInitialIsDraft: lastInitialIsDraftRef.current
                })
            }
            
            setCreating(false)
            // Generate initial name - prefer prompt-based if cached prompt exists, fallback to Docker style
            const gen = cachedPrompt?.trim()
                ? promptToSessionName(cachedPrompt)
                : generateDockerStyleName()
            initialGeneratedNameRef.current = gen

            // Reset state if:
            // 1. We're not expecting prefill data AND don't already have it AND modal wasn't already open, OR
            // 2. The initialIsDraft prop changed (component re-rendered with different props)
            const initialIsDraftChanged = lastInitialIsDraftRef.current !== undefined && lastInitialIsDraftRef.current !== initialIsDraft
            const shouldReset = (!isPrefillPending && !hasPrefillData && !wasOpenRef.current) || initialIsDraftChanged

            if (shouldReset) {
                logger.info('[NewSessionModal] Resetting modal state - reason:', {
                    noPrefillAndWasntOpen: !isPrefillPending && !hasPrefillData && !wasOpenRef.current,
                    initialIsDraftChanged
                })
                setPersistedDefaultsLoaded(false)
                setName(gen)
                setWasEdited(false)
                wasEditedRef.current = false
                setSelectedFavoriteId(null)
                setFavoriteBaseline(null)
                setCustomizeExpanded(true)
                manualFavoriteConfigRef.current = null
                favoriteSelectionInitializedRef.current = false
                setPromptSource('custom')
                setGithubIssueSelection(null)
                setGithubPrSelection(null)
                setGithubIssueLoading(false)
                setGithubPrLoading(false)
                setUnifiedSearchOpen(false)
                setManualPromptDraft(cachedPrompt)
                setTaskContent(cachedPrompt)
                setValidationError('')
                setCreateAsDraft(initialIsDraft)
                setCustomBranch('')
                setUseExistingBranch(false)
                setNameLocked(false)
                setOriginalSpecName('')
                setEpicId(null)
                setIsConsolidation(false)
                setConsolidationSourceIds([])
                setVersionGroupId(undefined)
                setPrefillPrNumber(null)
                setPrefillPrUrl(null)
                setPrefillIssueNumber(null)
                setPrefillIssueUrl(null)
                setAutonomyEnabled(false)
                setShowVersionMenu(false)
                setVersionCount(1)
                const shouldIgnorePersisted = hasAgentOverrideRef.current
                setIgnorePersistedAgentType(shouldIgnorePersisted)
                logger.info(`[NewSessionModal] Applying last agent type before defaults ${JSON.stringify({
                    lastAgentType: lastAgentTypeRef.current,
                    hasOverride: hasAgentOverrideRef.current,
                    ignorePersisted: shouldIgnorePersisted
                })}`)
                setAgentType(lastAgentTypeRef.current)
                // Initialize configuration from persisted state to reflect real settings
                getPersistedSessionDefaults()
                    .then(({ baseBranch, agentType, skipPermissions }) => {
                        if (baseBranch) setBaseBranch(baseBranch)
                        if (!shouldIgnorePersisted) {
                            logger.info(`[NewSessionModal] Using persisted agent type from defaults ${JSON.stringify({ persistedAgentType: agentType })}`)
                            setAgentType(agentType)
                            lastAgentTypeRef.current = agentType
                        } else {
                            logger.info(`[NewSessionModal] Ignoring persisted agent type in favour of override ${JSON.stringify({
                                persistedAgentType: agentType,
                                lastAgentType: lastAgentTypeRef.current
                            })}`)
                        }
                        setSkipPermissions(skipPermissions)
                        setPersistedDefaultsLoaded(true)
                        logger.info('[NewSessionModal] Initialized config from persisted state:', { baseBranch, agentType, skipPermissions })
                    })
                    .catch(e => {
                        logger.warn('[NewSessionModal] Failed loading persisted config, falling back to child init:', e)
                        setBaseBranch('')
                        if (!shouldIgnorePersisted) {
                            logger.info(`[NewSessionModal] Falling back to claude defaults ${JSON.stringify({ hasOverride: hasAgentOverrideRef.current })}`)
                            setAgentType('claude')
                            lastAgentTypeRef.current = 'claude'
                        }
                        setSkipPermissions(false)
                        setPersistedDefaultsLoaded(true)
                    })
            } else {
                if (openedThisRender || initialIsDraftChanged) {
                    logger.info('[NewSessionModal] Skipping full state reset - reason: prefill pending or has data or modal was already open and initialIsDraft unchanged')
                }
                // Still need to reset some state
                setValidationError('')
                setCreating(false)
                setPersistedDefaultsLoaded(true)
            }
            
            wasOpenRef.current = true
            lastInitialIsDraftRef.current = initialIsDraft

            // Check if repository is empty for display purposes
            invoke<boolean>(TauriCommands.RepositoryIsEmpty)
                .then(setRepositoryIsEmpty)
                .catch(err => {
                    logger.warn('Failed to check if repository is empty:', err)
                    setRepositoryIsEmpty(false)
                })

            if (focusTimeoutRef.current !== undefined) {
                clearTimeout(focusTimeoutRef.current)
                focusTimeoutRef.current = undefined
            }
            if (!hasFocusedDuringOpenRef.current) {
                focusTimeoutRef.current = window.setTimeout(() => {
                    hasFocusedDuringOpenRef.current = true
                    if (markdownEditorRef.current) {
                        markdownEditorRef.current.focusEnd()
                    } else if (nameInputRef.current) {
                        nameInputRef.current.focus()
                        nameInputRef.current.select()
                    }
                }, 100)
            }
        } else {
            setIgnorePersistedAgentType(hasAgentOverrideRef.current)
            if (closedThisRender) {
                logger.info(`[NewSessionModal] Modal closed - resetting all state except taskContent ${JSON.stringify({
                    lastAgentType: lastAgentTypeRef.current,
                    hasOverride: hasAgentOverrideRef.current
                })}`)
            }
            setIsPrefillPending(false)
            setHasPrefillData(false)
            setCreateAsDraft(false)
            setCustomBranch('')
            setUseExistingBranch(false)
            setNameLocked(false)
            setOriginalSpecName('')
            setName('')
            setValidationError('')
            setCreating(false)
            setBaseBranch('')
            setAgentType(lastAgentTypeRef.current)
            setSkipPermissions(false)
            setAutonomyEnabled(false)
            setVersionCount(1)
            setShowVersionMenu(false)
            setIsConsolidation(false)
            setConsolidationSourceIds([])
            setVersionGroupId(undefined)
            setSelectedFavoriteId(null)
            setFavoriteBaseline(null)
            setCustomizeExpanded(true)
            setPersistedDefaultsLoaded(false)
            setPrefillPrNumber(null)
            setPrefillPrUrl(null)
            setPrefillIssueNumber(null)
            setPrefillIssueUrl(null)
            logger.info(`[NewSessionModal] Reapplying last agent type on close path ${JSON.stringify({
                lastAgentType: lastAgentTypeRef.current,
                hasOverride: hasAgentOverrideRef.current
            })}`)
            setAgentEnvVars(createEmptyEnvVarState())
            setAgentCliArgs(createEmptyCliArgsState())
            setAgentConfigLoading(false)
            manualFavoriteConfigRef.current = null
            favoriteSelectionInitializedRef.current = false
            wasOpenRef.current = false
            lastInitialIsDraftRef.current = undefined
            hasFocusedDuringOpenRef.current = false
            if (focusTimeoutRef.current !== undefined) {
                clearTimeout(focusTimeoutRef.current)
                focusTimeoutRef.current = undefined
            }
        }
    }, [open, initialIsDraft, isPrefillPending, hasPrefillData, createAsDraft, cachedPrompt])

    const ensureProjectFiles = projectFileIndex.ensureIndex

    useEffect(() => {
        if (!open) return
        void ensureProjectFiles()
    }, [open, ensureProjectFiles])

    useEffect(() => {
        if (!open || favoriteSelectionInitializedRef.current) {
            return
        }
        if (!persistedDefaultsLoaded || agentConfigLoading || favoritesLoading || !favoriteOrderLoaded) {
            return
        }
        if (hasPrefillData && (selectedVariantId || selectedPresetId)) {
            favoriteSelectionInitializedRef.current = true
            selectQuickMode(CUSTOM_FAVORITE_ID)
            return
        }
        favoriteSelectionInitializedRef.current = true

        if (initialIsDraft) {
            selectQuickMode(SPEC_FAVORITE_ID)
            return
        }

        const lastFavoriteId = lastFavoriteIdRef.current
        if (lastFavoriteId) {
            const lastFavorite = favoriteMap.get(lastFavoriteId)
            if (lastFavorite && !lastFavorite.disabled) {
                selectFavorite(lastFavorite.id)
                return
            }
            lastFavoriteIdRef.current = null
        }

        const firstEnabledFavorite = favorites.find(favorite => !favorite.disabled)
        if (firstEnabledFavorite) {
            selectFavorite(firstEnabledFavorite.id)
        } else {
            selectQuickMode(CUSTOM_FAVORITE_ID)
        }
    }, [
        agentConfigLoading,
        favoriteMap,
        favoritesLoading,
        favorites,
        favoriteOrderLoaded,
        hasPrefillData,
        initialIsDraft,
        open,
        persistedDefaultsLoaded,
        selectFavorite,
        selectQuickMode,
        selectedPresetId,
        selectedVariantId,
    ])

    useEffect(() => {
        if (!open || !selectedFavoriteId) {
            return
        }
        if (isQuickModeId(selectedFavoriteId)) {
            return
        }
        if (!favoriteMap.has(selectedFavoriteId)) {
            lastFavoriteIdRef.current = null
            selectQuickMode(CUSTOM_FAVORITE_ID)
        }
    }, [favoriteMap, open, selectedFavoriteId, selectQuickMode])

    // Register prefill event listener immediately, not dependent on open state
    // This ensures we can catch events that are dispatched right when the modal opens
    useEffect(() => {
        const prefillHandler = (detailArg?: NewSessionPrefillDetail) => {
            logger.info('[NewSessionModal] Received prefill event with detail:', detailArg)
            const detail = detailArg || {}
            const nameFromDraft: string | undefined = detail.name
            const taskContentFromDraft: string | undefined = detail.taskContent
            const lockName: boolean | undefined = detail.lockName
            const fromDraft: boolean | undefined = detail.fromDraft
            const baseBranchFromDraft: string | undefined = detail.baseBranch
            const originalSpecNameFromDraft: string | undefined = detail.originalSpecName
            const epicIdFromDraft: string | null | undefined = detail.epicId

            if (nameFromDraft) {
                logger.info('[NewSessionModal] Setting name from prefill:', nameFromDraft)
                setName(nameFromDraft)
                wasEditedRef.current = true
                setWasEdited(true)
                setNameLocked(!!lockName)
            }
            if (typeof taskContentFromDraft === 'string') {
                logger.info('[NewSessionModal] Setting agent content from prefill:', taskContentFromDraft.substring(0, 100), '...')
                setPromptSource('custom')
                setGithubIssueSelection(null)
                setGithubPrSelection(null)
                setGithubIssueLoading(false)
                setGithubPrLoading(false)
                setManualPromptDraft(taskContentFromDraft)
                setTaskContent(taskContentFromDraft)
            }
            if (baseBranchFromDraft) {
                logger.info('[NewSessionModal] Setting base branch from prefill:', baseBranchFromDraft)
                setBaseBranch(baseBranchFromDraft)
            }
            if (originalSpecNameFromDraft) {
                logger.info('[NewSessionModal] Setting original spec name from prefill:', originalSpecNameFromDraft)
                setOriginalSpecName(originalSpecNameFromDraft)
            }
            if (epicIdFromDraft !== undefined) {
                logger.info('[NewSessionModal] Setting epic from prefill:', epicIdFromDraft)
                setEpicId(epicIdFromDraft)
            }
            if (fromDraft) {
                 logger.info('[NewSessionModal] Running from existing spec - forcing createAsDraft to false')
                 setCreateAsDraft(false)
             }
            if (detail.versionGroupId) {
                setVersionGroupId(detail.versionGroupId)
            }
            if (detail.isConsolidation) {
                setIsConsolidation(true)
            }
            if (detail.consolidationSourceIds) {
                setConsolidationSourceIds(detail.consolidationSourceIds)
            }
            if (detail.agentType) {
                const validAgent = AGENT_TYPES.find(a => a === detail.agentType) as AgentType | undefined
                if (validAgent) {
                    setAgentType(validAgent)
                    setIgnorePersistedAgentType(true)
                    hasAgentOverrideRef.current = true
                }
            }
            if (detail.variantId) {
                const variant = agentVariantsList.find(v => v.id === detail.variantId)
                if (variant) handleVariantSelect(variant)
            }
            if (detail.presetId) {
                setSelectedPresetId(detail.presetId)
                setPresetTabActive(true)
            }
            if (detail.prNumber != null) {
                setPrefillPrNumber(detail.prNumber)
                setPrefillPrUrl(detail.prUrl ?? null)
            }
            if (detail.issueNumber != null) {
                setPrefillIssueNumber(detail.issueNumber)
                setPrefillIssueUrl(detail.issueUrl ?? null)
            }

            setIsPrefillPending(false)
            setHasPrefillData(true)
            logger.info('[NewSessionModal] Prefill data processed, hasPrefillData set to true')
        }
        
        // Listen for a notification that prefill is coming
        const prefillPendingHandler = () => {
            logger.info('[NewSessionModal] Prefill pending notification received')
            setIsPrefillPending(true)
            setIsConsolidation(false)
            setConsolidationSourceIds([])
            setVersionGroupId(undefined)
        }
        
        const cleanupPrefill = listenUiEvent(UiEvent.NewSessionPrefill, prefillHandler)
        const cleanupPending = listenUiEvent(UiEvent.NewSessionPrefillPending, prefillPendingHandler)
        return () => {
            cleanupPrefill()
            cleanupPending()
        }
    }, [agentVariantsList, handleVariantSelect])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (unifiedSearchOpenRef.current) {
                    return
                }
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                onClose()
            } else if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }

                const targetIndex = Number.parseInt(e.key, 10) - 1
                if (targetIndex === 0) {
                    if (selectedFavoriteId !== SPEC_FAVORITE_ID) {
                        selectQuickMode(SPEC_FAVORITE_ID)
                    }
                    return
                }
                const favoriteIndex = targetIndex - 1
                if (favoriteIndex < favorites.length) {
                    const favorite = favorites[favoriteIndex]
                    if (favorite && !favorite.disabled && selectedFavoriteId !== favorite.id) {
                        selectFavorite(favorite.id)
                    }
                    return
                }
                if (favoriteIndex === favorites.length && selectedFavoriteId !== CUSTOM_FAVORITE_ID) {
                    selectQuickMode(CUSTOM_FAVORITE_ID)
                }
            } else if (e.key === 'k' && e.metaKey && e.shiftKey) {
                e.preventDefault()
                e.stopPropagation()
                setUnifiedSearchOpen(prev => !prev)
            } else if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                createRef.current()
            } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.metaKey) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }

                const availableAgents = AGENT_TYPES.filter(agent => agent === 'terminal' || isAvailable(agent))
                if (availableAgents.length === 0) return

                const currentIndex = availableAgents.indexOf(agentType)
                let nextIndex: number

                if (e.key === 'ArrowUp') {
                    nextIndex = currentIndex === 0 ? availableAgents.length - 1 : currentIndex - 1
                } else {
                    nextIndex = currentIndex === availableAgents.length - 1 ? 0 : currentIndex + 1
                }

                handleAgentTypeChange(availableAgents[nextIndex])
            } else if (
                agentType === 'codex' &&
                (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
                e.metaKey
            ) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }

                if (codexModelIds.length === 0) {
                    return
                }

                const currentPrefs = agentPreferencesRef.current.codex ?? { model: '', reasoningEffort: '' }
                const currentModel = currentPrefs.model?.trim() || defaultCodexModelId || codexModelIds[0] || ''
                const modelMeta = currentModel ? getCodexModelMetadata(currentModel, codexCatalog.models) : undefined
                const reasoningOptions = modelMeta?.reasoningOptions?.map(option => option.id) ?? []
                if (reasoningOptions.length === 0) {
                    return
                }

                const currentReasoning = currentPrefs.reasoningEffort?.trim() ?? ''
                let currentIndex = reasoningOptions.indexOf(currentReasoning)
                if (currentIndex === -1) {
                    currentIndex = e.key === 'ArrowLeft' ? reasoningOptions.length - 1 : 0
                }

                const nextIndex = e.key === 'ArrowLeft'
                    ? (currentIndex === 0 ? reasoningOptions.length - 1 : currentIndex - 1)
                    : (currentIndex === reasoningOptions.length - 1 ? 0 : currentIndex + 1)

                const nextEffort = reasoningOptions[nextIndex]
                if (nextEffort !== currentReasoning) {
                    handleAgentPreferenceChange('codex', 'reasoningEffort', nextEffort)
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        const setDraftHandler = () => {
            logger.info('[NewSessionModal] Received set-spec event - setting createAsDraft to true')
            setCreateAsDraft(true)
        }
        window.addEventListener('schaltwerk:new-session:set-spec', setDraftHandler)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('schaltwerk:new-session:set-spec', setDraftHandler)
        }
    }, [open, onClose, agentType, handleAgentTypeChange, handleAgentPreferenceChange, isAvailable, codexModelIds, codexCatalog, defaultCodexModelId, favorites, selectFavorite, selectQuickMode, selectedFavoriteId])

    if (!open) return null

    const canStartAgent = multiAgentMode
        ? normalizedAgentTypes.length > 0 && normalizedAgentTypes.every(selectedAgent => selectedAgent === 'terminal' || isAvailable(selectedAgent))
        : agentType === 'terminal' || isAvailable(agentType)
    const hasSpecContent =
        promptSource === 'github_issue'
            ? Boolean(githubIssueSelection?.prompt.trim())
            : promptSource === 'github_pull_request'
                ? Boolean(githubPrSelection?.prompt.trim())
                : Boolean(taskContent.trim())
    const requiresIssueSelection = promptSource === 'github_issue' && !githubIssueSelection
    const requiresPrSelection = promptSource === 'github_pull_request' && !githubPrSelection
    const multiAgentSelectionInvalid = !createAsDraft && multiAgentMode && normalizedAgentTypes.length === 0
    const isStartDisabled =
        !name.trim() ||
        (!createAsDraft && !baseBranch) ||
        creating ||
        githubIssueLoading ||
        githubPrLoading ||
        (createAsDraft && !hasSpecContent) ||
        multiAgentSelectionInvalid ||
        (!createAsDraft && !canStartAgent) ||
        requiresIssueSelection ||
        requiresPrSelection

    const getStartButtonTitle = () => {
        if (createAsDraft) {
            return t.newSessionModal.tooltips.createSpec
        }
        if (githubIssueLoading) {
            return t.newSessionModal.tooltips.fetchingIssue
        }
        if (githubPrLoading) {
            return t.newSessionModal.tooltips.fetchingPr
        }
        if (requiresIssueSelection) {
            return t.newSessionModal.tooltips.selectIssuePrompt
        }
        if (requiresPrSelection) {
            return t.newSessionModal.tooltips.selectPrPrompt
        }
        if (multiAgentMode && normalizedAgentTypes.length === 0) {
            return t.newSessionModal.tooltips.selectAgentPrompt
        }
        if (!canStartAgent) {
            return multiAgentMode
                ? t.newSessionModal.tooltips.agentsNotInstalled
                : t.newSessionModal.tooltips.agentNotInstalled.replace('{agent}', agentType)
        }
        return t.newSessionModal.tooltips.startAgent
    }

    const favoriteTooltip = (agentTypes: AgentType[], disabled: boolean) => {
        if (!disabled) {
            return undefined
        }
        if (agentTypes.length === 1) {
            return t.newSessionModal.tooltips.agentNotInstalled.replace('{agent}', agentTypes[0])
        }
        return t.newSessionModal.tooltips.agentsNotInstalled
    }

    const isSpecMode = selectedFavoriteId === SPEC_FAVORITE_ID
    const isFavoriteMode = selectedFavoriteId !== null && !isQuickModeId(selectedFavoriteId)
    const showVersionControls = !createAsDraft && agentType !== 'terminal' && !isFavoriteMode

    const footer = (
        <>
            {showVersionControls && multiAgentMode && (
                <MultiAgentAllocationDropdown
                    allocations={multiAgentAllocations}
                    selectableAgents={MULTI_AGENT_TYPES}
                    totalCount={totalMultiAgentCount}
                    maxCount={MAX_VERSION_COUNT}
                    summaryLabel={multiAgentSummaryLabel}
                    isAgentAvailable={isAvailable}
                    onToggleAgent={handleAgentToggle}
                    onChangeCount={handleAgentCountChange}
                />
            )}
            {showVersionControls && (
                <Dropdown
                  open={showVersionMenu}
                  onOpenChange={setShowVersionMenu}
                  items={VERSION_DROPDOWN_ITEMS}
                  selectedKey={multiAgentMode ? 'multi' : String(versionCount)}
                  align="right"
                  onSelect={handleVersionSelect}
                  menuTestId="version-selector-menu"
                >
                  {({ open, toggle }) => (
                    <button
                      type="button"
                      data-testid="version-selector"
                      onClick={toggle}
                      className="px-2 h-9 rounded inline-flex items-center gap-2 hover:opacity-90"
                      style={{
                        backgroundColor: open ? 'var(--color-bg-hover)' : 'var(--color-bg-elevated)',
                        color: 'var(--color-text-primary)',
                        border: `1px solid ${open ? 'var(--color-border-default)' : 'var(--color-border-subtle)'}`,
                      }}
                      title={multiAgentMode ? t.newSessionModal.configureAgents : t.newSessionModal.parallelVersions}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', verticalAlign: 'middle' }}>
                        <path d="M12 2L3 6l9 4 9-4-9-4z" fill="var(--color-text-primary)" fillOpacity={0.9}/>
                        <path d="M3 10l9 4 9-4" stroke="var(--color-text-primary)" strokeOpacity={0.5} strokeWidth={1.2}/>
                        <path d="M3 14l9 4 9-4" stroke="var(--color-text-primary)" strokeOpacity={0.35} strokeWidth={1.2}/>
                      </svg>
                      <span style={{ lineHeight: 1 }}>
                        {multiAgentMode ? multiAgentSummaryLabel : `${versionCount}x`}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </Dropdown>
            )}
            <button
                onClick={onClose}
                className="px-3 h-9 rounded group relative hover:opacity-90 inline-flex items-center"
                style={{ backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
                title={t.newSessionModal.cancelEsc}
            >
                {t.newSessionModal.cancel}
                <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">{t.newSessionModal.esc}</span>
            </button>
            <button
                onClick={() => { void handleCreate() }}
                disabled={isStartDisabled}
                className={`px-3 h-9 disabled:cursor-not-allowed rounded group relative inline-flex items-center gap-2 ${isStartDisabled ? 'opacity-60' : 'hover:opacity-90'}`}
                style={{
                    backgroundColor: createAsDraft ? 'var(--color-accent-amber)' : 'var(--color-accent-blue)',
                    color: 'var(--color-text-inverse)',
                    opacity: creating ? 0.9 : 1
                }}
                title={getStartButtonTitle()}
            >
                {creating && (
                    <span
                        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current/60 border-t-transparent"
                        aria-hidden="true"
                    />
                )}
                <span>{createAsDraft ? t.newSessionModal.createSpec : t.newSessionModal.startAgent}</span>
                {!creating && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">{t.newSessionModal.cmdEnter}</span>}
            </button>
        </>
    )

    return (
        <ResizableModal
            isOpen={open}
            onClose={onClose}
            title={createAsDraft ? t.newSessionModal.createNewSpec : t.newSessionModal.startNewAgent}
            storageKey="new-session"
            defaultWidth={720}
            defaultHeight={700}
            minWidth={600}
            minHeight={500}
            footer={footer}
            escapeDisabled={unifiedSearchOpen}
	        >
	            <div className="flex flex-col h-full p-4 gap-4">
	                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                    <div>
	                        <FormGroup label={t.newSessionModal.agentName} htmlFor="new-session-name" error={nameError || undefined}>
	                            <TextInput
	                                id="new-session-name"
	                                ref={nameInputRef}
	                                value={name}
	                                onChange={handleNameChange}
                                    onFocus={() => { setWasEdited(true); wasEditedRef.current = true }}
                                    onKeyDown={() => { setWasEdited(true); wasEditedRef.current = true }}
                                    onInput={() => { setWasEdited(true); wasEditedRef.current = true }}
	                                placeholder="eager_cosmos"
	                                disabled={nameLocked}
                                    rightElement={
                                        <button
                                            type="button"
                                            data-testid="generate-name-button"
                                            onClick={() => { void handleGenerateName() }}
                                            disabled={generatingName || nameLocked || !taskContent.trim()}
                                            className={`inline-flex h-7 w-7 items-center justify-center rounded ${generatingName || nameLocked || !taskContent.trim() ? 'cursor-not-allowed opacity-40' : 'hover:bg-[rgba(var(--color-bg-hover-rgb),0.45)]'}`}
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
                        {originalSpecName && (
                            <div className="flex items-center justify-between mt-2 px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
                                <div className="flex items-center gap-2">
                                    <svg className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-accent-blue)' }} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v1.5h16V5a2 2 0 00-2-2H4zm14 6H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM2 7h16v1H2V7z" clipRule="evenodd" />
                                    </svg>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>{t.newSessionModal.fromSpec}: <span style={{ color: 'var(--color-text-primary)' }}>{originalSpecName}</span></span>
                                </div>
                                {name !== originalSpecName && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setName(originalSpecName)
                                            setWasEdited(true)
                                            wasEditedRef.current = true
                                        }}
                                        className="ml-2 px-2 py-0.5 rounded text-xs hover:opacity-80"
                                        style={{ backgroundColor: 'var(--color-accent-blue-bg)', color: 'var(--color-accent-blue)' }}
                                        title={t.newSessionModal.resetToOriginal}
                                    >
                                        {t.newSessionModal.reset}
                                    </button>
                                )}
                            </div>
	                        )}
	                    </div>
	
	                    <div>
	                        <label className="block text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t.newSessionModal.epic}</label>
	                        <EpicSelect
	                            value={selectedEpic}
	                            onChange={setEpicId}
	                            variant="field"
	                            showDeleteButton
	                        />
	                    </div>
	                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="overflow-x-auto">
                            <div className="flex gap-3 pb-1">
                                <FavoriteCard
                                    key={SPEC_FAVORITE_ID}
                                    title={t.newSessionModal.quickModeSpec}
                                    shortcut={favoriteShortcutLabel(0)}
                                    summary={t.newSessionModal.quickModeSpecSummary}
                                    accentColor="var(--color-accent-amber)"
                                    selected={selectedFavoriteId === SPEC_FAVORITE_ID}
                                    onClick={() => selectQuickMode(SPEC_FAVORITE_ID)}
                                />
                                {favorites.map((favorite, index) => {
                                    const shortcutIndex = index + 1
                                    return (
                                        <FavoriteCard
                                            key={favorite.id}
                                            title={favorite.name}
                                            shortcut={shortcutIndex < 9 ? favoriteShortcutLabel(shortcutIndex) : ''}
                                            summary={favorite.summary}
                                            accentColor={favoriteAccentColor(favorite.agentType)}
                                            selected={selectedFavoriteId === favorite.id}
                                            modified={selectedFavoriteId === favorite.id && favoriteModified}
                                            modifiedLabel={t.newSessionModal.modified}
                                            disabled={favorite.disabled}
                                            tooltip={favoriteTooltip(favorite.agentTypes, favorite.disabled)}
                                            onClick={() => selectFavorite(favorite.id)}
                                        />
                                    )
                                })}
                                <FavoriteCard
                                    key={CUSTOM_FAVORITE_ID}
                                    title={t.newSessionModal.quickModeCustom}
                                    shortcut={favorites.length + 1 < 9 ? favoriteShortcutLabel(favorites.length + 1) : ''}
                                    summary={t.newSessionModal.quickModeCustomSummary}
                                    accentColor="var(--color-border-strong)"
                                    selected={selectedFavoriteId === CUSTOM_FAVORITE_ID}
                                    onClick={() => selectQuickMode(CUSTOM_FAVORITE_ID)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                {createAsDraft ? t.newSessionModal.specContent : t.newSessionModal.initialPrompt}
                            </label>
                            <button
                                type="button"
                                data-testid="start-from-button"
                                onClick={() => setUnifiedSearchOpen(true)}
                                className="px-3 py-1 text-xs rounded transition-colors hover:opacity-90 flex items-center gap-1.5"
                                style={{
                                    backgroundColor: 'var(--color-bg-elevated)',
                                    color: 'var(--color-text-primary)',
                                    border: '1px solid var(--color-border-subtle)',
                                }}
                            >
                                {t.newSessionModal.startFrom}
                                <kbd
                                    className="px-1 rounded"
                                    style={{
                                        fontSize: theme.fontSize.caption,
                                        lineHeight: '1.3',
                                        backgroundColor: 'var(--color-bg-primary)',
                                        color: 'var(--color-text-muted)',
                                        border: '1px solid var(--color-border-subtle)',
                                    }}
                                >
                                    {'\u2318\u21E7K'}
                                </kbd>
                            </button>
                        </div>

                        {(promptSource === 'github_issue' && githubIssueSelection) && (
                            <div
                                className="flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded"
                                style={{
                                    backgroundColor: 'var(--color-accent-blue-bg)',
                                    border: '1px solid var(--color-accent-blue-border)',
                                }}
                                data-testid="github-selection-card"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-accent-blue)' }}>
                                        {t.newSessionModal.unifiedSearch.selectedIssue}
                                    </span>
                                    <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                                        #{githubIssueSelection.details.number} {githubIssueSelection.details.title}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setUnifiedSearchOpen(true)}
                                        className="px-2 py-0.5 text-xs rounded"
                                        style={{ color: 'var(--color-accent-blue)', backgroundColor: 'transparent' }}
                                    >
                                        {t.newSessionModal.unifiedSearch.change}
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="clear-selection-button"
                                        onClick={() => {
                                            setGithubIssueSelection(null)
                                            setPromptSource('custom')
                                            setGithubIssueLoading(false)
                                            setTaskContent(manualPromptDraft)
                                            onPromptChange?.(manualPromptDraft)
                                        }}
                                        className="px-2 py-0.5 text-xs rounded"
                                        style={{ color: 'var(--color-text-secondary)', backgroundColor: 'transparent' }}
                                    >
                                        {t.newSessionModal.unifiedSearch.clear}
                                    </button>
                                </div>
                            </div>
                        )}

                        {(promptSource === 'github_pull_request' && githubPrSelection) && (
                            <div
                                className="flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded"
                                style={{
                                    backgroundColor: 'var(--color-accent-blue-bg)',
                                    border: '1px solid var(--color-accent-blue-border)',
                                }}
                                data-testid="github-selection-card"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-accent-blue)' }}>
                                        {t.newSessionModal.unifiedSearch.selectedPr}
                                    </span>
                                    <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                                        #{githubPrSelection.details.number} {githubPrSelection.details.title}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setUnifiedSearchOpen(true)}
                                        className="px-2 py-0.5 text-xs rounded"
                                        style={{ color: 'var(--color-accent-blue)', backgroundColor: 'transparent' }}
                                    >
                                        {t.newSessionModal.unifiedSearch.change}
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="clear-selection-button"
                                        onClick={() => {
                                            setGithubPrSelection(null)
                                            setPromptSource('custom')
                                            setGithubPrLoading(false)
                                            setTaskContent(manualPromptDraft)
                                            onPromptChange?.(manualPromptDraft)
                                        }}
                                        className="px-2 py-0.5 text-xs rounded"
                                        style={{ color: 'var(--color-text-secondary)', backgroundColor: 'transparent' }}
                                    >
                                        {t.newSessionModal.unifiedSearch.clear}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="flex-1 min-h-0 overflow-hidden">
                            <div className="h-full" data-testid="session-task-editor">
                                <MarkdownEditor
                                    ref={markdownEditorRef}
                                    value={taskContent}
                                    onChange={value => {
                                        if (promptSource === 'custom') {
                                            updateManualPrompt(value)
                                        } else {
                                            setTaskContent(value)
                                            onPromptChange?.(value)
                                        }
                                        if (validationError) {
                                            setValidationError('')
                                        }
                                    }}
                                    placeholder={
                                        createAsDraft
                                            ? t.newSessionModal.enterSpecContent
                                            : t.newSessionModal.describeAgent
                                    }
                                    className="h-full"
                                    fileReferenceProvider={projectFileIndex}
                                />
                            </div>
                        </div>
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                            {promptSource === 'github_issue'
                                ? t.newSessionModal.issueSelectHint
                                : promptSource === 'github_pull_request'
                                    ? t.newSessionModal.prSelectHint
                                    : createAsDraft
                                    ? (
                                        <>
                                            <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path
                                                    fillRule="evenodd"
                                                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                            {t.newSessionModal.specSaveHint}
                                        </>
                                    )
                                    : t.newSessionModal.referenceFiles}
                        </p>
                    </div>

                    <UnifiedSearchModal
                        open={unifiedSearchOpen}
                        onClose={() => setUnifiedSearchOpen(false)}
                        githubReady={githubPromptReady}
                        onSelectBranch={(branch) => {
                            setBaseBranch(branch)
                            setUseExistingBranch(true)
                            setCustomBranch(branch)
                            setUnifiedSearchOpen(false)
                        }}
                        onSelectIssue={(selection) => {
                            setGithubIssueSelection(selection)
                            setGithubPrSelection(null)
                            setManualPromptDraft(taskContent)
                            setTaskContent(selection.prompt)
                            setPromptSource('github_issue')
                            onPromptChange?.(selection.prompt)
                            if (!wasEditedRef.current) {
                                const derivedName = titleToSessionName(
                                    selection.details.title,
                                    selection.details.number
                                )
                                if (derivedName) {
                                    setName(derivedName)
                                }
                            }
                            if (validationError) {
                                setValidationError('')
                            }
                            setUnifiedSearchOpen(false)
                        }}
                        onSelectPr={(selection) => {
                            setGithubPrSelection(selection)
                            setGithubIssueSelection(null)
                            setManualPromptDraft(taskContent)
                            setTaskContent(selection.prompt)
                            setPromptSource('github_pull_request')
                            setBaseBranch(selection.details.headRefName)
                            onPromptChange?.(selection.prompt)
                            if (!wasEditedRef.current) {
                                const derivedName = titleToSessionName(
                                    selection.details.title,
                                    selection.details.number
                                )
                                if (derivedName) {
                                    setName(derivedName)
                                }
                            }
                            if (validationError) {
                                setValidationError('')
                            }
                            setUnifiedSearchOpen(false)
                        }}
                    />

                    {repositoryIsEmpty && !createAsDraft && (
                        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 flex items-start gap-2">
                            <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="text-sm text-amber-200">
                                <p className="font-medium mb-1">{t.newSessionModal.newRepositoryDetected}</p>
                                <p className="text-xs text-amber-300">
                                    {t.newSessionModal.newRepositoryHint}
                                </p>
                            </div>
                        </div>
                    )}

                    {!isSpecMode && (
                    <CustomizeAccordion
                        title={t.newSessionModal.customize}
                        expanded={customizeExpanded}
                        onToggle={() => setCustomizeExpanded(prev => !prev)}
                    >
                        <div className="flex flex-col gap-4">
                            {!createAsDraft && (
                                <>
                                    <SessionConfigurationPanel
                                        variant="modal"
                                        layout="branch-row"
                                        hideAgentType={presetTabActive}
                                        onBaseBranchChange={handleBranchChange}
                                        onAgentTypeChange={handleAgentTypeChange}
                                        onSkipPermissionsChange={handleSkipPermissionsChange}
                                        onAutonomyChange={setAutonomyEnabled}
                                        onCustomBranchChange={(branch) => {
                                            setCustomBranch(branch)
                                            if (validationError) {
                                                setValidationError('')
                                            }
                                        }}
                                        onUseExistingBranchChange={(useExisting) => {
                                            setUseExistingBranch(useExisting)
                                            if (validationError) {
                                                setValidationError('')
                                            }
                                        }}
                                        initialBaseBranch={baseBranch}
                                        initialAgentType={agentType}
                                        initialSkipPermissions={skipPermissions}
                                        initialAutonomyEnabled={autonomyEnabled}
                                        initialCustomBranch={customBranch}
                                        initialUseExistingBranch={useExistingBranch}
                                        codexModel={agentPreferences.codex?.model}
                                        codexModelOptions={codexModelIds}
                                        codexModels={codexCatalog.models}
                                        onCodexModelChange={(model) => handleAgentPreferenceChange('codex', 'model', model)}
                                        codexReasoningEffort={agentPreferences.codex?.reasoningEffort}
                                        onCodexReasoningChange={(effort) => handleAgentPreferenceChange('codex', 'reasoningEffort', effort)}
                                        sessionName={name}
                                        ignorePersistedAgentType={ignorePersistedAgentType}
                                        agentControlsDisabled={multiAgentMode}
                                        branchError={branchError}
                                    />
                                    {agentPresetsList.length > 0 && (
                                        <div className="flex rounded border overflow-hidden mt-2" style={{ borderColor: 'var(--color-border-default)' }} role="tablist">
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={!presetTabActive}
                                                className="flex-1 px-3 py-1.5 text-sm cursor-pointer transition-colors"
                                                style={{
                                                    backgroundColor: !presetTabActive ? 'var(--color-bg-elevated)' : 'transparent',
                                                    color: !presetTabActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                                    fontWeight: !presetTabActive ? 500 : 400,
                                                }}
                                                onClick={() => {
                                                    setPresetTabActive(false)
                                                    setSelectedPresetId(null)
                                                    resetMultiAgentSelections()
                                                }}
                                            >
                                                {t.sessionConfig.agent}
                                            </button>
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={presetTabActive}
                                                className="flex-1 px-3 py-1.5 text-sm cursor-pointer transition-colors"
                                                style={{
                                                    backgroundColor: presetTabActive ? 'var(--color-bg-elevated)' : 'transparent',
                                                    color: presetTabActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                                    fontWeight: presetTabActive ? 500 : 400,
                                                }}
                                                onClick={() => {
                                                    setPresetTabActive(true)
                                                }}
                                            >
                                                {t.newSessionModal.preset ?? 'Preset'}
                                            </button>
                                        </div>
                                    )}
                                    {presetTabActive && (
                                        <div className="mt-1">
                                            <Dropdown
                                                open={presetDropdownOpen}
                                                onOpenChange={setPresetDropdownOpen}
                                                items={[
                                                    { key: '', label: t.newSessionModal.noPreset ?? 'No preset' },
                                                    ...agentPresetsList.map(p => ({
                                                        key: p.id,
                                                        label: `${p.name} (${p.slots.length} agents)`,
                                                    })),
                                                ]}
                                                selectedKey={selectedPresetId ?? ''}
                                                align="stretch"
                                                onSelect={(key) => {
                                                    const id = key || null
                                                    setSelectedPresetId(id)
                                                    if (id) {
                                                        setSelectedVariantId(null)
                                                        resetMultiAgentSelections()
                                                    }
                                                }}
                                            >
                                                {({ open, toggle }) => (
                                                    <button
                                                        type="button"
                                                        onClick={toggle}
                                                        className="w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between cursor-pointer hover:opacity-80"
                                                        style={{
                                                            backgroundColor: 'var(--color-bg-elevated)',
                                                            borderColor: 'var(--color-border-default)',
                                                            color: 'var(--color-text-primary)',
                                                        }}
                                                    >
                                                        <span>{selectedPresetId
                                                            ? agentPresetsList.find(p => p.id === selectedPresetId)?.name ?? 'Preset'
                                                            : (t.newSessionModal.noPreset ?? 'No preset')}</span>
                                                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"
                                                             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </Dropdown>
                                        </div>
                                    )}
                                    {agentVariantsList.length > 0 && !selectedPresetId && !presetTabActive && (
                                        <div className="mt-2">
                                            <label className="block text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                                                {t.newSessionModal.variant ?? 'Variant'}
                                            </label>
                                            <Dropdown
                                                open={variantDropdownOpen}
                                                onOpenChange={setVariantDropdownOpen}
                                                items={[
                                                    { key: '', label: t.newSessionModal.noVariant ?? 'No variant (use defaults)' },
                                                    ...agentVariantsList.map(v => ({
                                                        key: v.id,
                                                        label: `${v.name} (${v.agentType}${v.model ? ` / ${v.model}` : ''})`,
                                                    })),
                                                ]}
                                                selectedKey={selectedVariantId ?? ''}
                                                align="stretch"
                                                onSelect={(key) => {
                                                    if (!key) {
                                                        handleVariantSelect(null)
                                                    } else {
                                                        const variant = agentVariantsList.find(v => v.id === key)
                                                        if (variant) handleVariantSelect(variant)
                                                    }
                                                }}
                                            >
                                                {({ open, toggle }) => (
                                                    <button
                                                        type="button"
                                                        onClick={toggle}
                                                        className="w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between cursor-pointer hover:opacity-80"
                                                        style={{
                                                            backgroundColor: 'var(--color-bg-elevated)',
                                                            borderColor: 'var(--color-border-default)',
                                                            color: 'var(--color-text-primary)',
                                                        }}
                                                    >
                                                        <span>{selectedVariantId
                                                            ? agentVariantsList.find(v => v.id === selectedVariantId)?.name ?? 'Variant'
                                                            : (t.newSessionModal.noVariant ?? 'No variant (use defaults)')}</span>
                                                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"
                                                             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </Dropdown>
                                        </div>
                                    )}
                                    <AgentDefaultsSection
                                        agentType={agentType}
                                        cliArgs={agentCliArgs[agentType] || ''}
                                        onCliArgsChange={handleCliArgsChange}
                                        envVars={agentEnvVars[agentType]}
                                        onEnvVarChange={handleEnvVarChange}
                                        onAddEnvVar={handleAddEnvVar}
                                        onRemoveEnvVar={handleRemoveEnvVar}
                                        loading={agentConfigLoading}
                                    />
                                    {agentType === 'terminal' && (
                                        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 flex items-start gap-2">
                                            <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <div className="text-sm text-blue-200">
                                                <p className="font-medium mb-1">{t.newSessionModal.terminalOnlyMode}</p>
                                                <p className="text-xs text-blue-300">
                                                    {t.newSessionModal.terminalOnlyHint}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </CustomizeAccordion>
                    )}
                </div>
        </ResizableModal>
    )
}
