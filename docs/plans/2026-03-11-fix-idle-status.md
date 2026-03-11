# Fix Idle Status Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix inconsistent idle status detection where agents show as "running" when they are actually idle.

**Architecture:** Two fixes — (1) frontend: prevent `applySessionsSnapshot` from overwriting `attention_required` set by concurrent `TerminalAttention` events by using Jotai's atom updater function; (2) backend: remove `pending_bytes` double-feed from `IdleDetector` since the reader already feeds bytes to the shared `VisibleScreen`.

**Tech Stack:** TypeScript/Jotai (frontend), Rust (backend)

---

## Root Cause

### Primary: Frontend race condition (sessions.ts:672)

`applySessionsSnapshot` is async — it `await`s `releaseRemovedSessions` at line 670. Between building the `deduped` array and calling `set(allSessionsAtom, deduped)` at line 672, a `TerminalAttention` event can update `allSessionsAtom` with `attention_required = true`. Then `applySessionsSnapshot` overwrites the atom with the stale `deduped`, losing the idle state permanently (backend won't re-emit because `idle_reported = true` and `needs_tick() = false`).

### Secondary: Backend double-feed (idle_detection.rs:50-56)

`handle_reader_data` → `apply_segment` feeds bytes to `state.screen` AND stores them in `idle_detector.pending_bytes` via `observe_bytes`. Then `tick()` re-feeds those same pending bytes to the same screen. This corrupts the vt100 parser state and the hash baseline.

---

### Task 1: Backend — Remove double-feed from IdleDetector

**Files:**
- Modify: `src-tauri/src/domains/terminal/idle_detection.rs`

**Step 1: Write a failing test exposing the double-feed**

Add to the test module in `idle_detection.rs`:

```rust
#[test]
fn does_not_double_feed_bytes_to_screen() {
    let threshold = 5000u64;
    let mut detector = IdleDetector::new(threshold, "double-feed-test".to_string());
    let mut screen = VisibleScreen::new(5, 40, "double-feed-test".to_string());

    let baseline = Instant::now();

    // Simulate what handle_reader_data does: feed screen first, then observe
    screen.feed_bytes(b"Hello World\n");
    detector.observe_bytes(baseline, b"Hello World\n");

    // Tick should NOT re-feed bytes — screen already has them
    // Take snapshot before tick to capture correct state
    let pre_tick_hash = screen.compute_full_screen_hash();

    let t1 = baseline + Duration::from_millis(250);
    detector.tick(t1, &mut screen);

    let post_tick_hash = screen.compute_full_screen_hash();

    assert_eq!(
        pre_tick_hash, post_tick_hash,
        "tick() should not modify screen state — reader already fed the bytes"
    );
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo nextest run does_not_double_feed_bytes_to_screen`
Expected: FAIL — hashes differ because tick() re-feeds pending_bytes.

**Step 3: Remove `pending_bytes` from IdleDetector**

In `idle_detection.rs`, make these changes:

1. Remove the `pending_bytes` field from the struct:
```rust
pub struct IdleDetector {
    terminal_id: String,
    threshold_ms: u64,
    last_bytes_at: Option<Instant>,
    last_visible_change_at: Option<Instant>,
    last_snapshot: Option<ScreenSnapshot>,
    idle_reported: bool,
    dirty: bool,
}
```

2. Update `new()` — remove `pending_bytes` initialization:
```rust
pub fn new(threshold_ms: u64, terminal_id: String) -> Self {
    Self {
        terminal_id,
        threshold_ms,
        last_bytes_at: None,
        last_visible_change_at: None,
        last_snapshot: None,
        idle_reported: false,
        dirty: false,
    }
}
```

3. Simplify `observe_bytes()` — just track timestamp and dirty flag:
```rust
pub fn observe_bytes(&mut self, now: Instant, _bytes: &[u8]) {
    self.last_bytes_at = Some(now);
    self.dirty = true;
}
```

4. Update `tick()` — remove the feed, just mark dirty as processed:
```rust
pub fn tick(&mut self, now: Instant, screen: &mut VisibleScreen) -> Option<IdleTransition> {
    let had_pending = self.dirty;

    if self.dirty {
        self.dirty = false;
    }

    // ... rest of the method stays the same (snapshot comparison, elapsed checks)
```

**Step 4: Run all idle_detection tests**

Run: `cd src-tauri && cargo nextest run idle_detection`
Expected: ALL PASS

**Step 5: Run full Rust test suite**

Run: `cd src-tauri && cargo nextest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src-tauri/src/domains/terminal/idle_detection.rs
git commit -m "fix(idle): remove double-feed of bytes in IdleDetector

The reader already feeds bytes to the shared VisibleScreen via
apply_segment. Having tick() re-feed the same bytes from pending_bytes
corrupted the vt100 parser state and the screen hash baseline."
```

---

### Task 2: Frontend — Fix race condition in applySessionsSnapshot

**Files:**
- Modify: `src/store/atoms/sessions.ts:672`
- Test: `src/store/atoms/sessions.test.ts`

**Step 1: Write a failing test for the race condition**

Add to `sessions.test.ts` in the main describe block, near the existing `preserves attention state` test:

```typescript
it('preserves attention_required when TerminalAttention fires during applySessionsSnapshot', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    let refreshCount = 0
    vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
            refreshCount++
            return [createSession({ session_id: 'race-session', worktree_path: '/tmp/race' })]
        }
        if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
            return []
        }
        return undefined
    })

    await store.set(initializeSessionsEventsActionAtom)
    store.set(projectPathAtom, '/projects/alpha')
    await store.set(refreshSessionsActionAtom)

    // Simulate: TerminalAttention marks session idle
    listeners['schaltwerk:terminal-attention']?.({
        session_id: 'race-session',
        terminal_id: stableSessionTerminalId('race-session', 'top'),
        needs_attention: true,
    })

    let session = store.get(allSessionsAtom).find(s => s.info.session_id === 'race-session')
    expect(session?.info.attention_required).toBe(true)

    // Simulate: SessionsRefreshed fires (backend doesn't include attention_required in info)
    // This calls applySessionsSnapshot which must NOT overwrite the attention state
    listeners['schaltwerk:sessions-refreshed']?.({
        projectPath: '/projects/alpha',
        sessions: [createSession({ session_id: 'race-session', worktree_path: '/tmp/race' })],
    })

    // Allow the async handler to settle
    await vi.waitFor(() => {
        session = store.get(allSessionsAtom).find(s => s.info.session_id === 'race-session')
        expect(session?.info.attention_required).toBe(true)
    })
})
```

**Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/store/atoms/sessions.test.ts -t "preserves attention_required when TerminalAttention fires"`
Expected: FAIL — attention_required is overwritten to undefined.

**Step 3: Fix `applySessionsSnapshot` to use atom updater**

In `src/store/atoms/sessions.ts`, replace line 672:

```typescript
// BEFORE (line 672):
set(allSessionsAtom, deduped)

// AFTER:
set(allSessionsAtom, (current) => {
    const liveAttention = new Map<string, boolean>()
    for (const s of current) {
        if (s.info.attention_required != null) {
            liveAttention.set(s.info.session_id, s.info.attention_required)
        }
    }
    if (liveAttention.size === 0) {
        return deduped
    }
    return deduped.map(session => {
        const live = liveAttention.get(session.info.session_id)
        if (live != null && session.info.attention_required == null) {
            return {
                ...session,
                info: { ...session.info, attention_required: live },
            }
        }
        return session
    })
})
```

**Step 4: Run the new test to verify it passes**

Run: `bun run vitest run src/store/atoms/sessions.test.ts -t "preserves attention_required when TerminalAttention fires"`
Expected: PASS

**Step 5: Run all sessions tests**

Run: `bun run vitest run src/store/atoms/sessions.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/store/atoms/sessions.ts src/store/atoms/sessions.test.ts
git commit -m "fix(idle): prevent applySessionsSnapshot from overwriting attention state

applySessionsSnapshot is async and yields during releaseRemovedSessions.
A TerminalAttention event can update allSessionsAtom between building
deduped and calling set(). The stale deduped then overwrites the
attention_required value. Since the backend won't re-emit (idle_reported
is already true), the idle state is permanently lost.

Fix: use Jotai's updater function to merge live attention states from
the current atom value into the deduped array."
```

---

### Task 3: Full Validation

**Step 1: Run full test suite**

Run: `just test`
Expected: ALL PASS (TypeScript lint, Rust clippy, cargo shear, knip, vitest, cargo nextest, cargo build)

**Step 2: Final commit if any adjustments were needed**

Only if test failures required fixes.
