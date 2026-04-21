# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## Specs: persist inline review comments across all exits

Inline review comments were held only in `SpecEditor` React state and were wiped on every path that left review mode — Escape, Cancel Review, Exit Review, a successful Finish Review send, session switch, reload, or a crash. Users who backed out for any reason lost the entire draft. Comments are now persisted per spec in the project database on every submit and survive every exit path. The next time review mode is opened on that spec, a modal surfaces any stored draft and offers **Clear & start fresh** (the only way to discard stored comments) or **Continue** (hydrate the local list and keep editing). No exit path deletes the store — Finish Review is a send, not a clear — so a mid-send crash or accidental Escape still leaves the work recoverable.

- `src-tauri/src/infrastructure/database/db_schema.rs` creates `spec_review_comments (id, spec_id, line_start, line_end, selected_text, comment, created_at, FK→specs.id ON DELETE CASCADE)` plus `idx_spec_review_comments_spec (spec_id, created_at)`. An idempotent migration drops any older `(comment_id, start_line, end_line, timestamp)` column layout from a prior attempt.
- New repo module `db_spec_review_comments.rs` implements `SpecReviewCommentMethods` (`list`, `replace` transactional delete-then-insert, `clear`) and exposes a `PersistedSpecReviewComment` serde type for the IPC wire shape.
- `SessionManager::{list,save,clear}_spec_review_comments(spec_name, …)` resolve spec-name → id and delegate to the repo, stamping each comment's `spec_id` so the client doesn't have to know it.
- Tauri commands `schaltwerk_core_{list,save,clear}_spec_review_comments(name, project_path?)` wire through the project-scoped session manager. Registered in `commands/mod.rs`, `main.rs`, and `src/common/tauriCommands.ts`.
- New `useSpecReviewCommentStore(specName, projectPath)` hook serialises `SpecReviewComment` ↔ snake-case wire shape. `SpecEditor` calls `load()` on review-mode entry, shows a `resumeReview*` modal when rows exist (Clear calls `clear()`, Continue hydrates), calls `save(next)` after every `handleSubmitComment`, and leaves the DB untouched on Finish Review, Cancel Review, Escape, Exit Review, and session switch.
- i18n keys `specEditor.resumeReview{Title,Message,Continue,Clear}` in `en.json`, `zh.json`, and `types.ts`.
- Covered by Rust tests (schema + idempotent migration drop, DB-level insert/replace/clear/cascade, service-level round-trip/replace/clear/missing-spec), hook tests for `useSpecReviewCommentStore` (load/save/clear wire shapes, optional project path), and new `SpecEditor` tests for no-prompt-when-empty, Continue hydrates, Clear wipes, submit persists, and Finish/Cancel/Escape/Exit each leave `clear` uncalled.

## Prompts: teach agents that fenced `mermaid` blocks render as diagrams

Lucode's `MarkdownRenderer` already renders fenced ```mermaid blocks as diagrams across the spec editor, plan views, consolidation reports, and forge issue/PR panels, but none of the agent-facing prompt templates mentioned the capability — so Claude/Codex/Gemini/Droid never produced flow, sequence, or state diagrams even when one would explain a concept more clearly than prose. The five prompts that drive agent-written markdown rendered by the UI now carry a concise diagram hint with the user's "when it makes sense" trigger phrase and four concrete use cases (architecture overviews, data or control flow, state machines, sequence of events).

- A single shared `MERMAID_DIAGRAM_GUIDANCE` constant in `src-tauri/src/domains/settings/defaults.rs` is appended to `default_consolidation_prompt_template`, `default_plan_candidate_prompt_template`, `default_plan_judge_prompt_template`, and `default_judge_prompt_template` so candidate/consolidation/plan-judge/synthesis-judge agents all see identical wording.
- `build_spec_clarification_prompt` in `src-tauri/src/commands/schaltwerk_core.rs` reuses the same constant and adds a clarification-stage qualifier ("diagrams are for framing existing structure or problem-space context only; do not draft solution-design diagrams") so the hint doesn't contradict the prompt's "no solution plans" rule.
- The frontend fallback in `src/common/generationPrompts.ts` gains a mirrored `MERMAID_DIAGRAM_GUIDANCE` constant that is interpolated into `consolidation_prompt` and also populates the previously-empty `plan_candidate_prompt_template`, `plan_judge_prompt_template`, and `judge_prompt_template` so the backend-unavailable path stays aligned with the Rust defaults.
- The consolidation template also drops a stale reference to `lucode_promote` / `winner_session_id` in favor of `lucode_consolidation_report` / `base_session_id`, matching the current consolidation contract. A Rust regression test and an integration test in `src-tauri/src/commands/settings.rs` pin both invariants.
- User overrides keep working unchanged — the settings resolver still prefers a stored template when present and only substitutes the default when the override is empty.
- Covered by six new Rust assertions (mermaid guidance per template + consolidation-template contract), the settings integration test, and an extended frontend-fallback test that pin the phrase "when it makes sense" plus each of the four use-case keywords, so any future rewording that drops the guidance fails CI.

## Sessions: surface cancel-blocker reasons and offer force removal

Cancel used to fail silently with a raw backend string (`GitOperationFailed: …`) or proceed while only warning about uncommitted work — either way the user had no signal about *why* cleanup was blocked and no in-app path to escalate. The cancel pipeline now refuses cleanly with a typed `CancelBlocker` when it detects uncommitted changes, an orphaned worktree directory, a locked worktree, or a git operation error. The existing `CancelConfirmation` modal swaps to a blocked state that names the reason (with a file list for dirty trees, expected path for orphans, lock reason, or failing git operation) and offers a destructive **Force remove** escalation. Force routes through a dedicated coordinator path that force-removes the worktree, prunes stale git metadata, force-deletes the branch, and deletes the session row last so the UI cannot keep refreshing a ghost session. Blocked cancels no longer write the `force_cancelled` consolidation stub report.

- `errors.rs` adds a `#[serde(tag = "type", content = "data")]` `CancelBlocker` enum (`UncommittedChanges { files }`, `OrphanedWorktree { expected_path }`, `WorktreeLocked { reason }`, `GitError { operation, message }`) and wraps it in `SchaltError::CancelBlocked { blocker }` so the envelope arrives at the frontend already structured.
- `domains/sessions/lifecycle/cancellation.rs` introduces `CancelBlockedError` (carried through `anyhow::Error` for downcast at the command layer) plus a pure `detect_cancel_blocker_for(repo, session)` preflight that runs the orphan / lock-file / uncommitted-sample checks when `!config.force`. Both `CancellationCoordinator::cancel_session[_async]` and `StandaloneCancellationCoordinator::cancel_filesystem_only` short-circuit on a blocker. A new `force_cancel_session_async` terminates processes, force-removes the worktree, force-deletes the branch, and finally deletes the DB row.
- `schaltwerk_core_cancel_session` emits `SchaltEvent::SessionCancelBlocked { session_name, blocker }` and returns `SchaltError::CancelBlocked` on refusal. A new `schaltwerk_core_force_cancel_session` Tauri command drives the forced path; `SessionManager::force_cancel_session` skips writing the consolidation stub on blocked cancels.
- Shell-outs for the force path land in `domains/git/branches.rs::force_delete_branch` (`git branch -D`) and `domains/git/worktrees.rs::force_remove_worktree` (`git worktree remove --force --force`, lock-file removal, filesystem fallback, prune).
- Frontend adds `src/common/cancelBlocker.ts` with a `parseCancelBlocker(err)` helper that tolerates the three Tauri IPC error shapes (plain object, stringified JSON, `Error` whose message is JSON). `CancelConfirmation.tsx` gains a `cancelBlocker` prop that swaps the body to a dedicated `CancelBlockerBody` per variant and switches the confirm button to destructive "Force remove (discards work)". `App.tsx` threads the blocker via `setCancelBlocker`, handles both the invoke-error and `SessionCancelBlocked` event paths, and calls the new force command on confirm.
- i18n keys `dialogs.cancelSession.{blockedTitle,blockedBody,forceRemove,blockedUncommitted,blockedOrphaned,blockedLocked,blockedGitError,affectedFiles,expectedPath,lockReason,gitOperation}` in `en.json` and `zh.json`, plus matching entries in `src/common/i18n/types.ts`.
- Covered by Rust tests for each blocker variant (uncommitted / orphan / locked / git-error), force-path tests (dirty worktree, orphaned worktree with DB row) and a `blocked_cancel_does_not_auto_file_consolidation_stub_report` service test. Frontend tests cover every envelope shape of `parseCancelBlocker`, every blocker branch in `CancelConfirmation`, and the `CancelBlocked` `SchaltError` formatting in `errors.test.ts`.

## Terminal: deliver oversize agent prompts through a launch script

Agent prompts that push the tmux `new-session` argv above Lucode's conservative 14 KB tmux-IPC budget now route through a temporary `0600` shell script instead of being sent directly through tmux. The script exports the same environment, captures large argv entries through quoted heredocs, removes itself, and `exec`s the original agent command so the pane still ends up running the agent as the foreground process. Normal launches below the threshold keep the existing inline path.

- `tmux_cmd.rs` now exposes `TMUX_IPC_SOFT_LIMIT_BYTES = 14_000` behavior through `argv_exceeds_tmux_ipc`, while keeping the existing 500 KB hard guard for exec-scale failures.
- `agent_launcher::launch_script` writes oversize argv entries to per-arg sidecar files (`lucode-launch-<nonce>-arg<idx>`, 0600) next to the script, then reads them back in the script via `$(cat <path>; printf '\001')` with a one-byte sentinel strip. This avoids the bash-3.2 parser bug where heredocs nested inside `$(...)` command substitution misparse on any unbalanced apostrophe in the body — prompts containing English possessives (`agents' plans`) were previously rejected with `unexpected EOF while looking for matching ')'` when launched under macOS `/bin/sh`.
- `schaltwerk_core_start_agent_in_terminal` prepares the final direct or shell-chain command first, then swaps only oversized launches to `sh <script>`, keeping setup-script and Amp shell-chain behavior intact.
- Startup removes stale `lucode-launch-*` artifacts (scripts and sidecars) older than one hour from the temp directory as a best-effort cleanup for crashes before self-deletion.
- Covered by Rust tests for the tmux IPC threshold, sidecar-path rendering, combined sidecar + `$0` self-delete, env export ordering, 0600 permissions, shell metacharacter roundtrip, unbalanced-apostrophe roundtrip under `/bin/sh`, sidecar cleanup after exec, oversized routing, and stale-artifact cleanup.

## Improve Plan button for clarified specs

The Improve Plan flow was already wired through MCP (`lucode_improve_plan` / `POST /api/specs/{name}/improve-plan`), but the desktop app had no visible action for it — so users on the clarified stage had to leave the app to start a plan round. A new `Improve Plan` button now appears on clarified specs in the sidebar card, the compact version row, the spec metadata panel, and the spec editor toolbar. It is hidden for draft specs and disabled with a tooltip when a plan round is already active. The button invokes a new Tauri command `schaltwerk_core_start_improve_plan_round` that reuses the same backend validation, rollback, and session-refresh logic as the MCP HTTP route by delegating to a shared `start_improve_plan_round_inner` helper. `SessionInfo` now carries `improve_plan_round_id` so the UI can detect active rounds without a second fetch. Success and failure both surface through the existing toast provider, and errors go through the project logger.

- `src-tauri/src/mcp_api.rs` splits `start_improve_plan_round` into a thin HTTP adapter plus `start_improve_plan_round_inner(app, name, StartImprovePlanRoundParams)` and a pure `validate_start_improve_plan_round_preconditions(db, manager, name)` helper. Four new unit tests cover draft rejection, clarified acceptance, active-round conflict, and stale-promoted-link clearing.
- New Tauri command `schaltwerk_core_start_improve_plan_round` in `commands/schaltwerk_core.rs`, registered via `commands/mod.rs` and `main.rs`, returns `ImprovePlanRoundResponse` (spec name, round id, candidate session names).
- `SessionInfo` gains `improve_plan_round_id: Option<String>`, populated from `spec.improve_plan_round_id` in the spec enrichment path. Mirrored in `src/types/session.ts`.
- `SessionActions` gains `onImprovePlanSpec`, `canImprovePlanSpec`, `improvePlanActive`, `improvePlanStarting` props and a `VscChecklist` icon button between Refine and Run with tooltip rules for draft / clarified / active / starting states.
- `SessionCard`, `CompactVersionRow`, and `SpecMetadataPanel` forward eligibility from `s.spec_stage` / `s.improve_plan_round_id` and wire the handler.
- `Sidebar` handles the action globally via `handleImprovePlanSpec`, which calls `TauriCommands.SchaltwerkCoreStartImprovePlanRound` and surfaces success/error toasts. `SpecMetadataPanel` and `SpecEditor` invoke the same command locally.
- `SessionCardActionsContext` picks up `onImprovePlanSpec` plus `improvePlanStartingSessionId`; `SessionCard` and `CompactVersionRow` turn that id into per-row `improvePlanStarting`, so the sidebar IconButton renders a spinner during the async call (the fix for the earlier sidebar inconsistency). Style-guide and existing `SessionCard`/`CompactVersionRow`/`SessionVersionGroup` tests get the new mock field.
- A shared `src/hooks/useImprovePlanAction.ts` hook handles the Tauri invoke, success/error toasts, and `logger` error path in one place, so Sidebar, SpecMetadataPanel, and SpecEditor all use the same flow (and expose the same `startingSessionId`).
- i18n strings under `sessionActions.improvePlan*` and `specEditor.improvePlan*` in `en.json`, `zh.json`, and `types.ts`.
- Frontend test coverage in `SessionActions.test.tsx` (renders/invokes/disables/loading/hidden) and `SpecEditor.test.tsx` (starts, hidden on draft, disabled when active). The previously-broken `SpecWorkspacePanel.middleClick.test.tsx` mock path (`../../plans/SpecEditor` → `../SpecEditor`) is corrected so the test no longer bypasses its own `vi.mock`.

## Refactored Judge Step for implementation rounds

The consolidation judge for implementation rounds now synthesizes a new best-of implementation instead of picking a candidate session. The judge session itself is promoted—under the original spec name—on acceptance. Candidate reports no longer act as implementation winners and serve only as completion signals to trigger the judge.

- Judge agent type is now sourced from the global `app_config.consolidation_default_agent_type` setting.
- Judge creation is idempotent across report, cancellation, and manual triggers.
- Frontend displays "Judge synthesizing" state and "Judge ready — promote {rootName}" flow.
- Workflow and candidate prompts updated to reflect the synthesis-based consolidation.
- Plan rounds (`round_type == "plan"`) remain unchanged using the analyst-pick flow.

## Settings: default agent / preset for consolidation

Launching a consolidation round used to leave the user re-picking the favorite in `NewSessionModal` every time, and the judge's agent was inferred from whichever candidate was created first. The project-general settings pane now carries a persisted "Default consolidation agent" that accepts either a raw agent or a preset and is applied at candidate launch; the judge keeps inheriting from candidate[0], which now reflects the stored default.

- Schema: `app_config` gets `consolidation_default_agent_type TEXT DEFAULT 'claude'` and `consolidation_default_preset_id TEXT DEFAULT NULL`, mirroring the `ContextualAction` shape that already allows agent-or-preset. Migration is idempotent via `ALTER TABLE ... ADD COLUMN`.
- `AppConfigMethods::{get,set}_consolidation_default_favorite` round-trip a small `ConsolidationDefaultFavorite { agent_type, preset_id }` struct, and two new Tauri commands (`schaltwerk_core_get_consolidation_default_favorite`, `schaltwerk_core_set_consolidation_default_favorite`) expose them with empty-string normalization and a preset-clears-agent invariant.
- `useClaudeSession` gets `getConsolidationDefaultFavorite` / `setConsolidationDefaultFavorite` helpers. `SettingsModal` renders a new row under project general that lists every enabled preset (all slots enabled) followed by every enabled raw agent, storing the result back through the setter.
- `App.tsx`'s consolidation candidate prefill reads the default favorite and merges `{ presetId }` or `{ agentType }` into the emitted `UiEvent.NewSessionPrefill`, driving the existing `NewSessionModal` preset/agent selection without further changes. `applyConsolidationDefaultFavorite` encapsulates the precedence (preset beats agent, empty strings are ignored).
- `NewSessionModal` now holds a pending preset id from the prefill until `useAgentPresets` finishes loading, so a preset default is no longer dropped when the modal opens before presets arrive.
- Covered by: new DB/tauri tests in `db_app_config.rs` and `schaltwerk_core.rs` (default, agent→preset clearing, preset→agent clearing, DTO normalization), hook tests in `useClaudeSession.test.ts`, helper tests in `consolidationPrefill.test.ts`, a `SettingsModal.test.tsx` case that drives the full load → change → save round-trip, `NewSessionModal.test.tsx` coverage of the preset-load race, and `App.test.tsx` end-to-end tests that assert raw-agent and preset defaults reach the prefill detail.

## View Processes window (macOS)

Added a `Window > View Processes…` menu item that opens a read-only overlay listing every Lucode-owned tmux server (socket prefix `lucode-v2-`), its sessions, and the processes running inside each pane. Each server row resolves its `project_hash16` suffix against `ProjectHistory` to show the owning project's name and path, falling back to the raw hash when the project is not in recent history. Sessions list their created / last-activity timestamps and attached state; each pane shows `pane_current_command`, PID, RSS (MiB), and %CPU sampled via a single `ps -o pid=,rss=,%cpu=` call across all live PIDs. Sockets whose tmux server has exited (socket file present but `list-sessions` returns "no server running") are flagged with a "Stale" badge instead of aborting the listing. No polling — the overlay refreshes only on open and on the explicit Refresh button. No kill/signal actions in v1.

- New backend module `src-tauri/src/domains/terminal/tmux_inspect.rs` owns socket enumeration, tmux format-string parsing (`list-sessions`, `list-panes -a`), `ps` parsing, project-hash resolution, and the async orchestrator. Reuses the existing `SystemTmuxCli` so every tmux call uses the Lucode `-L <socket> -f <conf>` pair.
- New `SchaltEvent::ViewProcessesRequested` carries the macOS menu click from `build_app_menu` → `on_menu_event` into the frontend. No keyboard accelerator (`Mod+Shift+P` stays bound to CreatePullRequest).
- New Tauri command `list_lucode_tmux_servers` (exposed via `TauriCommands.ListLucodeTmuxServers`) wraps the async entry point; the binary-layer wrapper loads `ProjectHistory` and hands it in as a `ProjectLookup` so the library stays binary-agnostic.
- New `ViewProcessesModal` under `src/components/diagnostics/` mounts in both `App.tsx` render branches and subscribes to the event. Uses `ResizableModal`, the `Button` UI primitive, and typography helpers; all colors/fonts go through the theme system.
- UI renders an attached/detached badge per session, formatted Created/Activity timestamps, and per-pane RSS (MiB) / CPU % columns.
- Covered by 21 Rust unit tests (socket-name helper, both tmux format parsers, ps parser, metrics join, env-driven socket-dir resolution, directory scan, stale detection, live server path, ps runner contract, project hash lookup, orchestrator) plus 6 frontend vitest cases (empty, rendered, stale badge, refresh, Escape close, error).
- Also updates `src/adapters/pierreDiffAdapter.ts` to match the current `@pierre/diffs` `Hunk`/`FileDiffMetadata` shapes so the repo's `bun run lint:ts` is green — this was broken on `main` before this change.

## Terminal: send PTY resize on attach-time forced fit even when xterm dimensions match

Extends the "Tmux agent terminal reattach stability" fix. The frontend's attach-time forced fit (`initial-fit`, `renderer-init`, `post-init`, `visibility`, `initial-raf`, `generic-resize-request`, `font-size-change`, `split-final`) short-circuits in `requestResize` when xterm's current cols/rows already equal the proposed dimensions, to avoid perturbing scroll position. Prior to this change, that short-circuit also skipped `schedulePtyResize`, so tmux never received a SIGWINCH on reattach — leaving the pane blank or showing stale content until the user manually resized the OS window. Now the same-size short-circuit still skips `xterm.resize()` (preserving scroll) but forwards the size to the PTY with `{ force: true }` so the SIGWINCH reaches tmux synchronously with the attach.

- The fix is surgical: a single block added inside the existing equality-match branch of `requestResize` in `src/components/terminal/Terminal.tsx`. It is gated on `shouldForce && shouldImmediate`, which only happens on explicit forced+immediate fits, so the non-force ResizeObserver path (split-drag ticks) is untouched and does not spam SIGWINCH.
- Affects both confirmed surfaces uniformly: the session top agent terminal (`session-*-top`) and the spec clarification top terminal (`spec-orchestrator-session-*~*-top`). Both pass through `isTopTerminalId`, both are tmux-backed per `is_agent_terminal` in `src-tauri/src/domains/terminal/lifecycle.rs`, and both mount through the same `<Terminal>` component.
- Covered by two new regression tests in `src/components/terminal/Terminal.test.tsx` (`sends a PTY resize on attach-time forced fit even when xterm dimensions match (session top)` and `sends a PTY resize on attach-time forced fit for spec clarification top terminal`) that drive the frontend state machine directly via the captured `font-size-changed` handler (no real DOM timing) and assert `invoke(TauriCommands.ResizeTerminal, { id, cols, rows })` fires even when `proposeDimensions` returns the xterm's current dimensions.

## Tmux-owned mouse wheel scrolling

Mouse wheel inside a tmux-attached Lucode terminal now scrolls tmux's 50 000-line history buffer instead of emitting cursor-up/down keystrokes to the running agent. `tmux_conf.rs` flips `set -g mouse on` and re-adds the root/copy-mode bindings that `unbind-key -a` strips, so the first wheel tick enters copy-mode and scrolls three lines up (`copy-mode -e; send-keys -X -N 3 scroll-up`), subsequent wheel ticks in copy-mode drive `scroll-up`/`scroll-down`, drag selects and copies via the existing `set-clipboard on` OSC 52 path, double-click and right-click select a word, and click / `q` / `Escape` / `Enter` are wired as copy-mode exit paths. The config version stamp carries a `mouse-v1` suffix so existing per-project tmux servers rewrite and reload the config on next attach. `Terminal.tsx` narrows its mouse-report filter to X10 only, so SGR wheel reports reach tmux regardless of xterm.js buffer state.

Accepted tradeoffs: Alt+click cursor-move in the agent prompt no longer works, URL / `path:line` link click no longer routes through Tauri's external-URL handler (selection + copy is the workaround), right-click replaces tmux's default context menu with word selection, and selection visuals come from tmux copy-mode rather than xterm.js.

## Consolidation: auto-file stub report when a candidate exits without reporting

A consolidation round used to stall forever if a candidate session was cancelled (or converted to a spec) before its agent called `lucode_consolidation_report`: `all_candidates_reported` would never return true, so neither the auto-judge nor the candidate-verdict banner could unblock the round. Lucode now auto-fills a stub report on the exiting candidate's behalf so the round can progress.

- New module `src-tauri/src/domains/sessions/consolidation_stub.rs` hosts `ensure_stub_report_for_candidate`. It writes a Markdown report body — containing `git diff --stat` and `git log --oneline` against the candidate's parent branch — via `update_session_consolidation_report` with a new `source = "auto_stub"` column value and the candidate's own id as the `consolidation_base_session_id` (so the existing `all_candidates_reported` invariant is satisfied). The helper no-ops when the session is not a candidate, already has a report, or the round is promoted.
- `SessionManager::cancel_session` / `fast_cancel_session` plus the `schaltwerk_core_cancel_session` Tauri command invoke the helper before the worktree is torn down, so every cancel path (UI button, MCP `lucode_cancel`, post-promotion sibling cleanup, convert-to-spec) produces the same outcome. The post-promotion path short-circuits because the round is already `"promoted"`.
- After a cancel completes the command (and the MCP `delete_session` handler) re-checks the round and calls a new `mcp_api::maybe_auto_start_consolidation_judge` helper that mirrors the existing post-report auto-judge logic — so an exiting candidate being the last one to "report" immediately kicks off the judge if no judge is running yet.
- Schema migration adds `sessions.consolidation_report_source` (`NULL` / `"agent"` / `"auto_stub"`) and `update_session_consolidation_report` takes a `source: &str` argument. Agent writes via `lucode_consolidation_report` always pass `"agent"`, so an agent report arriving after a stub overwrites both body and source naturally (no supersede branch).
- `build_judge_prompt` labels each candidate's `report_source` and annotates auto-filed stubs, so the judge can weight candidates that exited without analyzing.
- `SessionCard` renders a subtle "Auto-filed" badge in the consolidation lane when `consolidation_report_source === 'auto_stub'`, with a tooltip explaining why. The event payload, Jotai atoms, TS types, and MCP bridge all pass the new field through.
- Covered by unit tests in `consolidation_stub.rs` (write, idempotency, role / round-status short-circuits, agent-supersede) plus two integration tests in `mcp_api.rs` (`stub_report_unblocks_all_candidates_reported`, `agent_report_supersedes_auto_stub_source`) and two UI tests in `SessionCard.test.tsx` asserting the badge is shown only when the report is a stub.

## Tmux agent terminal reattach stability

Agent terminals backed by tmux now reattach without replaying hidden output that arrived while the pane was detached. Same-size resize requests are also forwarded to tmux so selecting a long-running session triggers the expected viewport redraw instead of staying blank until a manual resize.

## Terminal: fail fast when agent argv would overflow tmux/execve

Launching an agent with an enormous `initial_prompt` used to surface an opaque "tmux new-session failed (status 1): command too long" unhandled promise rejection — Claude, Codex, Gemini, OpenCode, Amp, Kilocode, and Qwen all inline the prompt as an argv entry, and once the total argv exceeds the OS `ARG_MAX`, tmux refuses to spawn the session. Lucode now measures the argv size before handing it to tmux and raises a Lucode-branded error when it would exceed a 500 KB safety limit.

- `TmuxCli::new_session_detached` in `src-tauri/src/domains/terminal/tmux_cmd.rs` sums the byte length of every argv entry (including `-e KEY=VAL` env pass-throughs) before invoking tmux. If the total exceeds `TMUX_ARGV_SOFT_LIMIT_BYTES = 500_000`, the method returns a clear error naming Lucode, the measured size, and the limit, instead of letting tmux fail with "command too long".
- The guard sits at the single point every agent launch goes through, so it applies to both the first-launch path and `force_restart=true` without per-agent plumbing, and to Claude/Codex/Gemini/OpenCode/Amp/Kilocode/Qwen identically. Droid already avoids argv inlining and is unaffected.
- The error propagates through the existing `create_terminal_with_app_and_size` → `inject_terminal_error` path, so users see the explanation inside the agent pane. This is deliberately fail-fast: no temp-file/stdin fallback is introduced — the goal is to replace the unhandled rejection with a diagnosable error, and gather telemetry on how often it fires before deciding on any further recovery strategy.
- Covered by new unit tests in `tmux_cmd.rs`: the guard rejects oversize argv without calling tmux, counts env-var bytes toward the total, and lets realistic 8 KiB prompts through unchanged.

## Consolidation: surface candidate verdict immediately

A consolidation candidate filing its report now acts as the round's initial recommendation, so the sidebar shows "Judge recommends …" and enables the confirm-winner banner the moment the agent finishes — no waiting for an optional judge session.

- `update_consolidation_report` on the candidate branch now flips the candidate's `ready_to_merge` via `mark_session_ready` and calls `update_consolidation_round_recommendation` with the candidate id as both `recommended_session_id` and `recommended_by_session_id`, moving the round to `awaiting_confirmation`. The auto-judge kick-off still runs afterwards (when configured) but its failure is logged and does not tear down the verdict update.
- `SessionVersionGroup` now derives the recommendation from the latest reported candidate (report + base_session_id present) when no judge verdict exists yet, so the banner, confirm button, dimming and round-id wiring all work before any judge session spins up. A judge verdict continues to take precedence as soon as one arrives.
- Added the `candidate_consolidation_report_records_initial_verdict` Rust test and the `surfaces a reported consolidation candidate as the initial recommendation before a judge exists` UI test to lock the behavior in.

## macOS: activate WKWebView accessibility tree for external dictation tools

Lucode now injects three `NSAccessibility` override methods onto NSApp's runtime class from the Tauri `.setup()` hook, teaching the app to advertise and accept the `AXManualAccessibility` and `AXEnhancedUserInterface` attributes. Without these overrides, the stock `tao` NSApplication returns `kAXErrorNotImplemented` (-25208) when any AX client tries to set those attributes, so WKWebView never populates its accessibility tree — and third-party dictation tools like Mac Whisper silently fail across every Lucode input surface (native `<input>`, CodeMirror, xterm, URL bar).

- New module `src-tauri/src/macos_accessibility.rs` using `objc2` + `objc2-app-kit` + `objc2-foundation`. A compile-time subclass `LucodeAccessibleApplication : NSApplication` (via `define_class!`) is used only as a well-typed source for IMPs/type-encodings; at runtime the three IMPs are added onto NSApp's live class (`TaoApp`) via `class_addMethod` — tao's own `sendEvent:` override for Cmd+keyUp delivery stays in the dispatch chain.
- Install runs from Tauri's `.setup()` callback (after `[TaoApp sharedApplication]` has bound NSApp), not from early `main()`. The self-directed `AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", true)` call that follows returns `0` (was `-25208`), eagerly activating the AX tree without needing the external AX client to set it first.
- Approach mirrors Electron's `AtomApplication` override pattern (`electron/electron#38102`) adapted for stock `tao` / wry.
- Complements the April 14 per-surface ARIA hardening on `MarkdownEditor` and the xterm helper `<textarea>`; those remain useful once the AX tree is actually live.
- Covered by a live-NSApp integration test that asserts the three selectors on the live `NSApp` instance advertise the attribute, report it settable, and round-trip via `accessibilitySetValue:forAttribute:` / `accessibilityAttributeValue:` (inspired by the sibling branch's contract test).

## Contextual action: one-click issue → spec with auto-clarify

Forge issues can now be turned into a spec whose clarification agent is already investigating, in a single gesture. A new `spec-clarify` `ContextualActionMode` is available alongside `spec` and `session`: selecting an action with this mode from the issue detail view's Actions dropdown creates the spec (preserving `issueNumber` / `issueUrl`), spawns the spec clarification PTY in the background, and submits the clarification prompt automatically once the agent is ready. The user stays on the issue view; the new spec surfaces in the sidebar with the existing `clarification_started` indicator lit.

- Frontend-only orchestration via `src/hooks/contextualSpecClarify.ts` chains the existing `SchaltwerkCoreCreateSpecSession`, `startSpecOrchestratorTop`, and `SchaltwerkCoreSubmitSpecClarificationPrompt` — no new backend commands.
- The helper uses the backend-returned `Session.name` and `Session.id` for subsequent calls, so name collisions (`find_unique_session_paths` rename) do not break the chain, and the terminal ID matches the one `SpecEditor` later derives so opening the spec rebinds to the running PTY rather than respawning.
- Errors during orchestrator start or prompt submission surface as an error toast; the partially-created spec remains in the sidebar so the user can open it and click Clarify manually to retry.
- `ContextualActionMode` enum extended on both sides; serde `rename_all` switched to `kebab-case` (`"spec"` / `"session"` unchanged, `"spec-clarify"` added).

## Per-project agent plugin toggles (Claude terminal hooks)

Lucode no longer injects its Claude terminal-signal hooks into each worktree's `.claude/settings.local.json`. The hook definitions now live in a bundled Claude Code plugin under `plugins/lucode-plugins/lucode-terminal-hooks/`, which Lucode installs once to `~/.claude/plugins/lucode-plugins/` on startup. Per-project enablement is written to `.claude/settings.json` as `"enabledPlugins": { "lucode-terminal-hooks@lucode-plugins": true }`.

- New DB column `project_config.agent_plugins_json` and struct `AgentPluginConfig { claudeLucodeTerminalHooks: bool }`, default `true`, with Tauri commands `get_project_agent_plugin_config` / `set_project_agent_plugin_config`.
- New UI panel in `SettingsModal` (under Agents → Claude) lists "Lucode terminal hooks" with a per-project enable checkbox; toggling writes to the project root and every existing worktree's `.claude/settings.json`.
- Bootstrap runs a migration: if `.claude/settings.local.json` contains legacy `lucode:waiting_for_input:*` hook entries, those are removed (file deleted when empty) and the plugin enable flag is written to `.claude/settings.json`. Fresh worktrees without legacy entries are untouched, keeping `git status` clean.
- The same migration runs against the main project root on project open, so the user's own checkout also gets cleaned once without needing to spawn a new worktree.
- Plugin `hooks.json` also clears the waiting-for-input signal on `SessionStart`, so resuming a Claude session never leaves a stale waiting badge.
- `ensure_lucode_claude_hooks`, `merge_claude_settings_local`, and the per-worktree `.claude/settings.local.json` git-exclude code were removed.

## Sidebar: Consolidation action feedback

Every consolidation action button in `SessionVersionGroup` now gives immediate busy feedback and blocks concurrent clicks:

- Clicking "Consolidate versions", the consolidation judge trigger, either confirm-winner button (header or judge banner), or the group terminate-all button shows an inline spinner over the button icon for the full duration of the triggered work.
- While any action in a consolidation group is in flight, every other action button in that group is disabled, so the same action can't be double-triggered and collisions between actions are prevented. Success and failure are still surfaced via the existing toast system.
- `onTriggerConsolidationJudge` / `onConfirmConsolidationWinner` in `Sidebar` now return their backend promise so the group can await the real request; the modal-opening callbacks resolve immediately because the subsequent UX lives in their respective modals.

## MarkdownEditor: Dictation / Voice Control accessibility

`MarkdownEditor` now exposes the underlying CodeMirror contenteditable as a standard multiline textbox so macOS dictation, Voice Control, and screen readers can target it as a text input:

- The shared editor sets `role="textbox"`, `aria-multiline="true"`, `aria-label` (or `aria-labelledby`), and `aria-readonly` (when read-only) on `.cm-content` via `EditorView.contentAttributes`.
- New `ariaLabel` and `ariaLabelledBy` props are threaded through every caller (`NewSessionModal` prompt, `SpecEditor`, `SpecContentView`, `SettingsModal` setup script); the label falls back to the placeholder text when none is supplied.
- Accessible names for spec editors and the setup script are translated through the i18n layer (`en` / `zh`).
- Editing semantics, paste guard, file-reference autocomplete, and keybindings are unchanged — the fix is purely additive ARIA.

## Reorderable Raw Agents in Start New Agent Modal

Raw agents (Claude, Copilot, OpenCode, Gemini, Codex, Droid, Qwen, Amp, KiloCode, Terminal) in the `NewSessionModal` can now be reordered from **Settings → Agent Configuration → Raw Agent Order**. The reorder list shows only *enabled* agents; disabled agents never appear in the modal anyway.

- Persisted globally as `raw_agent_order: Vec<String>` in the main settings file, alongside `favorite_order`.
- Surfaced via new Tauri commands `get_raw_agent_order` / `set_raw_agent_order`, a Jotai atom (`rawAgentOrder`), and the `useRawAgentOrder` hook.
- `buildFavoriteOptions` orders the raw-agent slice by the saved order, then falls back to the `AGENT_TYPES` default for any agent not yet in the saved order. Unknown or duplicate entries are filtered at compose time.
- Spec stays pinned first and presets keep their existing independent ordering.
- `⌘1`–`⌘9` continue to follow composed-list position, so reordering raw agents directly shifts which agent owns which shortcut.

## Spec Preview: Dedicated Run Button

The spec preview toolbar now cleanly separates clarification from execution:

- **Clarify** is no longer styled as the green run/start action. It uses the neutral secondary-toolbar treatment and keeps the clarification prompt flow unchanged.
- **Run** is a new green toolbar button that opens the same Start Agent modal used by the sidebar and the empty-spec state via `UiEvent.StartAgentFromSpec`.
- Pending spec edits are flushed before Run opens the modal so the prefilled content stays in sync.
- The `Mod+Enter` shortcut now triggers Run in the preview, while `Mod+Shift+R` remains the clarification shortcut.

## New Session Modal Primary Surface Rebuild

`NewSessionModal` was trimmed from ~2.5k lines to a focused primary creation flow that matches the `New Session Modal View` mockup in `design/style-guide.pen`.

- Primary surface owns: name input (with auto-generation from prompt), one horizontally scrollable favorites row (`Spec only` → user presets → enabled raw agents filtered by `useEnabledAgents` + `useAgentAvailability`), markdown prompt, footer with version selector, Cancel, Create, and a `Custom settings…` toggle.
- Version selector is enabled only when a raw-agent card is selected; spec and preset cards force the implicit version count.
- `⌘1…⌘9` select the first nine favorite cards (badge labels match). `⌘Enter` submits.
- Advanced controls (autonomy toggle, multi-agent allocation dropdown, link to agent defaults in Settings) moved behind a `Custom settings…` affordance. The primary modal no longer renders epic selectors, GitHub issue/PR cards, consolidation controls, base-branch picker, unified-search, or repository-empty banners.
- `onCreate` payload contract is unchanged so `App.handleCreateSession` keeps working.
- Prefill via `UiEvent.NewSessionPrefill` updates the name / prompt / favorite selection that the primary surface owns, and passes through metadata it doesn't render (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `epicId`, `versionGroupId`, and consolidation fields) so existing callers — consolidation entry, contextual PR/issue actions — stay wired end-to-end.

Supporting helpers introduced: `src/components/modals/newSession/favoriteOptions.ts`, `buildCreatePayload.ts`, and `NewSessionAdvancedPanel.tsx`, each covered by unit tests.

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
