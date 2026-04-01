import type { EnrichedSession, SessionInfo, AgentType, Epic, DiffStats } from '../src/types/session'

let idCounter = 0
function nextId(): string {
  return `session-${++idCounter}`
}

function makeSessionInfo(overrides: Partial<SessionInfo> & { session_id: string }): SessionInfo {
  return {
    branch: `lucode/${overrides.session_id}`,
    worktree_path: `/mock/.lucode/worktrees/${overrides.session_id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: 'running',
    created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    last_modified: new Date().toISOString(),
    ...overrides,
  }
}

function makeSession(info: Partial<SessionInfo> & { session_id: string }): EnrichedSession {
  return {
    info: makeSessionInfo(info),
    terminals: [],
  }
}

// ── Epics ───────────────────────────────────────────────────────────────────

const epicAuth: Epic = { id: 'epic-auth', name: 'Authentication', color: '#3b82f6' }
const epicDashboard: Epic = { id: 'epic-dashboard', name: 'Dashboard Redesign', color: '#8b5cf6' }
const epicPerf: Epic = { id: 'epic-perf', name: 'Performance', color: '#f59e0b' }

// ── Diff stats presets ──────────────────────────────────────────────────────

const smallDiff: DiffStats = { files_changed: 3, additions: 45, deletions: 12, insertions: 45 }
const mediumDiff: DiffStats = { files_changed: 8, additions: 230, deletions: 87, insertions: 230 }
const largeDiff: DiffStats = { files_changed: 24, additions: 1200, deletions: 450, insertions: 1200 }

// ── Running sessions (various agents) ───────────────────────────────────────

const runningClaude = makeSession({
  session_id: 'implement-auth-flow',
  display_name: 'Implement OAuth2 flow',
  session_state: 'running',
  original_agent_type: 'claude' as AgentType,
  diff_stats: mediumDiff,
  has_uncommitted_changes: true,
  dirty_files_count: 4,
  commits_ahead_count: 3,
  current_task: 'Adding token refresh logic',
  todo_percentage: 65,
  epic: epicAuth,
})

const runningCodex = makeSession({
  session_id: 'fix-api-pagination',
  display_name: 'Fix API pagination bug',
  session_state: 'running',
  original_agent_type: 'codex' as AgentType,
  diff_stats: smallDiff,
  commits_ahead_count: 1,
  current_task: 'Writing tests for edge cases',
  todo_percentage: 40,
})

const runningGemini = makeSession({
  session_id: 'refactor-db-layer',
  display_name: 'Refactor database layer',
  session_state: 'running',
  original_agent_type: 'gemini' as AgentType,
  diff_stats: largeDiff,
  has_uncommitted_changes: true,
  dirty_files_count: 12,
  commits_ahead_count: 7,
  epic: epicPerf,
})

const runningCopilot = makeSession({
  session_id: 'add-search-component',
  display_name: 'Add search component',
  session_state: 'running',
  original_agent_type: 'copilot' as AgentType,
  diff_stats: smallDiff,
  commits_ahead_count: 2,
  epic: epicDashboard,
})

const runningDroid = makeSession({
  session_id: 'migrate-to-esm',
  display_name: 'Migrate to ESM',
  session_state: 'running',
  original_agent_type: 'droid' as AgentType,
  diff_stats: mediumDiff,
  commits_ahead_count: 5,
})

// ── Spec sessions ───────────────────────────────────────────────────────────

const specWithContent = makeSession({
  session_id: 'design-notification-system',
  display_name: 'Design notification system',
  session_state: 'spec',
  status: 'spec',
  spec_content: '# Notification System\n\nReal-time notifications via WebSocket with fallback to polling.\n\n## Requirements\n- Toast notifications for in-app\n- Push notifications for mobile\n- Email digest for offline users',
  epic: epicDashboard,
})

const specEmpty = makeSession({
  session_id: 'explore-caching-strategy',
  display_name: 'Explore caching strategy',
  session_state: 'spec',
  status: 'spec',
  epic: epicPerf,
})

// ── Reviewed sessions ───────────────────────────────────────────────────────

const reviewedWithPr = makeSession({
  session_id: 'add-dark-mode',
  display_name: 'Add dark mode toggle',
  session_state: 'reviewed',
  ready_to_merge: true,
  diff_stats: mediumDiff,
  commits_ahead_count: 4,
  pr_number: 142,
  pr_url: 'https://github.com/example/repo/pull/142',
  epic: epicDashboard,
})

const reviewedReady = makeSession({
  session_id: 'fix-memory-leak',
  display_name: 'Fix memory leak in event listeners',
  session_state: 'reviewed',
  ready_to_merge: true,
  diff_stats: smallDiff,
  commits_ahead_count: 2,
})

// ── Sessions with conflicts ─────────────────────────────────────────────────

const withConflicts = makeSession({
  session_id: 'update-deps',
  display_name: 'Update dependencies',
  session_state: 'running',
  original_agent_type: 'claude' as AgentType,
  has_conflicts: true,
  merge_has_conflicts: true,
  merge_conflicting_paths: ['package.json', 'bun.lockb'],
  diff_stats: smallDiff,
  attention_required: true,
})

// ── Sessions with issue links ───────────────────────────────────────────────

const withIssue = makeSession({
  session_id: 'fix-login-redirect',
  display_name: 'Fix login redirect loop',
  session_state: 'running',
  original_agent_type: 'claude' as AgentType,
  issue_number: 87,
  issue_url: 'https://github.com/example/repo/issues/87',
  diff_stats: smallDiff,
  commits_ahead_count: 1,
  epic: epicAuth,
})

// ── Version groups ──────────────────────────────────────────────────────────

const versionV1 = makeSession({
  session_id: 'sidebar-redesign_v1',
  display_name: 'Sidebar redesign',
  session_state: 'running',
  original_agent_type: 'gemini' as AgentType,
  version_group_id: 'sidebar-redesign',
  version_number: 1,
  diff_stats: mediumDiff,
  commits_ahead_count: 6,
  current_task: 'Completed initial layout',
  todo_percentage: 100,
  epic: epicDashboard,
})

const versionV2 = makeSession({
  session_id: 'sidebar-redesign_v2',
  display_name: 'Sidebar redesign',
  session_state: 'running',
  original_agent_type: 'claude' as AgentType,
  version_group_id: 'sidebar-redesign',
  version_number: 2,
  diff_stats: largeDiff,
  commits_ahead_count: 10,
  has_uncommitted_changes: true,
  dirty_files_count: 6,
  current_task: 'Refining collapsed rail mode',
  todo_percentage: 70,
  epic: epicDashboard,
})

const versionV3 = makeSession({
  session_id: 'sidebar-redesign_v3',
  display_name: 'Sidebar redesign',
  session_state: 'running',
  original_agent_type: 'codex' as AgentType,
  version_group_id: 'sidebar-redesign',
  version_number: 3,
  diff_stats: smallDiff,
  commits_ahead_count: 2,
  current_task: 'Alternative icon-only approach',
  todo_percentage: 30,
  epic: epicDashboard,
})

// ── Blocked session ─────────────────────────────────────────────────────────

const blockedSession = makeSession({
  session_id: 'blocked-on-api',
  display_name: 'Blocked on API changes',
  session_state: 'running',
  original_agent_type: 'amp' as AgentType,
  is_blocked: true,
  attention_required: true,
  current_task: 'Waiting for upstream API',
})

// ── Consolidation session ───────────────────────────────────────────────────

const consolidationSession = makeSession({
  session_id: 'consolidate-auth',
  display_name: 'Consolidate auth implementations',
  session_state: 'running',
  original_agent_type: 'claude' as AgentType,
  is_consolidation: true,
  consolidation_sources: ['auth-flow-v1', 'auth-flow-v2'],
  diff_stats: largeDiff,
  epic: epicAuth,
})

// ── Export ───────────────────────────────────────────────────────────────────

export const mockSessions: EnrichedSession[] = [
  runningClaude,
  runningCodex,
  runningGemini,
  runningCopilot,
  runningDroid,
  specWithContent,
  specEmpty,
  reviewedWithPr,
  reviewedReady,
  withConflicts,
  withIssue,
  versionV1,
  versionV2,
  versionV3,
  blockedSession,
  consolidationSession,
]

export const mockEpics: Epic[] = [epicAuth, epicDashboard, epicPerf]
