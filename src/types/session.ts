export const AGENT_TYPES = [
    'claude',
    'copilot',
    'opencode',
    'gemini',
    'codex',
    'droid',
    'qwen',
    'amp',
    'kilocode',
    'terminal'
] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export type EnabledAgents = Record<AgentType, boolean>

export const NON_TERMINAL_AGENTS = AGENT_TYPES.filter(a => a !== 'terminal')

export const TUI_BASED_AGENTS: readonly AgentType[] = ['kilocode', 'claude', 'opencode'] as const

export function isTuiAgent(agentType: string | null | undefined): boolean {
    if (!agentType) return false
    return TUI_BASED_AGENTS.includes(agentType as AgentType)
}

export const AGENT_SUPPORTS_SKIP_PERMISSIONS: Record<AgentType, boolean> = {
    claude: true,
    copilot: true,
    opencode: false,
    gemini: true,
    codex: true,
    droid: true,
    qwen: true,
    amp: true,
    kilocode: false,
    terminal: false
}

export function createAgentRecord<T>(factory: (agent: AgentType) => T): Record<AgentType, T> {
    return AGENT_TYPES.reduce((acc, agent) => {
        acc[agent] = factory(agent)
        return acc
    }, {} as Record<AgentType, T>)
}

export function createDefaultEnabledAgents(): EnabledAgents {
    return createAgentRecord(() => true)
}

export function mergeEnabledAgents(enabledAgents?: Partial<EnabledAgents> | null): EnabledAgents {
    return {
        ...createDefaultEnabledAgents(),
        ...(enabledAgents ?? {}),
    }
}

export function filterEnabledAgents(
    agents: readonly AgentType[],
    enabledAgents?: Partial<EnabledAgents> | null,
): AgentType[] {
    const merged = mergeEnabledAgents(enabledAgents)
    return agents.filter(agent => merged[agent])
}

export enum SessionState {
    Spec = 'spec',
    Processing = 'processing',
    Running = 'running',
    Reviewed = 'reviewed'
}

export type SpecStage = 'draft' | 'clarified'

export interface Epic {
    id: string
    name: string
    color?: string | null
}

export interface SessionInfo {
    session_id: string
    stable_id?: string
    display_name?: string
    version_group_id?: string
    version_number?: number
    epic?: Epic
    branch: string
    worktree_path: string
    base_branch: string
    original_base_branch?: string | null
    parent_branch?: string | null
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'spec'
    created_at?: string
    last_modified?: string
    last_modified_ts?: number
    has_uncommitted_changes?: boolean
    dirty_files_count?: number
    commits_ahead_count?: number
    has_conflicts?: boolean
    merge_has_conflicts?: boolean
    merge_conflicting_paths?: string[]
    merge_is_up_to_date?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    session_state: SessionState | 'spec' | 'processing' | 'running' | 'reviewed'
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    ready_to_merge?: boolean
    spec_content?: string
    spec_stage?: SpecStage
    original_agent_type?: AgentType
    original_skip_permissions?: boolean | null
    diff_stats?: DiffStats
    top_uncommitted_paths?: string[]
    attention_required?: boolean
    issue_number?: number
    issue_url?: string
    pr_number?: number
    pr_url?: string
    is_consolidation?: boolean
    consolidation_sources?: string[]
    promotion_reason?: string | null
    promotionReason?: string | null
}

export interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

export interface SessionMonitorStatus {
    session_name: string
    current_task: string
    test_status: 'passed' | 'failed' | 'unknown'
    diff_stats?: DiffStats
    last_update: string
}

export interface EnrichedSession {
    info: SessionInfo
    status?: SessionMonitorStatus
    terminals: string[]
    attention_required?: boolean
}

// Raw Session type returned from Tauri backend (from schaltwerk_core_get_session)
export interface RawSession {
    id: string
    name: string
    display_name?: string
    version_group_id?: string
    version_number?: number
    epic_id?: string | null
    repository_path: string
    repository_name: string
    branch: string
    parent_branch?: string
    worktree_path: string
    status: 'active' | 'cancelled' | 'spec'
    created_at: string
    updated_at: string
    last_activity?: string
    initial_prompt?: string
    ready_to_merge: boolean
    original_agent_type?: AgentType
    original_skip_permissions?: boolean
    pending_name_generation: boolean
    was_auto_generated: boolean
    spec_content?: string
    spec_stage?: SpecStage
    session_state: 'spec' | 'processing' | 'running' | 'reviewed'
    git_stats?: {
        files_changed: number
        additions: number
        deletions: number
        insertions: number
    }
    issue_number?: number
    issue_url?: string
    pr_number?: number
    pr_url?: string
    is_consolidation?: boolean
    consolidation_sources?: string[]
    promotion_reason?: string | null
    promotionReason?: string | null
}

export interface RawSpec {
    id: string
    name: string
    display_name?: string
    repository_path: string
    repository_name: string
    content: string
    stage: SpecStage
    attention_required: boolean
    clarification_started: boolean
    created_at: string
    updated_at: string
}
