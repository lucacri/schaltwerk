// Phase 7 Wave A.3: typed wrappers over the v2 task aggregate Tauri
// commands. Each function corresponds 1:1 to a `lucode_task_*` command
// registered in `src-tauri/src/commands/tasks.rs`. Argument shapes match
// the Rust `#[tauri::command]` parameter declarations (camelCase here,
// Tauri's standard mapping from `snake_case` parameter names).
//
// **Why a service module rather than direct `invoke` from hooks:** so
// the type signatures live in one place and a future Rust-side argument
// rename surfaces here as a single edit, not a grep across the
// component tree. Per CLAUDE.md "ALWAYS use the centralized enum",
// every call goes through `TauriCommands.*`.

import { invoke } from '@tauri-apps/api/core'

import { TauriCommands } from '../common/tauriCommands'
import type {
  ClarifyRunStarted,
  PresetShape,
  ProjectWorkflowDefault,
  ProvisionedRunSession,
  StageRunStarted,
  Task,
  TaskArtifactKind,
  TaskArtifactVersion,
  TaskRun,
  TaskStage,
  TaskStageConfig,
  TaskVariant,
  TaskWithBodies,
} from '../types/task'

// ─── Reads ──────────────────────────────────────────────────────────

export function listTasks(projectPath?: string | null): Promise<Task[]> {
  return invoke<Task[]>(TauriCommands.LucodeTaskList, {
    projectPath: projectPath ?? null,
  })
}

export function getTask(
  id: string,
  projectPath?: string | null,
): Promise<TaskWithBodies> {
  return invoke<TaskWithBodies>(TauriCommands.LucodeTaskGet, {
    id,
    projectPath: projectPath ?? null,
  })
}

export function listTaskRuns(
  taskId: string,
  projectPath?: string | null,
): Promise<TaskRun[]> {
  return invoke<TaskRun[]>(TauriCommands.LucodeTaskRunList, {
    taskId,
    projectPath: projectPath ?? null,
  })
}

export function getTaskRun(
  runId: string,
  projectPath?: string | null,
): Promise<TaskRun> {
  return invoke<TaskRun>(TauriCommands.LucodeTaskRunGet, {
    runId,
    projectPath: projectPath ?? null,
  })
}

export function getTaskArtifactHistory(
  taskId: string,
  artifactKind: TaskArtifactKind,
  projectPath?: string | null,
): Promise<TaskArtifactVersion[]> {
  return invoke<TaskArtifactVersion[]>(TauriCommands.LucodeTaskArtifactHistory, {
    taskId,
    artifactKind,
    projectPath: projectPath ?? null,
  })
}

export function listTaskStageConfigs(
  taskId: string,
  projectPath?: string | null,
): Promise<TaskStageConfig[]> {
  return invoke<TaskStageConfig[]>(TauriCommands.LucodeTaskListStageConfigs, {
    taskId,
    projectPath: projectPath ?? null,
  })
}

export function getProjectWorkflowDefaults(
  repositoryPath: string,
  projectPath?: string | null,
): Promise<ProjectWorkflowDefault[]> {
  return invoke<ProjectWorkflowDefault[]>(
    TauriCommands.LucodeProjectWorkflowDefaultsGet,
    { repositoryPath, projectPath: projectPath ?? null },
  )
}

// ─── Lifecycle writes ───────────────────────────────────────────────

export interface CreateTaskInput {
  name: string
  displayName?: string | null
  requestBody: string
  variant?: TaskVariant
  epicId?: string | null
  baseBranch?: string | null
  sourceKind?: string | null
  sourceUrl?: string | null
  issueNumber?: number | null
  issueUrl?: string | null
  prNumber?: number | null
  prUrl?: string | null
}

export function createTask(
  input: CreateTaskInput,
  projectPath?: string | null,
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskCreate, {
    name: input.name,
    displayName: input.displayName ?? null,
    requestBody: input.requestBody,
    variant: input.variant ?? null,
    epicId: input.epicId ?? null,
    baseBranch: input.baseBranch ?? null,
    sourceKind: input.sourceKind ?? null,
    sourceUrl: input.sourceUrl ?? null,
    issueNumber: input.issueNumber ?? null,
    issueUrl: input.issueUrl ?? null,
    prNumber: input.prNumber ?? null,
    prUrl: input.prUrl ?? null,
    projectPath: projectPath ?? null,
  })
}

export function updateTaskContent(
  taskId: string,
  artifactKind: TaskArtifactKind,
  content: string,
  options: {
    producedBySessionId?: string | null
    producedByRunId?: string | null
    projectPath?: string | null
  } = {},
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskUpdateContent, {
    id: taskId,
    artifactKind,
    content,
    producedBySessionId: options.producedBySessionId ?? null,
    producedByRunId: options.producedByRunId ?? null,
    projectPath: options.projectPath ?? null,
  })
}

export function advanceTaskStage(
  taskId: string,
  stage: TaskStage,
  projectPath?: string | null,
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskAdvanceStage, {
    id: taskId,
    stage,
    projectPath: projectPath ?? null,
  })
}

export function attachTaskIssue(
  taskId: string,
  options: {
    issueNumber?: number | null
    issueUrl?: string | null
    projectPath?: string | null
  } = {},
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskAttachIssue, {
    id: taskId,
    issueNumber: options.issueNumber ?? null,
    issueUrl: options.issueUrl ?? null,
    projectPath: options.projectPath ?? null,
  })
}

export function attachTaskPr(
  taskId: string,
  options: {
    prNumber?: number | null
    prUrl?: string | null
    prState?: string | null
    projectPath?: string | null
  } = {},
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskAttachPr, {
    id: taskId,
    prNumber: options.prNumber ?? null,
    prUrl: options.prUrl ?? null,
    prState: options.prState ?? null,
    projectPath: options.projectPath ?? null,
  })
}

export function deleteTask(
  taskId: string,
  projectPath?: string | null,
): Promise<void> {
  return invoke<void>(TauriCommands.LucodeTaskDelete, {
    id: taskId,
    projectPath: projectPath ?? null,
  })
}

export function cancelTask(
  taskId: string,
  projectPath?: string | null,
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskCancel, {
    id: taskId,
    projectPath: projectPath ?? null,
  })
}

export function reopenTask(
  taskId: string,
  targetStage: TaskStage,
  projectPath?: string | null,
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskReopen, {
    taskId,
    targetStage,
    projectPath: projectPath ?? null,
  })
}

export function setTaskStageConfig(
  taskId: string,
  stage: TaskStage,
  options: {
    presetId?: string | null
    autoChain: boolean
    projectPath?: string | null
  },
): Promise<TaskStageConfig[]> {
  return invoke<TaskStageConfig[]>(TauriCommands.LucodeTaskSetStageConfig, {
    taskId,
    stage,
    presetId: options.presetId ?? null,
    autoChain: options.autoChain,
    projectPath: options.projectPath ?? null,
  })
}

// ─── Orchestration ──────────────────────────────────────────────────

export function promoteTaskToReady(
  taskId: string,
  projectPath?: string | null,
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskPromoteToReady, {
    id: taskId,
    projectPath: projectPath ?? null,
  })
}

export function startStageRun(
  taskId: string,
  stage: TaskStage,
  shape: PresetShape,
  options: {
    presetId?: string | null
    projectPath?: string | null
  } = {},
): Promise<StageRunStarted> {
  return invoke<StageRunStarted>(TauriCommands.LucodeTaskStartStageRun, {
    taskId,
    stage,
    presetId: options.presetId ?? null,
    shape,
    projectPath: options.projectPath ?? null,
  })
}

export function startClarifyRun(
  taskId: string,
  projectPath?: string | null,
): Promise<ClarifyRunStarted> {
  return invoke<ClarifyRunStarted>(TauriCommands.LucodeTaskStartClarifyRun, {
    taskId,
    projectPath: projectPath ?? null,
  })
}

export function cancelTaskRun(
  runId: string,
  projectPath?: string | null,
): Promise<TaskRun> {
  return invoke<TaskRun>(TauriCommands.LucodeTaskRunCancel, {
    runId,
    projectPath: projectPath ?? null,
  })
}

export function confirmStage(
  runId: string,
  winningSessionId: string,
  winningBranch: string,
  options: {
    selectionMode?: string | null
    projectPath?: string | null
  } = {},
): Promise<Task> {
  return invoke<Task>(TauriCommands.LucodeTaskConfirmStage, {
    runId,
    winningSessionId,
    winningBranch,
    selectionMode: options.selectionMode ?? null,
    projectPath: options.projectPath ?? null,
  })
}

export interface TaskRunDoneInput {
  runId: string
  slotSessionId: string
  status: 'ok' | 'failed'
  artifactId?: string | null
  error?: string | null
}

export function reportTaskRunDone(
  input: TaskRunDoneInput,
  projectPath?: string | null,
): Promise<TaskRun> {
  return invoke<TaskRun>(TauriCommands.LucodeTaskRunDone, {
    payload: {
      run_id: input.runId,
      slot_session_id: input.slotSessionId,
      status: input.status,
      artifact_id: input.artifactId ?? null,
      error: input.error ?? null,
    },
    projectPath: projectPath ?? null,
  })
}

// ─── Project workflow defaults ──────────────────────────────────────

export function setProjectWorkflowDefault(
  repositoryPath: string,
  stage: TaskStage,
  options: {
    presetId?: string | null
    autoChain: boolean
    projectPath?: string | null
  },
): Promise<ProjectWorkflowDefault[]> {
  return invoke<ProjectWorkflowDefault[]>(
    TauriCommands.LucodeProjectWorkflowDefaultsSet,
    {
      repositoryPath,
      stage,
      presetId: options.presetId ?? null,
      autoChain: options.autoChain,
      projectPath: options.projectPath ?? null,
    },
  )
}

export function deleteProjectWorkflowDefault(
  repositoryPath: string,
  stage: TaskStage,
  projectPath?: string | null,
): Promise<ProjectWorkflowDefault[]> {
  return invoke<ProjectWorkflowDefault[]>(
    TauriCommands.LucodeProjectWorkflowDefaultsDelete,
    {
      repositoryPath,
      stage,
      projectPath: projectPath ?? null,
    },
  )
}

// Re-export common types so call sites can import the service surface
// from one module.
export type {
  ClarifyRunStarted,
  PresetShape,
  ProjectWorkflowDefault,
  ProvisionedRunSession,
  StageRunStarted,
  Task,
  TaskArtifactKind,
  TaskArtifactVersion,
  TaskRun,
  TaskStage,
  TaskStageConfig,
  TaskVariant,
  TaskWithBodies,
}
