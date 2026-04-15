# Improve Clarify Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `build_spec_clarification_prompt` so the clarify agent performs deep investigation, runs a per-question research gate, and records verifiable Context entries before asking the user anything.

**Architecture:** Replace the prose rule list inside `build_spec_clarification_prompt` in `src-tauri/src/commands/schaltwerk_core.rs` with an imperative, section-anchored prompt body (`INVESTIGATION:`, `CONTEXT_FORMAT:`, `QUESTION_RULES:`, `QUESTION_RESEARCH_GATE:`, `EARLY_EXIT:`, `LATER_TURNS:`, `PROHIBITIONS:`). Add unit tests in the existing `spec_clarification_prompt_tests` module that use regex-per-anchor assertions on the rendered string.

**Tech Stack:** Rust (Tauri backend), existing unit-test harness in the same file, `cargo nextest`.

---

### Task 1: Add failing tests asserting every required prompt invariant

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs` (extend module `spec_clarification_prompt_tests`, lines ~308-353)

**Step 1:** Add regex-per-anchor tests for each required section header, required substrings inside each section (gates, rules, outcomes), minimum-evidence floor phrasing, no-invented-requirements rule, Claude-path skill/subagent clause, non-Claude fallback, and the paired-`verified: researched` requirement. Keep the existing `prompt_mentions_attention_tool_and_problem_goal_sections` test.

**Step 2:** Run tests → they must fail because the current prompt lacks every new anchor.

Run: `cd src-tauri && cargo nextest run -p lucode-app spec_clarification_prompt_tests --no-fail-fast`
Expected: FAIL on the new assertions; existing test still passes.

**Step 3:** Commit checkpoint (local only, squashed at the end).

---

### Task 2: Rewrite the prompt body with all required anchors

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs:290-296` (`build_spec_clarification_prompt`)

**Step 1:** Replace the `format!(...)` string with an imperative, section-anchored body. Preserve the `{title}` and `{content}` interpolation. Keep the `lucode_spec_set_attention` / `lucode_spec_set_stage` workflow instructions (tested by the existing test).

**Step 2:** Run the full test module.

Run: `cd src-tauri && cargo nextest run -p lucode-app spec_clarification_prompt_tests`
Expected: PASS on all tests including the new anchor tests and the original attention-tool test.

---

### Task 3: Full validation suite

**Step 1:** Run `just test` from worktree root.

Run: `just test`
Expected: all green (TypeScript lint, Rust clippy, cargo shear, knip, Rust tests).

**Step 2:** If any failure, fix root cause; do not skip.

---

### Task 4: Squashed commit

**Step 1:** Stage only the intended files (`src-tauri/src/commands/schaltwerk_core.rs`, `docs/plans/2026-04-14-improve-clarify-prompt.md`).

**Step 2:** Commit with a conventional message describing the prompt overhaul.
