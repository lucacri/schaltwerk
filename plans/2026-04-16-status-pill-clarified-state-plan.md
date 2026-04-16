# Status Pill Clarified State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make clarified specs render as a first-class green sidebar status while live terminal activity overrides stale cached attention labels.

**Architecture:** Centralize the behavior in `getSidebarSessionStatus` so `SessionCard`, `CompactVersionRow`, and `SessionVersionGroup` receive consistent primary status output. Rendering layers add only the missing `clarified` branch and remove the duplicate inline spec-stage badge from `SessionCard`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Jotai-backed render helpers.

---

### Task 1: Status Derivation Tests

**Files:**
- Create: `src/components/sidebar/sessionStatus.test.ts`
- Modify: none

**Step 1: Write failing tests**

Add focused tests for:
- `spec_stage: 'clarified'`, not running, no attention -> `primaryStatus === 'clarified'`
- clarified spec waiting for input, not running -> `primaryStatus === 'waiting'`
- clarified spec waiting for input, running -> `primaryStatus === 'running'`
- draft spec running -> `primaryStatus === 'running'`
- running session waiting for input, running -> `primaryStatus === 'running'`
- running session idle attention, running -> `primaryStatus === 'running'`

**Step 2: Run status tests to verify RED**

Run: `bunx vitest run src/components/sidebar/sessionStatus.test.ts`

Expected: FAIL because `clarified` is not in `SidebarPrimaryStatus`, `spec_stage` is not accepted by the source type, and live-running does not override cached attention.

### Task 2: SessionCard Rendering Tests

**Files:**
- Modify: `src/components/sidebar/SessionCard.test.tsx`

**Step 1: Write failing tests**

Update and add tests for:
- clarified spec renders the status pill text `Clarified`
- draft-stage active clarification still renders `Clarifying`
- clarified spec without attention and not running renders green `Clarified`
- clarified spec waiting and not running renders `Waiting for input`
- clarified spec with stale waiting attention and `isRunning` renders `Clarifying`
- no inline `Draft` or duplicate inline `Clarified` badge appears next to spec names

**Step 2: Run card tests to verify RED**

Run: `bunx vitest run src/components/sidebar/SessionCard.test.tsx`

Expected: FAIL because the clarified pill is not implemented and the inline stage badge still renders.

### Task 3: Compact Row Rendering Test

**Files:**
- Modify: `src/components/sidebar/CompactVersionRow.test.tsx`

**Step 1: Write failing test**

Add a test for a clarified spec row that expects `compact-row-status-clarified` and the translated `Clarified` label.

**Step 2: Run compact row tests to verify RED**

Run: `bunx vitest run src/components/sidebar/CompactVersionRow.test.tsx`

Expected: FAIL because `CompactVersionRow` does not handle the new primary status.

### Task 4: Implement Status Derivation

**Files:**
- Modify: `src/components/sidebar/sessionStatus.ts`

**Step 1: Update types**

Add `spec_stage` to `SidebarSessionStatusSource` and add `'clarified'` to `SidebarPrimaryStatus`.

**Step 2: Apply live-running override**

Calculate raw waiting and idle values first, then derive:

```ts
const isWaitingForInput = rawWaiting && !isRunning
const isIdle = rawIdle && !isRunning
```

**Step 3: Add clarified precedence**

Return `primaryStatus === 'clarified'` for clarified specs when not running, not waiting, and not blocked.

**Step 4: Run status tests**

Run: `bunx vitest run src/components/sidebar/sessionStatus.test.ts`

Expected: PASS.

### Task 5: Implement Rendering and i18n

**Files:**
- Modify: `src/components/sidebar/SessionCard.tsx`
- Modify: `src/components/sidebar/CompactVersionRow.tsx`
- Modify: `src/locales/en.json`
- Modify: `src/common/i18n/types.ts`

**Step 1: Remove inline spec stage badge**

Delete the `sessionState === "spec" && s.spec_stage` text badge beside the session name.

**Step 2: Add clarified pill branches**

Add green `clarified` branches in `SessionCard` and `CompactVersionRow`, using the same green token set as ready/promoted.

**Step 3: Add translation typing**

Add `t.session.clarified` to English locale and i18n types.

**Step 4: Run rendering tests**

Run:

```bash
bunx vitest run src/components/sidebar/SessionCard.test.tsx src/components/sidebar/CompactVersionRow.test.tsx
```

Expected: PASS.

### Task 6: Full Verification and Review

**Files:**
- All changed files

**Step 1: Run focused sidebar tests**

Run:

```bash
bunx vitest run src/components/sidebar/sessionStatus.test.ts src/components/sidebar/SessionCard.test.tsx src/components/sidebar/CompactVersionRow.test.tsx
```

Expected: PASS.

**Step 2: Run full validation**

Run: `just test`

Expected: PASS.

**Step 3: Request code review**

Use the requesting-code-review workflow against the diff from the pre-work base to HEAD.

**Step 4: Create squashed commit**

Stage the implementation, tests, and plan, then create one commit with message:

```bash
fix: make clarified spec status first-class
```
