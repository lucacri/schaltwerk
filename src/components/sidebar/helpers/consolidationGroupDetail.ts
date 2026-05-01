import { SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'

export const buildConsolidationGroupDetail = (group: SessionVersionGroupType) => {
    const sourceVersions = group.versions.filter(version => !version.session.info.is_consolidation)
    const firstSession = sourceVersions[0]?.session?.info
    if (!firstSession) {
        return null
    }

    const groupEpicId = sourceVersions.find(version => version.session.info.epic?.id)?.session.info.epic?.id ?? null

    return {
        baseName: group.baseName,
        baseBranch: firstSession.base_branch,
        versionGroupId: firstSession.version_group_id ?? group.id,
        epicId: groupEpicId,
        sessions: sourceVersions.map(version => ({
            id: version.session.info.session_id,
            name: version.session.info.session_id,
            branch: version.session.info.branch,
            worktreePath: version.session.info.worktree_path,
            agentType: version.session.info.original_agent_type ?? undefined,
            diffStats: version.session.info.diff_stats ? {
                files_changed: version.session.info.diff_stats.files_changed,
                additions: version.session.info.diff_stats.additions,
                deletions: version.session.info.diff_stats.deletions,
            } : undefined,
        })),
    }
}
