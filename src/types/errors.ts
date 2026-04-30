import type { CancelBlocker } from '../common/events'

export type SchaltError =
  | { type: 'SessionNotFound'; data: { session_id: string } }
  | { type: 'SessionAlreadyExists'; data: { session_id: string } }
  | { type: 'WorktreeNotFound'; data: { path: string } }
  | { type: 'WorktreeAlreadyExists'; data: { path: string } }
  | { type: 'GitOperationFailed'; data: { operation: string; message: string } }
  | { type: 'DatabaseError'; data: { message: string } }
  | { type: 'InvalidInput'; data: { field: string; message: string } }
  | { type: 'TerminalNotFound'; data: { terminal_id: string } }
  | {
      type: 'TerminalOperationFailed'
      data: { terminal_id: string; operation: string; message: string }
    }
  | { type: 'ProjectNotFound'; data: { project_path: string } }
  | { type: 'IoError'; data: { operation: string; path: string; message: string } }
  | { type: 'MergeConflict'; data: { files: string[]; message: string } }
  | {
      type: 'InvalidSessionState'
      data: { session_id: string; current_state: string; expected_state: string }
    }
  | { type: 'CancelBlocked'; data: { blocker: CancelBlocker } }
  | { type: 'AgentNotFound'; data: { agent_name: string } }
  | { type: 'ConfigError'; data: { key: string; message: string } }
  | { type: 'TaskNotFound'; data: { task_id: string } }
  | { type: 'TaskCancelFailed'; data: { task_id: string; failures: string[] } }
  | { type: 'StageAdvanceFailedAfterMerge'; data: { task_id: string; message: string } }

// Phase 4 Wave E.3: TaskFlowError is the canonical error type for the
// task command surface. Tagged-enum shape `{type, data}` matches
// SchaltError so the discriminator pattern is identical.
export type TaskFlowError =
  | { type: 'TaskNotFound'; data: { task_id: string } }
  | { type: 'TaskCancelFailed'; data: { task_id: string; failures: string[] } }
  | { type: 'StageAdvanceFailedAfterMerge'; data: { task_id: string; message: string } }
  | {
      type: 'InvalidStageTransition'
      data: { task_id: string; from_stage: string; to_stage: string }
    }
  | { type: 'TaskCancelled'; data: { task_id: string; cancelled_at: string } }
  | {
      type: 'OrchestrationSetupFailed'
      data: { task_id: string; operation: string; message: string }
    }
  | { type: 'MissingArtifact'; data: { task_id: string; kind: string } }
  | { type: 'InvalidInput'; data: { field: string; message: string } }
  | { type: 'Schalt'; data: SchaltError }
  | { type: 'DatabaseError'; data: { message: string } }

const TASK_FLOW_ERROR_TYPES = new Set([
  'TaskNotFound',
  'TaskCancelFailed',
  'StageAdvanceFailedAfterMerge',
  'InvalidStageTransition',
  'TaskCancelled',
  'OrchestrationSetupFailed',
  'MissingArtifact',
  'InvalidInput',
  'Schalt',
  'DatabaseError',
])

export function isTaskFlowError(error: unknown): error is TaskFlowError {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as Record<string, unknown>
  return (
    typeof candidate.type === 'string' &&
    TASK_FLOW_ERROR_TYPES.has(candidate.type) &&
    'data' in candidate
  )
}

export function isSchaltError(error: unknown): error is SchaltError {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as Record<string, unknown>
  return typeof candidate.type === 'string' && 'data' in candidate
}

export function formatTaskFlowError(error: TaskFlowError): string {
  switch (error.type) {
    case 'TaskNotFound':
      return `Task '${error.data.task_id}' not found`
    case 'TaskCancelFailed':
      return `Failed to cancel task '${error.data.task_id}': ${error.data.failures.length} session error(s): ${error.data.failures.join('; ')}`
    case 'StageAdvanceFailedAfterMerge':
      return `Task '${error.data.task_id}' merged but failed to advance stage: ${error.data.message}`
    case 'InvalidStageTransition':
      return `Task '${error.data.task_id}' cannot advance from ${error.data.from_stage} to ${error.data.to_stage}`
    case 'TaskCancelled':
      return `Task '${error.data.task_id}' was cancelled at ${error.data.cancelled_at} and cannot be modified`
    case 'OrchestrationSetupFailed':
      return `Orchestration setup '${error.data.operation}' failed for task '${error.data.task_id}': ${error.data.message}`
    case 'MissingArtifact':
      return `Task '${error.data.task_id}' has no current artifact of kind ${error.data.kind}`
    case 'InvalidInput':
      return `Invalid input for field '${error.data.field}': ${error.data.message}`
    case 'Schalt':
      return formatSchaltError(error.data)
    case 'DatabaseError':
      return `Database error: ${error.data.message}`
    default: {
      const _exhaustive: never = error
      return `Unknown task error: ${_exhaustive}`
    }
  }
}

export function formatSchaltError(error: SchaltError): string {
  switch (error.type) {
    case 'SessionNotFound':
      return `Session '${error.data.session_id}' not found`
    case 'SessionAlreadyExists':
      return `Session '${error.data.session_id}' already exists`
    case 'WorktreeNotFound':
      return `Worktree not found at path: ${error.data.path}`
    case 'WorktreeAlreadyExists':
      return `Worktree already exists at path: ${error.data.path}`
    case 'GitOperationFailed':
      return `Git operation '${error.data.operation}' failed: ${error.data.message}`
    case 'DatabaseError':
      return `Database error: ${error.data.message}`
    case 'InvalidInput':
      return `Invalid input for field '${error.data.field}': ${error.data.message}`
    case 'TerminalNotFound':
      return `Terminal '${error.data.terminal_id}' not found`
    case 'TerminalOperationFailed':
      return `Terminal operation '${error.data.operation}' failed for terminal '${error.data.terminal_id}': ${error.data.message}`
    case 'ProjectNotFound':
      return `Project not found at path: ${error.data.project_path}`
    case 'IoError':
      return `I/O error during '${error.data.operation}' on '${error.data.path}': ${error.data.message}`
    case 'MergeConflict':
      return `Merge conflict in ${error.data.files.length} file(s): ${error.data.message}`
    case 'InvalidSessionState':
      return `Session '${error.data.session_id}' is in state '${error.data.current_state}', expected '${error.data.expected_state}'`
    case 'CancelBlocked':
      return getCancelBlockerMessage(error.data.blocker)
    case 'AgentNotFound':
      return `Agent '${error.data.agent_name}' not found`
    case 'ConfigError':
      return `Configuration error for key '${error.data.key}': ${error.data.message}`
    case 'TaskNotFound':
      return `Task '${error.data.task_id}' not found`
    case 'TaskCancelFailed':
      return `Failed to cancel task '${error.data.task_id}': ${error.data.failures.length} session error(s): ${error.data.failures.join('; ')}`
    case 'StageAdvanceFailedAfterMerge':
      return `Task '${error.data.task_id}' merged but failed to advance stage: ${error.data.message}`
    default: {
      const _exhaustive: never = error
      return `Unknown error: ${_exhaustive}`
    }
  }
}

export function getErrorMessage(error: unknown): string {
  // Phase 4 Wave E.3: check TaskFlowError first because it can wrap a
  // SchaltError (the Schalt(...) variant). Both share the same
  // {type, data} discriminator shape; isTaskFlowError narrows by the
  // known TaskFlowError variant set.
  if (isTaskFlowError(error)) {
    return formatTaskFlowError(error)
  }

  if (isSchaltError(error)) {
    return formatSchaltError(error)
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'An unknown error occurred'
}

function getCancelBlockerMessage(blocker: CancelBlocker): string {
  switch (blocker.type) {
    case 'UncommittedChanges':
      return `Session cancel blocked by uncommitted changes in ${blocker.data.files.length} file(s)`
    case 'OrphanedWorktree':
      return `Session cancel blocked because the worktree is missing: ${blocker.data.expected_path}`
    case 'WorktreeLocked':
      return `Session cancel blocked because the worktree is locked: ${blocker.data.reason}`
    case 'GitError':
      return `Session cancel blocked by git error during ${blocker.data.operation}: ${blocker.data.message}`
  }
}

export function isSessionMissingError(error: unknown): boolean {
  return isSchaltError(error) && error.type === 'SessionNotFound'
}
