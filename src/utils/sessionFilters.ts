import { EnrichedSession } from '../types/session'
import { isSpec } from './sessionState'
import { getSessionDisplayName } from './sessionDisplayName'
import { calculateLogicalSessionCounts } from './sessionVersions'

export { isSpec }

/**
 * Calculate filter counts for sessions
 */
export function calculateFilterCounts(sessions: EnrichedSession[]) {
    const { specsCount, runningCount, idleCount } = calculateLogicalSessionCounts(sessions)
    return { specsCount, runningCount: runningCount + idleCount }
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
