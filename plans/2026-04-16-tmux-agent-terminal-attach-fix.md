# Tmux Agent Terminal Attach Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make session selection behave like re-attaching a live tmux client: current viewport redraw only, no hidden-output replay, and no manual resize needed.

**Architecture:** Keep tmux as the persistence and redraw source. On the frontend, session top terminals should not accumulate stream chunks while detached because those chunks represent hidden live output that tmux will redraw on the next visible attach. On the backend, same-size resize requests must still reach the attached tmux PTY so the existing mount-time forced fit can trigger SIGWINCH/redraw.

**Tech Stack:** React, xterm.js registry, Tauri commands, Rust `TmuxAdapter`, Vitest, Cargo nextest.

---

## Design Notes

### Approaches Considered

1. **Recommended: drop detached top-terminal backlog and stop suppressing same-size tmux PTY resizes.** This matches the shipped design: Lucode does not bridge tmux history into xterm; tmux provides the current viewport on attach/redraw. It is small and scoped to the attach path.
2. **Use `tmux capture-pane` to hydrate xterm.** This would provide explicit viewport control but is out of scope and contradicts the current decision not to bridge tmux history into xterm.
3. **Recreate backend terminals on every selection.** This would force a new tmux attach but risks killing persistent tmux sessions through the current close path and expands lifecycle behavior unnecessarily.

### Root Cause

- `src/terminal/registry/terminalRegistry.ts` keeps stream listeners active while terminals are detached and buffers TUI chunks until `attach()`, which causes the observed older-output burst.
- `src-tauri/src/domains/terminal/tmux.rs` returns early when `resize()` receives the same size as the last recorded attach size. The frontend already sends forced fit/resize requests during mount, but tmux never sees SIGWINCH for unchanged dimensions, leaving panes blank until a manual resize changes size.

## Task 1: Frontend Detached Top-Terminal Backlog

**Files:**
- Modify: `src/terminal/registry/terminalRegistry.ts`
- Test: `src/terminal/registry/terminalRegistry.test.ts`

**Step 1: Write the failing test**

Change the existing detached TUI buffering test so a detached session top terminal drops hidden output instead of flushing it on reattach.

Expected test behavior:
- attach `session-detach-buffer-top`
- emit `a`, flush, and confirm it writes
- detach
- emit `b`, run timers, and confirm no write
- attach again, run timers, and confirm `b` still was not written

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run src/terminal/registry/terminalRegistry.test.ts -t "drops detached top-terminal output"
```

Expected: FAIL because the current registry flushes `b` on reattach.

**Step 3: Implement minimal frontend fix**

- Import `isTopTerminalId` from `src/common/terminalIdentity`.
- Add a small helper or inline condition for `isTopTerminalId(record.id)`.
- In `detach()`, clear pending chunks and redraw hold flags for top terminals.
- In the stream listener, after control-sequence bookkeeping but before appending to `pendingChunks`, return early for detached top terminals.
- Preserve existing detached buffering for non-top terminals.

**Step 4: Run test to verify it passes**

Run the same focused Vitest command. Expected: PASS.

## Task 2: Backend Same-Size Resize Redraw

**Files:**
- Modify: `src-tauri/src/domains/terminal/tmux.rs`
- Test: `src-tauri/src/domains/terminal/tmux.rs`

**Step 1: Write the failing test**

Add a `TmuxAdapter` unit test documenting that same-size resize requests must not be treated as no-ops. Because the inner PTY is intentionally encapsulated, expose only test-only state if needed to prove the adapter records the requested size after each call.

Expected behavior:
- size tracking records the latest resize dimensions
- the implementation no longer has a same-size early return before delegating to the inner adapter

**Step 2: Run test to verify it fails**

Run:

```bash
cd src-tauri && cargo test domains::terminal::tmux::tests::same_size_resize_is_not_suppressed --quiet
```

Expected: FAIL until the early return is removed or the test-only observation point exists.

**Step 3: Implement minimal backend fix**

- Remove the `last_sizes` equality early return from `TmuxAdapter::resize`.
- Always delegate to `self.inner.resize(id, cols, rows).await?`.
- Keep recording the latest size after delegation.

**Step 4: Run test to verify it passes**

Run the same focused Cargo command. Expected: PASS.

## Task 3: Verification And Review

**Files:**
- `CHANGES.md`
- all modified source/test files

**Step 1: Update changelog**

Add one concise bug-fix entry for tmux agent terminal switching.

**Step 2: Run targeted tests**

Run:

```bash
bunx vitest run src/terminal/registry/terminalRegistry.test.ts
cd src-tauri && cargo test domains::terminal::tmux::tests --quiet
```

Expected: PASS.

**Step 3: Run full validation**

Run:

```bash
just test
```

Expected: PASS.

**Step 4: Request review**

Review the diff against the implementation plan, focusing on attach semantics, hidden backlog handling, and resize behavior.

**Step 5: Squash commit**

Create a single commit:

```bash
git add plans/2026-04-16-tmux-agent-terminal-attach-fix.md CHANGES.md src/terminal/registry/terminalRegistry.ts src/terminal/registry/terminalRegistry.test.ts src-tauri/src/domains/terminal/tmux.rs
git commit -m "fix: stabilize tmux agent terminal reattach"
```
