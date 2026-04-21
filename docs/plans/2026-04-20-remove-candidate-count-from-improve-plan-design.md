# Remove `candidate_count` from Improve Plan API

## Problem

`candidate_count` is a legacy Improve Plan knob (default 2, clamp 1..6) that only means "spawn N copies of the same agent". Today every caller that reaches the Tauri command omits it (UI hook sends `{ name }` only), and the spec roadmap replaces the knob with presets (N-slot preset where slots may duplicate the same agent). Keeping `candidate_count` on the surface adds a branch that must stay in sync with the eventual preset path, leaves the MCP tool schema advertising a parameter that will silently conflict with preset resolution, and hides the single-candidate default behind an implicit `unwrap_or(2)`.

## Context

- Prereq spec `fix-improve-plan-multiagent-and-label` (adds `preset` to `StartImprovePlanRoundParams` + global default Improve Plan preset) has **not** landed in this worktree. The struct has no `preset` field today and the UI calls `SchaltwerkCoreStartImprovePlanRound` with name only (src/hooks/useImprovePlanAction.ts:41-43).
- The spec's decision branch for "no preset resolvable" is: produce **one** candidate. That's the only branch implementable today and the only one this change is committing to.
- Tests at src-tauri/src/mcp_api.rs:4823 and 4865 pin `candidate_count: Some(1)` and `Some(2)` respectively; they need to move off the field.

## Goals

1. Delete `candidate_count` from:
   - `ImprovePlanRoundRequest` HTTP body (src-tauri/src/mcp_api.rs:6471).
   - `StartImprovePlanRoundParams` (mcp_api.rs:6480) and its `From` impl (mcp_api.rs:6489).
   - `schaltwerk_core_start_improve_plan_round` Tauri command (commands/schaltwerk_core.rs:2067,2076).
   - MCP bridge options object (mcp-server/src/lucode-bridge.ts:1481) and wire body (1495).
   - MCP tool args type (mcp-server/src/lucode-mcp-server.ts:75), JSON schema (685), and forwarding (1245).
2. Replace the `0..candidate_count` loop in `create_improve_plan_round_start_context` (mcp_api.rs:6651) with a single-iteration block that creates exactly one candidate with `version_number = 1` and `params.agent_type`. The function already receives `params: &StartImprovePlanRoundParams`, so only the loop changes.
3. Update all tests to drop the field. Replace the "launch of v2 fails, v1 rolls back" test (mcp_api.rs:4851) with a semantically equivalent "the single candidate's launch fails and rolls back the round+stub+spec-link" test, since we no longer support 2 candidates without a preset.
4. Leave `action_prompts.rs`'s local `candidate_count` template variable (lines 107, 111, 347) untouched — it's a render-time count of synthesis candidates, unrelated to this field.

## Non-Goals

- Preset integration (that's the prereq spec).
- Judge flow, round state machine, session naming.
- Deprecation window. Per the user's solo-macOS memory, this is a hard removal — unknown JSON fields on the HTTP body will be dropped by serde (the struct isn't `deny_unknown_fields`), and the MCP tool schema doesn't set `additionalProperties: false`, so stale callers degrade gracefully to "no candidate_count = single candidate".

## Design

### Rust — `create_improve_plan_round_start_context`

Replace

```rust
let candidate_count = params.candidate_count.unwrap_or(2).clamp(1, 6);
...
for index in 0..candidate_count {
    let session_name = format!("{}-plan-{}-v{}", spec.name, round_slug, index + 1);
    match manager.create_session_with_agent(SessionCreationParams {
        ...
        version_number: Some((index + 1) as i32),
        ...
    }) { ... }
}
```

with a single-candidate block:

```rust
let session_name = format!("{}-plan-{}-v1", spec.name, round_slug);
match manager.create_session_with_agent(SessionCreationParams {
    ...
    version_number: Some(1),
    ...
}) { Ok(session) => { /* push */ }, Err(err) => { /* same failure envelope */ } }
```

No change to the rollback path, version_group_id, consolidation round metadata, or launch-then-rollback ordering.

### Tests (Rust)

- `create_improve_plan_round_start_context_produces_single_candidate_today` — new targeted unit test invoking `create_improve_plan_round_start_context` directly against an in-memory manager. Asserts `candidate_sessions.len() == 1`, name ends `-v1`, and `version_number` is 1. Fails on today's code because the loop runs twice for the default.
- `start_improve_plan_round_respects_read_lock_during_launch` (mcp_api.rs:4823) — drop the `candidate_count: Some(1)` field, expect it still passes one candidate.
- `start_improve_plan_round_rolls_back_all_state_when_candidate_launch_fails` (mcp_api.rs:4851) — rework to force the *single* launch to fail; assert rollback wipes spec link, round, and session. The old "launch 2, fail v2" scenario disappears.

### Tests (TypeScript)

- `bridge-methods.test.ts:365-380` — remove `candidateCount` from the options literal and `candidate_count` from the expected body.
- `tool-handlers.test.ts:385-399` — remove `candidate_count` from the tool call args and `candidateCount` from the expected bridge call.

### CHANGES.md

Append a short entry under a new "## Improve Plan: remove `candidate_count`" heading, describing the removal and the migration path ("future: use a preset with duplicate slots to spawn N candidates of the same agent").

## Rollout

1. Red test: add the single-candidate assertion.
2. Green: remove the field + loop, update dependent tests.
3. Drop from MCP bridge/tool; update bridge/tool-handler tests.
4. `rg candidate_count` / `rg candidateCount` — verify nothing lingers (except the unrelated `action_prompts.rs` template variable).
5. `just test` green across TS, Rust, MCP.
6. CHANGES.md.
7. Squashed commit.

## Risks

- **Reduced default candidate count.** Current behaviour without an explicit `candidate_count` is 2 candidates; after this change, it's 1. The prereq spec introduces a default preset that restores N candidates. Until then, users running Improve Plan get one candidate per round. This is the stated acceptable new behaviour in the spec's Rollout section.
- **Stale MCP clients.** External callers sending `candidate_count` have it silently ignored (serde drops unknown fields; JSON schema doesn't forbid extras). Acceptable for a single-user app per the solo-macOS memory.
- **Docs drift.** `docs-site/` has no `candidate_count` references — verified — so no doc update needed beyond CHANGES.md.
