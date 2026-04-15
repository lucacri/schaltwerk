# Consolidation Action Feedback — Implementation Plan

## Summary

Make every consolidation action in `SessionVersionGroup` show an in-flight visual
and block concurrent actions in the same group while one is running.

## Actions in Scope (all in `src/components/sidebar/SessionVersionGroup.tsx`)

1. Consolidate versions (`consolidate-versions-button`, amber git-merge)
2. Trigger / re-run consolidation judge (`trigger-consolidation-judge-button`, amber refresh)
3. Confirm consolidation winner — header checkmark (`confirm-consolidation-winner-button`)
4. Confirm consolidation winner — judge banner (`confirm-consolidation-winner-banner-button`)
5. Terminate all running sessions (`terminate-group-button`)

## Design

- Track a single in-flight action id per group via local `useState` inside `SessionVersionGroup`.
  - ID shape: `'consolidate' | 'trigger-judge' | 'confirm-winner-header' | 'confirm-winner-banner' | 'terminate-all'`.
- Each action callback becomes a `Promise<void>`-returning wrapper. The group
  awaits it, toggling busy state from click through resolution.
- The two "confirm winner" buttons disable together (same underlying mutation)
  but only the clicked one shows the spinner.
- While an action is busy, all five buttons disable; the busy one shows a
  spinner overlaying its icon using the same pattern used in `SessionCard` (`animate-spin`).
- Async errors thrown from callbacks do not crash the group — caught locally to
  clear busy state; the parent already handles user-facing toasts.
- Sidebar callers updated so their async handlers (`handleTriggerConsolidationJudge`,
  `handleConfirmConsolidationWinner`) resolve only after the backend response.
  The modal-opening wrappers (`onConsolidate`, `onTerminateAll`) resolve
  immediately because the subsequent UX lives in the modal.

## Tests (Vitest, TDD)

Add to `src/components/sidebar/SessionVersionGroup.status.test.tsx`:

- Clicking the trigger-judge button shows a spinner, disables it and the
  confirm-winner button until the promise resolves.
- Clicking the confirm-winner (header) button shows a spinner and disables the
  banner button and trigger-judge button too.
- Clicking the confirm-winner (banner) button shows a spinner on the banner
  version and disables the header checkmark.
- Clicking the consolidate button while another action is in flight is a no-op.
- Clicking the terminate-all button while another action is in flight is a no-op.
- Re-clicking the same busy button does not invoke the callback again.
- After the promise rejects, busy state clears so subsequent clicks succeed.

## Verification

Run `just test` (full suite) before declaring done.
