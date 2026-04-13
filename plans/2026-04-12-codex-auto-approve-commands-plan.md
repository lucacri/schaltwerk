# Codex Auto-Approve Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all Lucode-managed Codex launches default to non-interactive command approval for both fresh and resumed sessions.

**Architecture:** Add the Codex approval policy in the shared Rust Codex command builder, then enforce it in the Codex-specific final-arg merge path so user-configured extra CLI args cannot re-enable approval prompts. This keeps the behavior Codex-only and allows all Lucode launch entry points that use the shared adapter to inherit the default.

**Tech Stack:** Rust, Tauri backend session/agent launch plumbing, Rust unit tests

---

### Task 1: Lock the command-builder contract

**Files:**
- Modify: `src-tauri/src/domains/agents/codex.rs`

**Step 1: Write the failing tests**

Add or update unit tests in `src-tauri/src/domains/agents/codex.rs` to expect `--ask-for-approval never` in:
- fresh session with prompt
- fresh session without prompt
- resume picker / `resume`
- continue-most-recent / `resume --last`
- explicit resume session id
- danger-full-access resume path

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test test_new_session_with_prompt test_new_session_no_prompt test_resume_picker_mode test_continue_most_recent_session test_resume_by_session_id test_resume_by_session_id_with_danger_mode --manifest-path src-tauri/Cargo.toml
```

Expected: existing command assertions fail because the approval flag is missing.

**Step 3: Write minimal implementation**

Update `build_codex_command_with_config` in `src-tauri/src/domains/agents/codex.rs` to append `--ask-for-approval never` immediately after the sandbox flag.

**Step 4: Run test to verify it passes**

Re-run the same cargo test command and confirm those assertions pass.

### Task 2: Enforce the hard default during Lucode arg merge

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core/agent_ctx.rs`

**Step 1: Write the failing tests**

Add unit tests that cover Lucode-managed Codex arg merging when extra CLI args try to set:
- `--ask-for-approval on-request`
- `--ask-for-approval=untrusted`
- `-a on-request`

Expected merged args should retain the parsed Lucode-provided `--ask-for-approval never` and drop the conflicting extra override.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test codex_harness_strips_duplicate_approval codex_harness_strips_duplicate_approval_flag_equals_form codex_harness_strips_duplicate_approval_short_flag --manifest-path src-tauri/Cargo.toml
```

Expected: tests fail because `build_final_args` currently leaves approval overrides in place.

**Step 3: Write minimal implementation**

Extend Codex-specific arg sanitization in `agent_ctx.rs` to strip approval-policy overrides from Lucode-managed extra Codex CLI args, while keeping current sandbox stripping behavior.

**Step 4: Run test to verify it passes**

Re-run the same cargo test command and confirm those assertions pass.

### Task 3: Verify cross-path behavior and regressions

**Files:**
- Modify if needed: `src-tauri/src/domains/sessions/service.rs`
- Test: existing unit tests in `src-tauri/src/domains/sessions/service.rs`

**Step 1: Run targeted session/orchestrator tests**

Run:

```bash
cargo test test_start_spec_with_config_uses_codex_and_prompt_without_resume --manifest-path src-tauri/Cargo.toml
```

Expected: pass with the updated Codex command containing both sandbox and approval policy, still resuming on the second start.

**Step 2: Refactor only if tests show a real gap**

Prefer no service-layer code change if the shared builder already covers these paths.

**Step 3: Run focused Rust verification**

Run:

```bash
cargo test codex --manifest-path src-tauri/Cargo.toml
```

Expected: Codex-related Rust tests pass.

### Task 4: Full verification, review, and commit

**Files:**
- Review diff for touched files only

**Step 1: Run full project verification**

Run:

```bash
just test
```

Expected: full suite passes.

**Step 2: Request code review**

Review the final diff with the code-review workflow and address any real issues before commit.

**Step 3: Create squashed commit**

Run:

```bash
git add plans/2026-04-12-codex-auto-approve-commands-design.md plans/2026-04-12-codex-auto-approve-commands-plan.md src-tauri/src/domains/agents/codex.rs src-tauri/src/commands/schaltwerk_core/agent_ctx.rs
git commit -m "fix: disable Codex approval prompts in Lucode launches"
```
