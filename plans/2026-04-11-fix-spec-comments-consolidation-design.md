# Fix Spec Comments Consolidation Design

## Goal

Restore spec review comment selection so a click or drag gesture can open the comment form on the same interaction without losing the selected range.

## Context

`SpecReviewEditor` forwards CodeMirror mouse gestures through callback refs. `SpecEditor` starts selection on `mousedown` and decides whether to open the comment form on `mouseup`. Today that `mouseup` handler reads React state from the previous render, so a same-tick click or drag can still see `null` selection even though the line selection hook already updated.

## Approaches Considered

### 1. Force React to flush before `mouseup`

- Pros: no hook API changes.
- Cons: depends on scheduling details and adds timing-sensitive logic around an input bug.

### 2. Move more gesture state into `SpecReviewEditor`

- Pros: keeps the event bridge close to CodeMirror.
- Cons: duplicates selection truth outside the hook and drifts from the existing diff-review pattern.

### 3. Make spec selection synchronously readable inside the hook

- Pros: deterministic, minimal, and closest to the existing diff-review selection model.
- Cons: adds a second access path that must stay aligned with React state.

## Chosen Design

Use approach 3.

`useSpecLineSelection` will mirror its React selection state into a ref, expose a stable `getSelection()` helper for same-interaction reads, and keep a `setSelectionDirect()` helper so `SpecEditor` can restore an existing range when a drag begins inside it. `SpecEditor` will switch its gesture handlers to the synchronous selection read path while leaving rendering driven by React state.

## Consolidation Notes

- **Base session:** `fix-spec-comments_v2`
- Keep from `v2`: the full gesture fix, including drag-start-inside-selection recovery and hook-level regression tests.
- Keep from `v3`: `SpecReviewEditor` regression coverage for callback-ref event routing and highlight dispatch.
- Leave out from `v3`: the unrelated `src-tauri/src/domains/sessions/activity.rs` cleanup.
