import { invoke as defaultInvoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import {
  UiEvent,
  emitUiEvent as defaultEmitUiEvent,
  type ContextualActionCreateSpecDetail,
} from '../common/uiEvents'
import { specOrchestratorTerminalId } from '../common/terminalIdentity'
import { startSpecOrchestratorTop as defaultStartSpecOrchestratorTop } from '../common/agentSpawn'
import { sanitizeName } from '../utils/sanitizeName'
import { logger } from '../utils/logger'

interface CreatedSpecResponse {
  id: string
  name: string
}

export interface ContextualSpecClarifyDeps {
  detail: ContextualActionCreateSpecDetail
  invoke?: typeof defaultInvoke
  emitUiEvent?: typeof defaultEmitUiEvent
  startSpecOrchestratorTop?: typeof defaultStartSpecOrchestratorTop
}

function deriveSpecName(detail: ContextualActionCreateSpecDetail): string {
  if (detail.contextType && detail.contextNumber) {
    const raw = detail.contextType === 'pr'
      ? `pr-${detail.contextNumber}-${detail.contextTitle ?? ''}`
      : `${detail.contextNumber}-${detail.contextTitle ?? ''}`
    const sanitized = sanitizeName(raw)
    if (sanitized) return sanitized
  }
  const fallback = sanitizeName(detail.name)
  return fallback || 'contextual-action'
}

export async function runContextualSpecClarify({
  detail,
  invoke = defaultInvoke,
  emitUiEvent = defaultEmitUiEvent,
  startSpecOrchestratorTop = defaultStartSpecOrchestratorTop,
}: ContextualSpecClarifyDeps): Promise<void> {
  const requestedName = deriveSpecName(detail)

  const issueNumber = detail.contextType === 'issue' && detail.contextNumber
    ? Number(detail.contextNumber)
    : null
  const issueUrl = detail.contextType === 'issue' ? (detail.contextUrl ?? null) : null

  const created = await invoke<CreatedSpecResponse>(
    TauriCommands.SchaltwerkCoreCreateSpecSession,
    {
      name: requestedName,
      specContent: detail.prompt,
      agentType: null,
      epicId: null,
      issueNumber,
      issueUrl,
      prNumber: null,
      prUrl: null,
      userEditedName: false,
    },
  )

  const specName = created.name
  const terminalId = specOrchestratorTerminalId(created.id)

  emitUiEvent(UiEvent.SpecCreated, { name: specName })

  try {
    await startSpecOrchestratorTop({ terminalId, specName })
  } catch (err) {
    logger.error('[contextualSpecClarify] Failed to start spec orchestrator:', err)
    throw err
  }

  await invoke(TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt, {
    terminalId,
    specName,
  })
}
