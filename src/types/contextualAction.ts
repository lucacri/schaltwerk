import type { AgentType } from './session'

export type ContextualActionContext = 'pr' | 'issue' | 'both'
export type ContextualActionMode = 'spec' | 'session'

export interface ContextualAction {
    id: string
    name: string
    context: ContextualActionContext
    promptTemplate: string
    mode: ContextualActionMode
    agentType?: AgentType
    variantId?: string
    presetId?: string
    isBuiltIn: boolean
}

export const PR_TEMPLATE_VARIABLES = [
    'pr.title', 'pr.description', 'pr.author',
    'pr.sourceBranch', 'pr.targetBranch', 'pr.diff',
    'pr.url', 'pr.labels',
] as const

export const ISSUE_TEMPLATE_VARIABLES = [
    'issue.title', 'issue.description', 'issue.author',
    'issue.labels', 'issue.url',
] as const
