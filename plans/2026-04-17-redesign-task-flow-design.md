# Redesign Task Flow Design

## Context

Specs are already the durable planning rows. Running sessions are child worktrees with optional version grouping and existing consolidation metadata. The current consolidation round table is implementation-oriented, but its source sessions, candidate/judge roles, reports, recommendation, and confirmation status map directly to the proposed Improve Plan round.

PR/MR links already exist on sessions through `pr_number` and `pr_url`. The missing part is a persisted lifecycle value that can change independently from local merge state.

## Approach

Use the existing structures with additive metadata:

- Add `round_type` to `consolidation_rounds`, defaulting to `implementation`.
- Add `improve_plan_round_id` to `specs` so a clarified spec can point at its current plan round.
- Add `pr_state` to `sessions` with values `open`, `succeeding`, and `mred`.

Plan candidates are ordinary consolidation candidate sessions with worktrees so agents can inspect the repo. Their durable output is their `consolidation_report`; no code diff is required. Judge sessions are also ordinary consolidation judge sessions, but the judge prompt asks for an implementation plan and a recommended candidate. Confirming a plan round updates only the `## Implementation Plan` section of the linked spec and marks the round promoted. Existing implementation promotion semantics stay unchanged for `round_type = implementation`.

PR state is updated when PR/MR metadata is linked, unlinked, created, or refreshed through forge detail commands. `Stage::Merged` remains local-only and is not used to infer forge state.

## Data Flow

Improve Plan:

1. User or MCP starts an Improve Plan round from a clarified spec.
2. Backend creates candidate sessions with `round_type = plan` on the shared round row and stores the round id on the spec.
3. Candidates file markdown reports.
4. Judge recommends a candidate.
5. Confirm writes the chosen plan into the spec's `## Implementation Plan` section and promotes the round status without running code promotion.

PR state:

1. Creating or linking a PR/MR sets `pr_state = open`.
2. Fetching forge details maps merged remote state to `mred`.
3. If open and CI is green, state becomes `succeeding`.
4. If a later refresh sees open/non-green, state returns to `open`.
5. Unlinking clears `pr_state`.

## UI

Expose `pr_state` on `SessionInfo` and TypeScript session types. Existing session cards already render PR metadata badges; add a compact state label next to the PR link so local stage and remote PR state are visible together without changing the stage enum.

## Testing

Backend tests cover schema persistence, plan-section replacement, plan-round confirmation, and PR state transitions. Frontend tests cover derived session comparison and the visible PR-state badge.
