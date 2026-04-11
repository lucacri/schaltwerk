# Waiting For Input Design

## Problem

Lucode currently treats all top-terminal inactivity the same. After 5 seconds with no byte activity and no visible screen changes, the idle detector marks the session as needing attention. That same signal is also used when an agent is done or stalled, so users cannot tell whether the agent is asking them a question, has finished, or is simply idle.

## Goal

Introduce a first-class `waiting_for_input` attention kind that is distinct from idle, is driven only by documented agent mechanisms, and renders with a visibly different UI treatment from the current idle badge.

## Supported Mechanisms

1. Claude Code
Uses Claude Code hooks in `.claude/settings.local.json`, specifically documented `Notification` events such as `idle_prompt`, `permission_prompt`, and `elicitation_dialog`, plus `UserPromptSubmit` and `Stop` to clear the state.

2. Gemini
Uses Gemini CLI's documented run-event notifications and documented dynamic window title status updates. Gemini emits explicit "needs your attention" notifications and `✋ Action Required` title updates, which Lucode can consume as structured terminal control-sequence signals instead of terminal text heuristics.

3. Codex
No documented hook or event currently distinguishes "waiting for user input" from normal turn completion, so Codex keeps existing idle behavior.

4. OpenCode
OpenCode exposes documented config and server APIs, but no documented waiting-for-input event specific enough for this feature was found. OpenCode keeps existing idle behavior.

## Architecture

### Shared attention model

- Keep `attention_required` as the aggregate boolean used by existing counts and attention notifications.
- Add `attention_kind` with values:
  - `idle`
  - `waiting_for_input`
- `attention_required = true` with `attention_kind = waiting_for_input` means the agent is blocked on the user, not merely idle.

### Backend flow

- Extend the runtime attention registry from `session_id -> bool` to `session_id -> { needs_attention, kind }`.
- Extend `TerminalAttention` events to include `attention_kind`.
- Idle detection continues to emit `idle`, but it must not overwrite an active `waiting_for_input` state.
- Agent-specific detectors emit `waiting_for_input` immediately from explicit documented signals and emit `None` when those agents resume.

### Terminal signal handling

- Extend terminal control-sequence sanitization to surface parsed OSC notifications and OSC window-title updates alongside sanitized terminal data.
- Add a thin per-terminal attention detector configured by agent type.
- Gemini detection reads explicit OSC 9 notification payloads and `OSC 0/2` title updates.
- Claude detection reads Lucode-owned hook-emitted OSC signals written directly to the terminal by Claude hooks.

### Claude hook wiring

- At Claude launch time, Lucode ensures a repo-local `.claude/settings.local.json` exists with Lucode hook entries merged in.
- Lucode also ensures the generated local settings file is ignored in the worktree's local git exclude file so user repos stay clean.
- The Lucode hook commands write deterministic OSC messages to `/dev/tty` for:
  - waiting-for-input entered
  - waiting-for-input cleared

### UI

- Add `attention_kind` to frontend session types.
- Treat `waiting_for_input` as a separate visual state from idle.
- Update sidebar cards and collapsed rail indicators to show a distinct waiting badge/label for running sessions.
- Leave aggregate counts based on `attention_required` unchanged.

## Tradeoffs

1. Minimal shared state extension
Recommended. Adds a small discriminator while preserving current attention plumbing and counts.

2. Replace `attention_required` everywhere with an enum
Cleaner long-term, but it is a larger refactor that touches many existing consumers and is unnecessary for this feature.

3. UI-only special casing
Too weak. It would not solve backend hydration, event propagation, or future agent integrations cleanly.

## Testing

- Rust tests for control-sequence extraction and detector transitions.
- Rust tests for runtime attention registry and session hydration with `attention_kind`.
- Frontend atom tests for event payload merge/preservation.
- Sidebar component tests proving waiting-for-input renders differently from idle.
