import { stableSessionTerminalId } from '../../../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../../../common/terminalTargeting'
import { getPasteSubmissionOptions } from '../../../common/terminalPaste'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'

interface ResolveMergeRequestParams {
    sessionName: string
    session: EnrichedSession
    conflictingPaths: string[]
    parentBranch: string | null | undefined
    selection: Selection
    topTerminalId: string | undefined
}

interface ResolveMergeRequest {
    terminalId: string
    prompt: string
    useBracketedPaste: boolean
    needsDelayedSubmit: boolean
}

export function buildResolveMergeInAgentRequest({
    sessionName,
    session,
    conflictingPaths,
    parentBranch,
    selection,
    topTerminalId,
}: ResolveMergeRequestParams): ResolveMergeRequest {
    const resolvedParentBranch = parentBranch || session.info.parent_branch || session.info.base_branch || 'main'
    const agentType = session.info.original_agent_type ?? undefined
    const { useBracketedPaste, needsDelayedSubmit } = getPasteSubmissionOptions(agentType)

    const baseTerminalId = (
        selection.kind === 'session'
        && selection.payload === sessionName
        && topTerminalId
    )
        ? topTerminalId
        : stableSessionTerminalId(sessionName, 'top')
    const terminalId = getActiveAgentTerminalId(sessionName) ?? baseTerminalId

    const conflictList = conflictingPaths.length > 0
        ? conflictingPaths.map(path => `- ${path}`).join('\n')
        : '- Run `git status` to inspect conflicted files'

    const prompt = [
        `Resolve the rebase conflicts in this session onto ${resolvedParentBranch}.`,
        '',
        'Conflicting files:',
        conflictList,
        '',
        'After resolving the conflicts, run:',
        'git rebase --continue',
    ].join('\n')

    return { terminalId, prompt, useBracketedPaste, needsDelayedSubmit }
}
