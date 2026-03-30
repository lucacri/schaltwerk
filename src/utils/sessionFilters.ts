import { EnrichedSession } from '../types/session'
import { isReviewed, isRunning, isSpec, mapSessionUiState } from './sessionState'
import { getSessionDisplayName } from './sessionDisplayName'
import { getSessionVersionGroupAggregate, groupSessionsByVersion } from './sessionVersions'

export { mapSessionUiState, isSpec, isReviewed, isRunning }

/**
 * Calculate filter counts for sessions
 */
export function calculateFilterCounts(sessions: EnrichedSession[]) {
    return groupSessionsByVersion(sessions).reduce((counts, group) => {
        const aggregate = getSessionVersionGroupAggregate(group)

        if (aggregate.state === 'spec') {
            counts.specsCount += 1
        } else if (aggregate.state === 'running') {
            counts.runningCount += 1
        } else if (aggregate.state === 'reviewed') {
            counts.reviewedCount += 1
        }

        return counts
    }, {
        specsCount: 0,
        runningCount: 0,
        reviewedCount: 0,
    })
}

/**
 * Search sessions by session ID, display name, and spec content
 */
export function searchSessions(sessions: EnrichedSession[], searchQuery: string): EnrichedSession[] {
    if (!searchQuery.trim()) return sessions
    
    const query = searchQuery.toLowerCase().trim()
    return sessions.filter(session => {
        const sessionId = session.info.session_id.toLowerCase()
        const displayName = getSessionDisplayName(session.info).toLowerCase()
        const specContent = (session.info.spec_content || '').toLowerCase()
        
        // Search in combined content
        const allContent = `${sessionId} ${displayName} ${specContent}`.toLowerCase()
        
        return allContent.includes(query)
    })
}
