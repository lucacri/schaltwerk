import { stableSessionTerminalId } from '../common/terminalIdentity'
import { SessionState, type EnrichedSession } from '../types/session'

export const mockEnrichedSession = (
  name: string,
  status: 'active' | 'spec' | 'processing' | 'running' = 'active',
  readyToMerge: boolean = false,
): EnrichedSession => {
  const sessionState =
    status === 'spec'
      ? SessionState.Spec
      : status === 'processing'
        ? SessionState.Processing
        : SessionState.Running

  return {
    info: {
      session_id: name,
      stable_id: `${name}-stable-id`,
      display_name: name,
      branch: `branch-${name}`,
      worktree_path: `/path/to/${name}`,
      base_branch: 'main',
      status: sessionState === SessionState.Spec ? 'spec' : 'active',
      session_state: sessionState,
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
      has_uncommitted_changes: false,
      ready_to_merge: readyToMerge,
      diff_stats: undefined,
      is_current: false,
      session_type: 'worktree',
      spec_stage: sessionState === SessionState.Spec ? 'draft' : undefined,
    },
    terminals: [
      stableSessionTerminalId(name, 'top'),
      stableSessionTerminalId(name, 'bottom'),
    ],
  }
}
