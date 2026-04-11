# Waiting For Input Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a distinct `waiting_for_input` session state driven by documented agent mechanisms, with backend propagation and a distinct UI indicator.

**Architecture:** Extend the existing attention pipeline with an `attention_kind` discriminator, add thin per-agent terminal signal detectors, and keep `attention_required` as the aggregate boolean used by existing counts and notifications.

**Tech Stack:** Rust, Tauri events, Jotai, React, Vitest, Rust unit tests.

---

### Task 1: Define shared attention kinds

**Files:**
- Modify: `src-tauri/src/domains/attention/mod.rs`
- Modify: `src-tauri/src/infrastructure/attention_bridge.rs`
- Modify: `src-tauri/src/services/sessions.rs`
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src/common/events.ts`
- Modify: `src/types/session.ts`
- Test: `src-tauri/src/domains/attention/mod.rs`
- Test: `src-tauri/src/services/sessions.rs`

**Step 1: Write the failing Rust tests**

Add tests that expect the runtime attention registry to store both a boolean and a kind, and expect session hydration to expose `attention_kind`.

**Step 2: Run the Rust tests to verify they fail**

Run: `cargo test attention_kind --manifest-path src-tauri/Cargo.toml`

**Step 3: Implement the minimal shared model changes**

Add an attention-kind enum/serializable string and thread it through the runtime registry, bridge, hydrated session entity, and frontend event/session types.

**Step 4: Run the Rust tests to verify they pass**

Run: `cargo test attention_kind --manifest-path src-tauri/Cargo.toml`

### Task 2: Capture explicit terminal control-sequence signals

**Files:**
- Modify: `src-tauri/src/domains/terminal/control_sequences.rs`
- Test: `src-tauri/src/domains/terminal/control_sequences.rs`

**Step 1: Write the failing Rust tests**

Add tests covering extracted OSC 9 notification text and OSC 0/2 window-title text without breaking existing sanitization behavior.

**Step 2: Run the Rust tests to verify they fail**

Run: `cargo test control_sequences --manifest-path src-tauri/Cargo.toml`

**Step 3: Implement the minimal parser extension**

Extend `SanitizedOutput` to carry parsed notification/title observations while preserving the existing sanitized byte stream.

**Step 4: Run the Rust tests to verify they pass**

Run: `cargo test control_sequences --manifest-path src-tauri/Cargo.toml`

### Task 3: Add per-agent waiting detectors

**Files:**
- Modify: `src-tauri/src/domains/terminal/local.rs`
- Modify: `src-tauri/src/domains/terminal/manager.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Test: `src-tauri/src/domains/terminal/local.rs` or a new focused detector test module

**Step 1: Write the failing Rust tests**

Add tests proving:
- Gemini attention enters on explicit Gemini notification/title signals and clears on ready/working signals.
- Idle transitions do not overwrite active waiting-for-input state.

**Step 2: Run the Rust tests to verify they fail**

Run: `cargo test waiting_for_input --manifest-path src-tauri/Cargo.toml`

**Step 3: Implement the minimal detector plumbing**

Add per-terminal detector configuration by agent type, emit `TerminalAttention` with `attention_kind`, and guard idle detection from clobbering active waiting state.

**Step 4: Run the Rust tests to verify they pass**

Run: `cargo test waiting_for_input --manifest-path src-tauri/Cargo.toml`

### Task 4: Wire Claude hooks

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Add or modify any small backend helper module needed for generating Claude local settings
- Test: focused Rust tests for generated hook config if added

**Step 1: Write the failing Rust tests**

Add tests proving Lucode generates/merges the expected Claude local hook config and preserves unrelated existing settings.

**Step 2: Run the Rust tests to verify they fail**

Run: `cargo test claude_hook --manifest-path src-tauri/Cargo.toml`

**Step 3: Implement the minimal launch-time hook setup**

Generate or merge `.claude/settings.local.json`, ensure local git exclude ignores it, and configure deterministic OSC emissions for waiting/clear signals.

**Step 4: Run the Rust tests to verify they pass**

Run: `cargo test claude_hook --manifest-path src-tauri/Cargo.toml`

### Task 5: Update frontend state handling

**Files:**
- Modify: `src/store/atoms/sessions.ts`
- Test: `src/store/atoms/sessions.test.ts`

**Step 1: Write the failing Vitest tests**

Add tests covering `TerminalAttention` payloads with `attention_kind`, preserving the kind through refresh snapshots.

**Step 2: Run the tests to verify they fail**

Run: `bun vitest src/store/atoms/sessions.test.ts`

**Step 3: Implement the minimal atom changes**

Persist `attention_kind` beside `attention_required` and preserve live values during snapshot application.

**Step 4: Run the tests to verify they pass**

Run: `bun vitest src/store/atoms/sessions.test.ts`

### Task 6: Render a distinct waiting-for-input indicator

**Files:**
- Modify: `src/components/sidebar/SessionCard.tsx`
- Modify: `src/components/sidebar/SessionRailCard.tsx`
- Modify: `src/components/sidebar/CompactVersionRow.tsx` if needed
- Test: `src/components/sidebar/SessionCard.test.tsx`
- Test: `src/components/sidebar/SessionRailCard.test.tsx`

**Step 1: Write the failing component tests**

Add tests proving running sessions with `attention_kind = waiting_for_input` render the waiting label, and idle sessions still render the old idle label.

**Step 2: Run the tests to verify they fail**

Run: `bun vitest src/components/sidebar/SessionCard.test.tsx src/components/sidebar/SessionRailCard.test.tsx`

**Step 3: Implement the minimal UI changes**

Use `attention_kind` to split waiting-for-input from idle styling and text without changing aggregate counts.

**Step 4: Run the tests to verify they pass**

Run: `bun vitest src/components/sidebar/SessionCard.test.tsx src/components/sidebar/SessionRailCard.test.tsx`

### Task 7: Full verification, review, and commit

**Files:**
- Verify the full diff

**Step 1: Run targeted tests**

Run the focused Rust and Vitest commands from the earlier tasks.

**Step 2: Run the full project verification suite**

Run: `just test`

**Step 3: Request code review**

Request a review over the final diff before merging.

**Step 4: Create the requested squashed commit**

Stage the implementation and create one commit with a squash-style message summarizing the feature.
