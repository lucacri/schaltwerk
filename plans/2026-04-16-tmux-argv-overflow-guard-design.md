# Design: Fail-fast guard for oversized agent argv before tmux launch

## Problem

When an agent session carries a very large `initial_prompt`, the prompt is shell-escaped and inlined into the argv that tmux hands to `execve`. Once the total exceeds the OS `ARG_MAX` ceiling (~1 MiB on macOS), tmux returns status 1 with stderr "command too long" and the failure currently surfaces as an unhandled promise rejection on the frontend.

The failure path is the same for every agent that embeds the prompt as argv (Claude, Codex, Gemini, OpenCode, Amp-pipe, Kilocode, Qwen) and the same for both first launch and `force_restart=true` — they all funnel through `new_session_detached` in `src-tauri/src/domains/terminal/tmux_cmd.rs`.

## Goal

Detect the oversize condition *before* invoking tmux and fail fast with a clear, user-facing error that identifies Lucode as the guard, names the measured argv byte count, and names the threshold. No temp-file, stdin, or send-keys fallback — the user wants telemetry on real-world frequency before committing to a delivery-mechanism change.

## Decision: one guard at the tmux-cmd layer

All seven inlining agents and both launch paths converge on `TmuxCli::new_session_detached`. A byte-length check there catches every case with a single implementation:

- **Location:** `new_session_detached` default-impl in the `TmuxCli` trait, executed *before* the `self.run(&arg_refs)` call.
- **What we measure:** sum of byte lengths of every argv we're about to hand tmux: `["new-session", "-d", "-s", name, "-x", cols, "-y", rows, "-c", cwd, "-e", "K=V", …, "--", command, args…]`. We do NOT enumerate the parent process's envp; we leave a large safety margin instead.
- **Threshold:** 500_000 bytes. macOS `ARG_MAX` is 1_048_576, Linux is typically 128KB–2MB. 500KB leaves ≥500KB of headroom for the inherited envp and `tmux -L <socket> -f <conf>` globals the cli prepends in `SystemTmuxCli::run`. Well above any legitimate prompt.
- **Failure mode:** return `Err(String)` with a message identifying Lucode, the measured size, and the limit. The caller (`TmuxAdapter::create_with_size`) already propagates this back through `create_terminal_with_app_and_size` → `schaltwerk_core_start_agent_in_terminal`, which already calls `inject_terminal_error` on failure and returns the error to the frontend.

## What this does NOT do

- **No non-argv delivery.** We are explicitly not adding temp-file, stdin, or send-keys paths. The spec calls this out.
- **No splitting / truncation / summarizing** of the prompt.
- **No platform-conditional limit.** One constant, documented reasoning.
- **No change to Droid.** Already uses session files, not argv.

## Error message shape

`"Lucode preflight: agent argv is {actual} bytes, which exceeds Lucode's {limit}-byte safety limit for tmux/execve. The initial prompt is too large to inline as a command-line argument. Shorten the prompt (or the session spec) and relaunch."`

This message:
- Identifies Lucode as the source so users don't hunt tmux bugs
- Names the measured size (useful for the telemetry-gathering goal)
- Names the limit so the threshold is discoverable
- Tells the user what to do

The existing `inject_terminal_error` path renders this inside the agent pane instead of vanishing as an unhandled rejection.

## Testing

Unit tests live in the existing `tmux_cmd.rs` test module (which already has `MockTmuxCli` infrastructure):

1. `new_session_detached_rejects_oversize_argv_without_calling_tmux` — build an `ApplicationSpec` whose single arg exceeds the limit, assert Err, assert the mock recorded zero calls.
2. `new_session_detached_error_message_identifies_lucode_and_sizes` — assert the error contains `"Lucode"`, the actual byte count, and the limit.
3. `new_session_detached_counts_env_bytes_toward_argv_limit` — build a spec whose prompt is just under the limit but whose `-e KEY=VAL` entries push it over. Assert Err.
4. `new_session_detached_accepts_normal_prompt` — a realistic 8KB prompt goes through and the tmux mock is called exactly once.

No new integration test is needed: the end-to-end restart path is covered by existing session-manager tests, and the unit-level guard is the contract.

## Files touched

- `src-tauri/src/domains/terminal/tmux_cmd.rs` — add the constant, the check helper, wire it into `new_session_detached`, add tests.
- `CHANGES.md` — new entry under "Changes from Upstream".

That's it. No signatures change, no callers need edits.
