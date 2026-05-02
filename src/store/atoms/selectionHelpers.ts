// Phase 7 Wave B.4: kind-narrowing helpers for the selection
// discriminated union.
//
// `selection.ts` keeps the canonical `Selection` shape and the action
// atoms; this module is the consumer-side surface. Hooks and components
// that need to "extract a sessionId from a selection" or "branch by
// kind" call into here so the kind-match logic lives in one place.
//
// Why a sibling file rather than living inside selection.ts: that file
// is 1262 lines and growing it further violates the same component
// size discipline arch_component_size enforces on .tsx files. The
// helpers here are pure and small; tests can hit them without standing
// up the giant atom graph.

import type { Selection } from './selection'

export type SelectionKind = Selection['kind']

/**
 * Resolve the session id a selection points to, or `null`.
 *
 * - `orchestrator`: no session bound — orchestrator runs in the main
 *   worktree.
 * - `session`: returns `selection.payload` (the canonical home of the
 *   session id for this kind today).
 * - `task`: a task header without a slot binding has no session.
 * - `task-run`: a run is a *set* of sessions; "the" session id is
 *   undefined unless the user has drilled into a specific slot.
 * - `task-slot`: returns `selection.payload` (slot sessions store their
 *   session id in payload, same shape as the legacy 'session' kind so
 *   callers can reuse session-shaped helpers without branching).
 */
export function selectionToSessionId(selection: Selection): string | null {
  switch (selection.kind) {
    case 'session':
    case 'task-slot':
      return selection.payload ?? null
    case 'orchestrator':
    case 'task':
    case 'task-run':
      return null
    default:
      return assertNeverKind(selection)
  }
}

/**
 * Return the task id this selection is bound to, or `null` for
 * non-task-shaped selections.
 */
export function selectionToTaskId(selection: Selection): string | null {
  switch (selection.kind) {
    case 'task':
    case 'task-run':
    case 'task-slot':
      return selection.taskId ?? null
    case 'orchestrator':
    case 'session':
      return null
    default:
      return assertNeverKind(selection)
  }
}

/**
 * Return the run id for selections that point at a specific run.
 * Only `task-run` and `task-slot` have one; everything else returns
 * `null`.
 */
export function selectionToRunId(selection: Selection): string | null {
  switch (selection.kind) {
    case 'task-run':
    case 'task-slot':
      return selection.runId ?? null
    case 'orchestrator':
    case 'session':
    case 'task':
      return null
    default:
      return assertNeverKind(selection)
  }
}

/**
 * Predicate: is this selection task-shaped (i.e., one of `task`,
 * `task-run`, `task-slot`)? Used by the right-pane dispatch in D.3 to
 * branch between task-bound bindings and session-bound bindings.
 */
export function isTaskKind(kind: SelectionKind): boolean {
  return kind === 'task' || kind === 'task-run' || kind === 'task-slot'
}

/**
 * Exhaustive matcher over the five `SelectionKind` variants. Each
 * branch receives the full Selection (already narrowed at the call
 * site by the dispatch). A future addition to the union without an
 * update to a `matchSelection` caller fails to compile.
 */
export interface SelectionMatchers<R> {
  orchestrator: (selection: Selection) => R
  session: (selection: Selection) => R
  task: (selection: Selection) => R
  'task-run': (selection: Selection) => R
  'task-slot': (selection: Selection) => R
}

export function matchSelection<R>(
  selection: Selection,
  matchers: SelectionMatchers<R>,
): R {
  switch (selection.kind) {
    case 'orchestrator':
      return matchers.orchestrator(selection)
    case 'session':
      return matchers.session(selection)
    case 'task':
      return matchers.task(selection)
    case 'task-run':
      return matchers['task-run'](selection)
    case 'task-slot':
      return matchers['task-slot'](selection)
    default:
      return assertNeverKind(selection)
  }
}

/**
 * Compile-time exhaustiveness check. Throws at runtime if reached
 * (which means the union grew without a matcher update).
 */
function assertNeverKind(selection: Selection): never {
  const _exhaustive: never = selection.kind as never
  throw new Error(
    `selectionHelpers: unhandled SelectionKind '${String(_exhaustive)}'. \
This is a Phase 7 invariant violation; add the new variant to every \
matcher in selectionHelpers.ts.`,
  )
}
