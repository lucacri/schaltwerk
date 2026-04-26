# Consolidation Report — OpenCode Startup Prompt Auto-Submit

> **Filing status:** `lucode_consolidation_report` returned `404 Not Found - Consolidation round 'cd9393e6-8273-48a8-9c93-0561f7bbdd09' not found`. The round record is missing from the MCP backend while the candidate sessions (`_v1`, `_v2`, `_v3`) and the consolidation session itself are still live. Re-file once the round record is restored, or use this document as the source of truth.

- **Consolidation session:** `d33b7363-47be-4eec-a497-1d706988b8cc-consolidation`
- **Branch:** `lucode/d33b7363-47be-4eec-a497-1d706988b8cc-consolidation`
- **Base session ID (recommended):** `d33b7363-47be-4eec-a497-1d706988b8cc_v3`
- **Squashed commit:** `ac3e1a9b fix(opencode): submit queued startup prompts reliably`

## Summary

OpenCode queued startup prompts pasted into the TUI but were not submitted, forcing a manual Enter. The consolidated fix routes the queued path through agent-aware submission semantics, gates dispatch on a manifest-declared OpenCode ready marker with a deterministic deadline fallback, and protects the dispatch claim against double-fire races.

## Base Choice — v3

`d33b7363-47be-4eec-a497-1d706988b8cc_v3` is the only candidate addressing the broader correctness surface beyond the single hardcoded `(true, false)` payload:

- Marker-or-deadline dispatch (instead of marker-only or timer-only).
- `dispatch_in_progress` claim flag preventing double dispatch when concurrent output chunks both satisfy the marker.
- Manifest-driven OpenCode `ready_marker = "? for shortcuts"`.
- Pre-create queueing (queue command before terminal exists, dispatch once it does).
- `initial_command_queue_policy` helper combining manifest data with `submission_options_for_agent` in one place.
- Comprehensive test coverage including pre-create scenarios.

## Per-Candidate Disposition

### v1 (`_v1`)

- **Kept:** the design framing in v1's plan doc (root cause walkthrough, "Risks", "Non-changes (deliberate)") was clearer than v3's, so the consolidated `plans/2026-04-26-opencode-startup-prompt-submit-design.md` adopts that structure while incorporating v3's options analysis.
- **Considered but not adopted:** v1's API choice of plumbing `agent_type: Option<String>` through `queue_initial_command` and computing submission flags at dispatch time. v3's `(use_bracketed_paste, needs_delayed_submit)` boolean plumbing is equivalent in behavior but keeps the backend ignorant of agent identity — a cleaner separation of concerns and no need to update the backend signature when new agents are added.

### v2 (`_v2`)

- **Subsumed:** v3 already includes the same `Some("opencode") => (true, true)` arm in `submission_options_for_agent`.
- **Insufficient on its own:** v2 only modifies `submission_options_for_agent`, which in main is exclusively consumed by the follow-up paste path (`paste_and_submit_terminal`). The queued startup path hardcoded `build_submission_payload(..., true, false)`, so v2 alone does not fix the reported bug.

### v3 (`_v3`) — base

- **Kept:** all functional code (manifest marker, queue policy helper, marker+deadline dispatch, dispatch claim, pre-create scheduling, delayed submit, expanded tests).
- **Removed:** unrelated rustfmt churn in `shared/login_shell_env.rs` and the parameter-block reformat in `tmux.rs::new_with_backend_for_test`. Reverted noisy whitespace changes in `cancel_session` and trailing-blank edits in `commands/schaltwerk_core.rs`.
- **Bug fixed in v3 implementation:** v3's plan doc said "let ready-marker dispatch fall back to the deadline if the marker never appears," but v3's `initial_command_queue_policy` removed `opencode` from the `dispatch_delay` arm, leaving marker-only. If `"? for shortcuts"` ever changes upstream, the prompt would hang forever. **Restored** a 5 s `dispatch_delay` for `opencode` so the marker is the fast path and the deadline is the safety net. Updated the corresponding unit test (renamed from `..._without_delay` to `..._with_fallback_deadline` and asserts `Some(Duration::from_millis(5000))`).

## Verification

`just test` on the rebased branch:

- TypeScript lint + typecheck: green
- MCP lint + tests: 188 pass / 0 fail
- Frontend vitest: green
- Rust clippy + cargo shear + knip: green
- `cargo nextest`: 2058 passed, 0 failed (1 pre-existing leaky flag on `adapter_close_removes_pid_from_drop_tracker`, unrelated to this work)

Branch is already current with `origin/main` (no rebase needed; merge-base = `origin/main`).

## Files Changed

```
plans/2026-04-26-opencode-startup-prompt-submit-design.md  (new, consolidated)
src-tauri/agents_manifest.toml                              (+1)
src-tauri/src/commands/schaltwerk_core.rs                   (queue_policy helper + opencode 5s fallback)
src-tauri/src/domains/agents/manifest.rs                    (test_opencode_definition)
src-tauri/src/domains/terminal/local.rs                     (state fields, dispatch claim, marker+deadline, delayed submit, pre-create activation)
src-tauri/src/domains/terminal/manager.rs                   (queue_initial_command signature)
src-tauri/src/domains/terminal/manager_test.rs              (3 new integration tests)
src-tauri/src/domains/terminal/mod.rs                       (TerminalBackend trait signature)
src-tauri/src/domains/terminal/tmux.rs                      (forward new params)
src-tauri/src/services/mod.rs                               (re-export submission_options_for_agent)
```

## Notes for Synthesis Judge

- **API shape:** v1's `agent_type` plumbing is one fewer parameter on the backend trait; v3's boolean plumbing keeps the terminal backend agnostic to agent identity (the policy decision lives at the call site in `commands/schaltwerk_core.rs`). Either is defensible.
- **Marker drift safety:** the 5 s OpenCode fallback is bounded — fast machines hit the marker in well under 1 s; only marker drift forces the full wait. 5 s matches the magnitude of the existing `ENTER_REPLAY_TIMEOUT_MS` (2 s) plus the original 1500 ms historical delay with margin.
- **Plan files:** consolidated v1's design doc; dropped v3's separate `*-plan.md` (the plan was already executed; the design doc captures the durable rationale).
