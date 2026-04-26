# OpenCode Startup Prompt Auto-Submit — Design

**Problem.** When starting (or resuming) an OpenCode agent with an initial prompt, the prompt is pasted into the OpenCode TUI input but is not always submitted, forcing the user to manually press Enter.

## Root Cause

Two layers of inconsistency in the queued startup-command path:

1. `submission_options_for_agent` in `domains/terminal/submission.rs` falls through OpenCode to the default branch `(true, false)` (bracketed paste + immediate carriage return). The frontend (`src/common/terminalPaste.ts` + `TUI_BASED_AGENTS`) already treats OpenCode like Kilocode — bracketed paste **with delayed submit** — so the two paths disagree.

2. `maybe_dispatch_initial_command` in `domains/terminal/local.rs` writes the queued prompt with hardcoded `build_submission_payload(command, true, false)`, ignoring agent-specific submission semantics entirely.

3. OpenCode readiness was inferred from a fixed 1500 ms timer rather than terminal output, so the submit keystroke could be sent before the TUI had finished rendering its input box.

Result for resumed OpenCode sessions (the only path that actually queues an initial command, since fresh OpenCode launches inject the prompt via `--prompt`):

```
\x1b[200~PROMPT\x1b[201~\r
```

The `\r` immediately after `\x1b[201~` is unreliable for TUIs — OpenCode often interprets it as part of the paste rather than as a submit keypress, so the prompt sits in the input box.

A 2-second `schedule_enter_replay` safety net exists, but it waits for shell-prompt detection (`$ `, `% `, `❯ `) which never appears in OpenCode's TUI, so we always wait the full timeout. Even then, by 2 s the second `\r` is sometimes processed against TUI state where the input has lost focus or otherwise no-ops.

## Options Considered

### Option 1 — Increase the OpenCode timer

Raise the fixed delay from 1500 ms to a larger number.

- Pros: small change.
- Cons: still timing-based; slower in the healthy path; still brittle across machines and OpenCode versions.

### Option 2 — Add an OpenCode ready marker only

Wait for a stable OpenCode output fragment before dispatching the queued prompt.

- Pros: addresses the readiness race.
- Cons: the queued path would still ignore agent-specific submission behavior; a marker-only design hangs forever if the marker text drifts in a future OpenCode release unless paired with a fallback deadline.

### Option 3 — Marker-aware dispatch + agent-aware submission + deadline fallback

Carry submission options into `queue_initial_command`, let queued dispatch use the same agent-specific submission rules as follow-up submissions, declare an OpenCode ready marker in the agent manifest, and let ready-marker dispatch fall back to a deadline if the marker never appears.

- Pros: fixes the generic startup path instead of special-casing a symptom; reuses the existing submission model; gives OpenCode deterministic readiness gating without removing fallback safety.
- Cons: touches the terminal backend interface and tests.

**Recommendation:** Option 3.

## Implementation Outline

1. Extend `InitialCommandState` so it stores the chosen submission flags (`use_bracketed_paste`, `needs_delayed_submit`), the `dispatch_delay`, and a `dispatch_in_progress` claim flag that prevents double-dispatch when concurrent output chunks both satisfy the marker condition.
2. Plumb `(use_bracketed_paste, needs_delayed_submit)` through the `TerminalBackend::queue_initial_command` API alongside the existing `ready_marker` and `dispatch_delay` arguments.
3. Compute the queue policy in one place via `initial_command_queue_policy(agent_type, manifest_key)` in `commands/schaltwerk_core.rs`, combining manifest-declared `auto_send_initial_command`/`ready_marker` with the agent's `submission_options_for_agent` choice.
4. In `maybe_dispatch_initial_command`, dispatch when **either** the marker matches **or** the configured deadline elapses. Spawn a tokio task at queue time (or after terminal creation, via `activate_initial_command_dispatch`) that fires once the deadline is reached so the deadline branch isn't dependent on incoming output.
5. After the bracketed paste is written, schedule a 10 ms-delayed `\r` write via `schedule_delayed_submit` when `needs_delayed_submit` is true. This mirrors `paste_and_submit_terminal` and avoids gluing the submit CR to the closing `\x1b[201~`.
6. Add `ready_marker = "? for shortcuts"` to OpenCode in `agents_manifest.toml` so the startup path waits for the TUI hint line before dispatching.
7. Keep a `dispatch_delay` of 5 s for OpenCode as the marker-fallback safety net. Faster machines hit the marker far sooner; slower machines or future OpenCode releases that retitle the hint line still get the prompt submitted.
8. Add `submission_options_for_agent("opencode") => (true, true)` so any code path (queue, follow-up paste) treats OpenCode consistently.

## Tests

- Unit: `submission_options_for_agent("opencode")` returns `(true, true)`.
- Unit: `initial_command_queue_policy("opencode", "opencode")` returns the manifest marker plus the 5 s fallback deadline and the bracketed-paste-without-delayed-CR submission flags.
- Unit: `maybe_dispatch_initial_command` skips when `dispatch_in_progress` is already set.
- Unit: a failed write resets the dispatch claim so the next chunk can retry.
- Integration: queue + create + ready marker dispatches the command.
- Integration: queue + create with a marker that never appears still dispatches after the fallback deadline.
- Integration: queue **before** create works (pre-creation state is preserved and dispatched once the terminal exists and the marker fires).
- Existing `test_queue_initial_command_dispatches_after_delay_without_output` continues to pass with the new signature.

## Non-Changes (Deliberate)

- We do **not** change the frontend; `terminalPaste.ts` is already correct.
- We do **not** alter Copilot / Kilocode dispatch delays.
- We do **not** remove `schedule_enter_replay`. It is still load-bearing for non-TUI agents like Copilot.

## Risks

- TUI agents other than OpenCode (Copilot in particular) still use `(true, false)` and the immediate-CR path, so this change does not regress them.
- The 10 ms delayed submit adds ~10 ms to the cold-start time on resume, which is imperceptible.
- The 5 s OpenCode fallback is bounded — even on a worst-case marker drift, the user only waits 5 s before the prompt fires.
