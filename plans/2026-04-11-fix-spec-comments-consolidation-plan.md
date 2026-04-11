# Fix Spec Comments Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate the best spec review comment selection fix from the parallel branches into one verified implementation.

**Architecture:** Use a ref-backed synchronous selection read path in `useSpecLineSelection`, then update `SpecEditor` to consume that path for mouse gesture handling. Keep the editor event bridge intact and add targeted regression coverage around both the hook and `SpecReviewEditor`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CodeMirror wrapper callbacks

---

### Task 1: Add failing selection regression coverage

**Files:**
- Modify: `src/hooks/useSpecLineSelection.test.ts`
- Modify: `src/components/specs/SpecEditor.test.tsx`
- Create: `src/components/specs/SpecReviewEditor.test.tsx`

**Step 1: Write the failing hook test**

Add coverage that `handleLineClick()` can be followed by an immediate `getSelection()` read inside the same `act()` block.

**Step 2: Write the failing editor gesture tests**

Extend the mocked `SpecReviewEditor` so it can simulate:
- single-gesture line select + mouseup,
- drag select + mouseup,
- dragging outward from an existing range.

Assert that review mode opens the comment form and preserves the selected line metadata.

**Step 3: Write the failing `SpecReviewEditor` callback-ref tests**

Add tests that verify selection highlight dispatch and that CodeMirror mouse handlers keep routing through the latest callback refs and `specId`.

**Step 4: Run targeted tests to confirm failure**

Run:

```bash
bun x vitest run src/hooks/useSpecLineSelection.test.ts src/components/specs/SpecEditor.test.tsx src/components/specs/SpecReviewEditor.test.tsx
```

Expected: selection gesture regressions fail on the current implementation.

### Task 2: Implement the reconciled hook and editor fix

**Files:**
- Modify: `src/hooks/useSpecLineSelection.ts`
- Modify: `src/components/specs/SpecEditor.tsx`

**Step 1: Add synchronous selection reads**

Mirror selection into a ref, add a shared setter that updates state and ref together, and expose `getSelection()` plus `setSelectionDirect()`.

**Step 2: Preserve gesture behavior**

Update `SpecEditor` to:
- read current selection through `getSelection()` on mouseup,
- keep drag state in refs,
- restore an existing range when a drag starts inside the selected lines,
- keep the submit/cancel/review flow unchanged.

**Step 3: Run targeted tests**

Run:

```bash
bun x vitest run src/hooks/useSpecLineSelection.test.ts src/components/specs/SpecEditor.test.tsx src/components/specs/SpecReviewEditor.test.tsx
```

Expected: targeted tests pass.

### Task 3: Verify, review, and finalize

**Files:**
- No additional functional files required

**Step 1: Run the full suite**

Run:

```bash
just test
```

Expected: full project validation passes.

**Step 2: Review the final diff**

Confirm the consolidation keeps `v2` as the conceptual base, adds `v3`’s useful editor tests, and excludes unrelated backend churn.

**Step 3: Create one squashed commit**

Commit the finished consolidation result as a single commit in this branch.
