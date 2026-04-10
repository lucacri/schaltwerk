import { describe, it, expect } from 'vitest'
import { 
    isSpec, 
    calculateFilterCounts, 
    searchSessions 
} from './sessionFilters'

// Mock session data for testing
const createMockSession = (overrides: Record<string, unknown> = {}) => {
    return {
        info: {
            session_id: 'test-session',
            display_name: 'Test Session',
            branch: 'test-branch',
            worktree_path: '/path/to/worktree',
            base_branch: 'main',
            status: 'active' as const,
            is_current: false,
            session_type: 'worktree' as const,
            session_state: 'running' as const,
            ready_to_merge: false,
            spec_content: 'Some spec content here',
            ...overrides
        },
        status: undefined,
        terminals: [`session-test-session-top`, `session-test-session-bottom`]
    }
}

describe('Session type checking functions', () => {
    it('isSpec should correctly identify spec sessions', () => {
        expect(isSpec(createMockSession({ session_state: 'spec' }).info)).toBe(true)
        expect(isSpec(createMockSession({ status: 'spec' }).info)).toBe(true)
        expect(isSpec(createMockSession({ session_state: 'running' }).info)).toBe(false)
    })
})

describe('calculateFilterCounts', () => {
    const specSession = createMockSession({ session_state: 'spec', session_id: 'spec-1' })
    const runningSession1 = createMockSession({ session_state: 'running', session_id: 'running-1' })
    const runningSession2 = createMockSession({ session_state: 'running', session_id: 'running-2' })
    const readySession = createMockSession({ ready_to_merge: true, session_id: 'ready-1' })
    
    const allSessions = [specSession, runningSession1, runningSession2, readySession]

    it('should correctly count all session types', () => {
        const counts = calculateFilterCounts(allSessions)

        expect(counts.specsCount).toBe(1)
        expect(counts.runningCount).toBe(3)
    })

    it('should return zero counts for empty array', () => {
        const counts = calculateFilterCounts([])

        expect(counts.specsCount).toBe(0)
        expect(counts.runningCount).toBe(0)
    })

    it('should handle sessions with only one type', () => {
        const onlyRunning = [runningSession1, runningSession2]
        const counts = calculateFilterCounts(onlyRunning)

        expect(counts.specsCount).toBe(0)
        expect(counts.runningCount).toBe(2)
    })

    it('counts ready sessions with the running bucket', () => {
        const edgeCaseSession = createMockSession({ 
            session_state: 'running', 
            ready_to_merge: true
        })
        const counts = calculateFilterCounts([edgeCaseSession])
        
        expect(counts.runningCount).toBe(1)
    })

    it('counts a version group once using its aggregate state', () => {
        const groupedRunning = createMockSession({
            session_id: 'feature',
            version_group_id: 'group-1',
            version_number: 1,
            session_state: 'running',
        })
        const groupedReviewed = createMockSession({
            session_id: 'feature_v2',
            version_group_id: 'group-1',
            version_number: 2,
            session_state: 'running',
            ready_to_merge: true,
        })

        const counts = calculateFilterCounts([groupedRunning, groupedReviewed])

        expect(counts.specsCount).toBe(0)
        expect(counts.runningCount).toBe(1)
    })

    it('counts a mixed ready/spec group as running', () => {
        const groupedReady = createMockSession({
            session_id: 'feature',
            version_group_id: 'group-1',
            version_number: 1,
            session_state: 'running',
            ready_to_merge: true,
        })
        const groupedSpec = createMockSession({
            session_id: 'feature_v2',
            version_group_id: 'group-1',
            version_number: 2,
            session_state: 'spec',
            status: 'spec',
        })

        const counts = calculateFilterCounts([groupedReady, groupedSpec])

        expect(counts.specsCount).toBe(0)
        expect(counts.runningCount).toBe(1)
    })
    it('counts idle group (all attention_required) as not running', () => {
        const sessions = [
            createMockSession({
                session_id: 'feature',
                version_group_id: 'g1',
                version_number: 1,
                session_state: 'running',
                attention_required: true,
            }),
            createMockSession({
                session_id: 'feature_v2',
                version_group_id: 'g1',
                version_number: 2,
                session_state: 'running',
                attention_required: true,
            }),
        ]
        const counts = calculateFilterCounts(sessions)
        expect(counts.runningCount).toBe(0)
    })

    it('counts group with idle consolidation as not running', () => {
        const sessions = [
            createMockSession({
                session_id: 'feature',
                version_group_id: 'g1',
                version_number: 1,
                session_state: 'running',
            }),
            createMockSession({
                session_id: 'feature_consol',
                version_group_id: 'g1',
                version_number: 2,
                session_state: 'running',
                is_consolidation: true,
                attention_required: true,
            }),
        ]
        const counts = calculateFilterCounts(sessions)
        expect(counts.runningCount).toBe(0)
    })

    it('counts group with active consolidation as running', () => {
        const sessions = [
            createMockSession({
                session_id: 'feature',
                version_group_id: 'g1',
                version_number: 1,
                session_state: 'running',
                attention_required: true,
            }),
            createMockSession({
                session_id: 'feature_consol',
                version_group_id: 'g1',
                version_number: 2,
                session_state: 'running',
                is_consolidation: true,
            }),
        ]
        const counts = calculateFilterCounts(sessions)
        expect(counts.runningCount).toBe(1)
    })

    it('standalone idle session not counted as running', () => {
        const sessions = [
            createMockSession({
                session_id: 'solo-idle',
                session_state: 'running',
                attention_required: true,
            }),
        ]
        const counts = calculateFilterCounts(sessions)
        expect(counts.runningCount).toBe(0)
    })
})

describe('searchSessions', () => {
    const session1 = createMockSession({ 
        session_id: 'frontend-fixes',
        display_name: 'Fix UI Bug',
        spec_content: 'Fix the button layout in the header component'
    })
    
    const session2 = createMockSession({ 
        session_id: 'backend-api',
        display_name: 'Add Authentication',
        spec_content: 'Implement JWT authentication for the REST API'
    })
    
    const session3 = createMockSession({ 
        session_id: 'database-migration',
        display_name: 'Update Schema',
        spec_content: 'Add new user preferences table and migrate existing data'
    })

    const allSessions = [session1, session2, session3]

    it('should return all sessions when search query is empty', () => {
        expect(searchSessions(allSessions, '')).toEqual(allSessions)
        expect(searchSessions(allSessions, '   ')).toEqual(allSessions)
    })

    it('should search by session ID', () => {
        const results = searchSessions(allSessions, 'frontend')
        expect(results).toHaveLength(1)
        expect(results[0].info.session_id).toBe('frontend-fixes')
    })

    it('should search by display name', () => {
        const results = searchSessions(allSessions, 'Authentication')
        expect(results).toHaveLength(1)
        expect(results[0].info.session_id).toBe('backend-api')
    })

    it('should search by spec content', () => {
        const results = searchSessions(allSessions, 'JWT')
        expect(results).toHaveLength(1)
        expect(results[0].info.session_id).toBe('backend-api')
    })

    it('should be case insensitive', () => {
        const results1 = searchSessions(allSessions, 'FRONTEND')
        const results2 = searchSessions(allSessions, 'frontend')
        expect(results1).toEqual(results2)
        expect(results1).toHaveLength(1)
    })

    it('should return multiple results when query matches multiple sessions', () => {
        const results = searchSessions(allSessions, 'API') // matches backend-api spec and might match others
        expect(results.length).toBeGreaterThanOrEqual(1)
        expect(results.some(s => s.info.session_id === 'backend-api')).toBe(true)
    })

    it('should handle partial matches', () => {
        const results = searchSessions(allSessions, 'Fix')
        expect(results).toHaveLength(1)
        expect(results[0].info.session_id).toBe('frontend-fixes')
    })

    it('should return empty array when no matches found', () => {
        const results = searchSessions(allSessions, 'nonexistent')
        expect(results).toHaveLength(0)
    })

    it('should handle sessions with missing optional fields', () => {
        const sessionWithMissingFields = createMockSession({ 
            session_id: 'minimal-session',
            display_name: undefined,
            spec_content: undefined
        })
        
        const sessions = [sessionWithMissingFields]
        const results = searchSessions(sessions, 'minimal')
        expect(results).toHaveLength(1)
    })

    it('should trim whitespace from search query', () => {
        const results = searchSessions(allSessions, '  frontend  ')
        expect(results).toHaveLength(1)
        expect(results[0].info.session_id).toBe('frontend-fixes')
    })

    it('should search across all content fields combined', () => {
        // Create a session where the search term spans multiple fields
        const complexSession = createMockSession({
            session_id: 'test',
            display_name: 'Complex',
            spec_content: 'Search functionality'
        })
        
        const sessions = [complexSession]
        
        // Should find it when searching for terms from different fields
        expect(searchSessions(sessions, 'Complex functionality')).toHaveLength(0) // exact phrase not found
        expect(searchSessions(sessions, 'Complex')).toHaveLength(1) // single term found
        expect(searchSessions(sessions, 'functionality')).toHaveLength(1) // single term found
    })
})
