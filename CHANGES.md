# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## Quick Spec / Custom Mode in NewSessionModal

The favorites row in the New Session modal now hosts two fixed cards:

- **Spec** (always first) — switches the modal into spec-creation mode in one click. Hides Customize, branch, and agent selection. The footer button becomes "Create Spec".
- **Custom** (always last) — restores the full configuration UI, including the parallel-versions / multi-agent dropdown next to Cancel.

The "Create as spec" checkbox inside Customize is removed (its job is now owned by the Spec card). The parallel-versions dropdown is hidden whenever a real preset/variant favorite is selected, since presets already define their own slot count.

`⌘1` always picks the Spec card; the user's real favorites shift to `⌘2`–`⌘N`; the next index after the last favorite picks Custom.

## Consolidation Sessions

Adds a "consolidation" session type for reviewing and reconciling code from multiple parallel agent sessions in a version group.

- `is_consolidation` boolean flag on sessions (DB column, Rust entity, frontend types)
- "Consolidate" button on version group headers (visible when 2+ sessions are running/reviewed)
- Purple MERGE badge on consolidation session cards
- Auto-generated consolidation prompt listing each session's ID, branch, worktree path, and diff stats
- Pre-filled NewSessionModal via `ConsolidateVersionGroup` UI event
- `lucode_promote` accepts an optional `winner_session_id`: when promoting a consolidation session, the consolidated commits are atomically transplanted onto the chosen winner's branch (via a single `reset --hard` in the winner's worktree) so the winner survives with the merged work. The losing source versions are cancelled automatically, while the consolidation session stays open for manual review and cleanup. Without `winner_session_id`, promotion falls back to the legacy behavior (consolidation session survives).
- `lucode_confirm_consolidation_winner` now cancels all active candidate sessions, including the winning candidate, plus any judge sessions. The structured response now includes `judge_sessions_cancelled`.

## Codex Auto-Approve by Default

Lucode-launched Codex sessions now run with `--ask-for-approval never` so the agent no longer stops mid-run waiting for interactive command approval. Applies to fresh starts, resume-by-id, `__resume__` picker, `__continue__`, legacy `file://` URI resume, and orchestrator launches — everything that flows through `build_codex_command_with_config`. Lucode also strips user-supplied approval overrides (`--ask-for-approval`, `-a`, `--full-auto`, `--dangerously-bypass-approvals-and-sandbox`) from extra Codex CLI args so the non-interactive default stays authoritative. Sandbox mode selection is unchanged and remains the containment boundary; `danger-full-access` users lose prompts as an accepted tradeoff. No UI toggle is exposed.
