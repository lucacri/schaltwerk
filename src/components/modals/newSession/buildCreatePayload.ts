import {
    MultiAgentAllocations,
    normalizeAllocations,
} from '../MultiAgentAllocationDropdown'
import type { AgentLaunchSlot } from '../../../types/agentLaunch'
import type { AgentType } from '../../../types/session'
import type { FavoriteOption } from './favoriteOptions'

export interface PassthroughPrefillState {
    issueNumber?: number
    issueUrl?: string
    prNumber?: number
    prUrl?: string
    epicId?: string | null
    versionGroupId?: string
    isConsolidation?: boolean
    consolidationSourceIds?: string[]
    consolidationRoundId?: string
    consolidationRole?: 'candidate' | 'judge'
    consolidationConfirmationMode?: 'confirm' | 'auto-promote'
}

export interface CreateSessionPayload extends PassthroughPrefillState {
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
    autonomyEnabled?: boolean
}

export interface AdvancedSessionState {
    autonomyEnabled: boolean
    multiAgentAllocations: MultiAgentAllocations
}

export function createEmptyAdvancedState(): AdvancedSessionState {
    return {
        autonomyEnabled: false,
        multiAgentAllocations: {},
    }
}

export type BuildCreatePayloadCode = 'INVALID_NAME' | 'EMPTY_SPEC'

export class BuildCreatePayloadError extends Error {
    readonly code: BuildCreatePayloadCode
    constructor(code: BuildCreatePayloadCode, message: string) {
        super(message)
        this.name = 'BuildCreatePayloadError'
        this.code = code
    }
}

export interface BuildCreatePayloadInput {
    selection: FavoriteOption
    name: string
    prompt: string
    userEditedName: boolean
    baseBranch: string
    advanced: AdvancedSessionState
    versionCount?: number
    passthrough?: PassthroughPrefillState
}

function trimmedOrUndefined(value: string): string | undefined {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

export function buildCreatePayload(input: BuildCreatePayloadInput): CreateSessionPayload {
    const { selection, name, prompt, userEditedName, baseBranch, advanced, versionCount, passthrough } = input

    if (name.trim().length === 0) {
        throw new BuildCreatePayloadError('INVALID_NAME', 'Agent name must not be empty')
    }

    if (selection.kind === 'spec') {
        if (prompt.trim().length === 0) {
            throw new BuildCreatePayloadError('EMPTY_SPEC', 'Spec content must not be empty')
        }
        return {
            name,
            isSpec: true,
            draftContent: prompt,
            userEditedName,
            baseBranch: '',
            ...passthrough,
        }
    }

    if (selection.kind === 'preset') {
        const slots: AgentLaunchSlot[] = selection.preset.slots.map(slot => ({
            agentType: slot.agentType,
            autonomyEnabled: slot.autonomyEnabled,
        }))
        const primary = slots[0]?.agentType
        const payload: CreateSessionPayload = {
            name,
            prompt: trimmedOrUndefined(prompt),
            baseBranch,
            userEditedName,
            agentType: primary,
            agentSlots: slots,
            versionCount: slots.length,
            ...passthrough,
        }
        return payload
    }

    const agent = selection.agentType
    const allocations = advanced.multiAgentAllocations
    const multiAgentTypes = normalizeAllocations(allocations)
    const useMultiAgent = multiAgentTypes.length > 0
    const resolvedVersionCount = useMultiAgent
        ? multiAgentTypes.length
        : Math.max(1, Math.min(4, versionCount ?? 1))
    const autonomyEnabled = agent === 'terminal' ? false : advanced.autonomyEnabled

    const payload: CreateSessionPayload = {
        name,
        prompt: trimmedOrUndefined(prompt),
        baseBranch,
        userEditedName,
        agentType: agent,
        versionCount: resolvedVersionCount,
        autonomyEnabled,
        ...passthrough,
    }
    if (useMultiAgent) {
        payload.agentTypes = multiAgentTypes
    }
    return payload
}
