# Lazy Bottom Terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Defer backend PTY creation for regular session bottom terminals until the bottom pane is expanded, while leaving top terminals and orchestrator bottom terminals unchanged.

**Architecture:** Stop session selection from eagerly ensuring `terminals.bottomBase` for non-spec running sessions. Add an explicit initial-creation gate to `useTerminalTabs`, then pass that gate from `TerminalGrid` based on orchestrator scope or expanded bottom-pane state. `TerminalTabs` still owns tab creation, so adding tabs after expansion uses the existing flow.

**Tech Stack:** React, Jotai atoms, Vitest, Testing Library, Tauri command wrappers.

---

### Task 1: Selection Creates Only Session Top Terminals

**Files:**
- Modify: `src/store/atoms/selection.test.ts`
- Modify: `src/store/atoms/selection.ts`

**Step 1: Write the failing test**

Update the running-session selection tests so a regular session selection expects one backend creation call for the top terminal only, while orchestrator selection still expects both top and bottom terminals.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/store/atoms/selection.test.ts -t "sets session selection|allocates terminals|orchestrator"`

Expected: FAIL because selection currently calls `createTerminalBackend` for the session bottom terminal.

**Step 3: Write minimal implementation**

In `setSelectionActionAtom`, include `terminals.bottomBase` in the eager `ensureTerminal` task only when the enriched selection is not a regular running session. Specs already have no `bottomBase`; orchestrator remains eager.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/store/atoms/selection.test.ts -t "sets session selection|allocates terminals|orchestrator"`

Expected: PASS.

### Task 2: Terminal Tabs Initial Creation Gate

**Files:**
- Modify: `src/hooks/useTerminalTabs.test.ts`
- Modify: `src/hooks/useTerminalTabs.ts`
- Modify: `src/components/terminal/TerminalTabs.tsx`

**Step 1: Write the failing test**

Add a hook test that renders `useTerminalTabs` with `initialTerminalEnabled: false` and verifies no create-terminal command is invoked, then rerenders with `initialTerminalEnabled: true` and verifies the first tab terminal is created.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/hooks/useTerminalTabs.test.ts -t "initialTerminalEnabled"`

Expected: FAIL because the hook currently creates the initial terminal on mount with no gate.

**Step 3: Write minimal implementation**

Add `initialTerminalEnabled?: boolean` to `useTerminalTabs` and `TerminalTabs`. Default to `true` to preserve existing direct hook/component behavior. Skip only the initial mount effect while disabled; keep `addTab` creation unchanged.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/hooks/useTerminalTabs.test.ts -t "initialTerminalEnabled"`

Expected: PASS.

### Task 3: Wire Expansion State Through Terminal Grid

**Files:**
- Modify: `src/components/terminal/TerminalGrid.test.tsx`
- Modify: `src/components/terminal/TerminalGrid.tsx`

**Step 1: Write the failing test**

Extend the `TerminalTabs` mock to capture `initialTerminalEnabled`. Add a test with `bottomTerminalCollapsed=true` that selects a regular session and expects `initialTerminalEnabled=false`, then clicks the existing expand button and expects the prop to become `true`. Add or adjust a companion assertion that orchestrator tabs stay enabled while collapsed.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/terminal/TerminalGrid.test.tsx -t "lazy bottom terminal"`

Expected: FAIL because `TerminalGrid` does not pass the gate.

**Step 3: Write minimal implementation**

Compute `shouldCreateInitialBottomTerminal = selection.kind === 'orchestrator' || !isBottomCollapsed` and pass it to `TerminalTabs` as `initialTerminalEnabled`.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/terminal/TerminalGrid.test.tsx -t "lazy bottom terminal"`

Expected: PASS.

### Task 4: Focused and Full Verification

**Files:**
- No production edits unless verification reveals a bug.

**Step 1: Run focused suites**

Run:
`bunx vitest run src/store/atoms/selection.test.ts src/hooks/useTerminalTabs.test.ts src/components/terminal/TerminalGrid.test.tsx`

Expected: PASS.

**Step 2: Run full suite**

Run: `just test`

Expected: PASS.

**Step 3: Commit**

Run:
`git add src/store/atoms/selection.ts src/store/atoms/selection.test.ts src/hooks/useTerminalTabs.ts src/hooks/useTerminalTabs.test.ts src/components/terminal/TerminalTabs.tsx src/components/terminal/TerminalGrid.tsx src/components/terminal/TerminalGrid.test.tsx plans/2026-04-16-lazy-bottom-terminal-plan.md`
`git commit -m "feat: lazy load session bottom terminals"`
