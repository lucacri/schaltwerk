# Action Prompt Templates — Design

## Problem

Post-spec-start actions compose their prompts ad hoc and can mutate `spec.content` as a side effect:

- **Consolidation confirm-winner** (plan round) writes the winning plan into `spec.content` via `write_implementation_plan_section` (`src-tauri/src/mcp_api.rs:7646`).
- **Plan candidate** spawn builds `build_plan_candidate_prompt(spec)` inline (`src-tauri/src/mcp_api.rs:5588`).
- **Judge** trigger builds `build_judge_prompt(...)` inline (`src-tauri/src/mcp_api.rs:1388`).
- **Force restart** prepends a preamble via `build_force_restart_prompt` (`src-tauri/src/domains/sessions/service.rs:124`).
- **Full Autonomous** bakes the autonomy template into `session.initial_prompt` at session creation (`src-tauri/src/commands/schaltwerk_core.rs:1898`).

Only the autonomy template is user-editable today.

## Goals

1. `spec.content` is the source of truth; no post-start action mutates it.
2. Each action owns a user-editable instruction template with `{BASE_SPEC_CONTENT}` (and other named) placeholders.
3. Placeholders are substituted at composition time; the plan-round output goes to an action-owned artifact (new `Spec.implementation_plan` column), not back into `spec.content`.

## Non-Goals

- Clarify (pre-running) flow stays as-is.
- Manual `lucode_draft_update` stays as-is.
- Moving autonomy-template expansion to launch time (kept at creation for now — YAGNI).
- Re-deriving plan-candidate prompts at every launch time (kept at creation).

## Approach

### Placeholder syntax

`{BASE_SPEC_CONTENT}` — single-brace, uppercase. Consistent with existing `{sessionList}`, `{branch}` conventions; uppercase distinguishes the new first-class variables.

### New backend module

`src-tauri/src/domains/sessions/action_prompts.rs`:

- `pub fn render_action_prompt(template: &str, vars: &[(&str, &str)]) -> String` — replaces `{KEY}` for each pair. Unknown placeholders are left as-is (forward compatibility). Test-covered.
- `pub fn render_plan_candidate_prompt(template: &str, spec: &Spec) -> String`
- `pub fn render_judge_prompt(template: &str, candidate_sessions: &[Session], source_session_ids: &[String], round_type: &str) -> String`
- `pub fn render_force_restart_prompt(template: &str, base_prompt: &str) -> Option<String>` (called only when preamble is needed)

Each wrapper prepares the variable list (pre-formatted multi-line blocks for judge's candidate/source listing) and delegates to `render_action_prompt`.

### Settings additions

Extend `GenerationSettings` (`src-tauri/src/domains/settings/types.rs:250`) with three `Option<String>` fields:

- `force_restart_prompt_template`
- `plan_candidate_prompt_template`
- `judge_prompt_template`

Add defaults in `src-tauri/src/domains/settings/defaults.rs`:

- `default_force_restart_prompt_template()` — current preamble text, `{BASE_SPEC_CONTENT}` where the initial prompt is spliced in.
- `default_plan_candidate_prompt_template()` — current plan candidate instruction + `{BASE_SPEC_CONTENT}` + `{SPEC_ID}`.
- `default_judge_prompt_template()` — parameterized with `{ROUND_TYPE_NOUN}`, `{SOURCE_SESSIONS_BLOCK}`, `{CANDIDATES_BLOCK}`, `{RECOMMENDED_ACTION}` (and supports both `plan` and `consolidation` round types).

Settings service resolves `.unwrap_or_else(default_X)` at read time (same pattern as `autonomy_prompt_template`).

### Call-site refactors

1. **`build_plan_candidate_prompt`** — replace body with settings fetch + `render_plan_candidate_prompt`. Call site at `mcp_api.rs:5690` reads settings manager.
2. **`build_judge_prompt`** — replace with settings fetch + `render_judge_prompt`. Two call sites: judge trigger and auto-trigger when all candidates report.
3. **`build_force_restart_prompt`** — replace body with settings fetch + `render_force_restart_prompt`. Settings must flow to `service.rs` through the launch path. Add a `force_restart_prompt_template` field to `AgentLaunchParams` (or fetch in the Tauri command layer and pass in). Chosen: fetch in `schaltwerk_core.rs` launch command and thread through `AgentLaunchParams`.
4. **Confirm-winner mutation removal** — replace `write_implementation_plan_section` + `update_spec_content` with `update_spec_implementation_plan(&spec.id, plan)`. Keep `update_spec_improve_plan_round_id(id, None)` for now.

### Database migration

Add `implementation_plan TEXT` column to `specs` table. Migration is additive and non-destructive.

Update:
- `Spec` entity (`entity.rs:131`).
- Row mappers in `db_sessions.rs`.
- Add `SessionDbManager::update_spec_implementation_plan(spec_id, plan)`.
- Serialization (Spec → JSON) exposes new field to frontend.

### Frontend changes

1. **SettingsModal** (`src/components/modals/SettingsModal.tsx`): three new templated textareas alongside the autonomy template, each with a "Reset to default" button. Mirror the autonomy template's structure.
2. **i18n** (`src/locales/en.json`): new keys under `settings.agentConfiguration` for each template (label, description, hint) and a matching `de.json` entry (mirror pattern).
3. **saveGenerationSettings**: thread through the three new fields.
4. **Spec view**: render `spec.implementation_plan` beneath `spec.content` when present. Existing Markdown renderer handles it; add a section divider/heading so users see the plan distinctly.
5. Legacy specs that already have `## Implementation Plan` inside `spec.content` remain rendered by the existing markdown path; no migration of spec content is required.

### Test plan (TDD-first)

**Rust unit tests** (add before implementation):

- `render_action_prompt_substitutes_single_placeholder`
- `render_action_prompt_substitutes_multiple_placeholders`
- `render_action_prompt_leaves_unknown_placeholders_untouched`
- `render_action_prompt_does_not_recursively_substitute` (value containing `{KEY}` is not re-expanded)
- `render_plan_candidate_prompt_uses_default_template_when_settings_empty`
- `render_plan_candidate_prompt_substitutes_spec_content_and_id`
- `render_judge_prompt_renders_plan_round_flavor`
- `render_judge_prompt_renders_consolidation_round_flavor`
- `render_judge_prompt_marks_auto_stub_reports`
- `render_force_restart_prompt_returns_none_when_no_preamble_needed` (unchanged behavior)
- `render_force_restart_prompt_substitutes_base_prompt_into_template`
- `confirm_winner_for_plan_round_writes_implementation_plan_and_preserves_spec_content`
- `default_action_prompt_templates_contain_required_placeholders`

**Settings tests**:

- `generation_settings_round_trips_new_template_fields`
- `default_force_restart_prompt_template_contains_base_spec_content`

**Frontend tests** (vitest):

- `SettingsModal renders force/plan/judge template textareas with defaults`
- `SettingsModal Reset button restores default`
- `saveGenerationSettings passes new template fields to Tauri command`

### Behaviour summary after change

| Action | Before | After |
| --- | --- | --- |
| Plan candidate spawn | Hardcoded prompt built in Rust | User template + placeholder substitution; spec.content unchanged |
| Judge trigger | Hardcoded prompt built in Rust | User template + candidate/source blocks |
| Force restart | Hardcoded preamble prepended | User template + `{BASE_SPEC_CONTENT}` (= prior initial_prompt) |
| Confirm-winner (plan round) | Writes plan into `spec.content` | Writes plan into new `spec.implementation_plan` column |
| Full Autonomous (unchanged) | Template appended at creation, stored in initial_prompt | Same |
| Clarify (unchanged) | Rust-composed prompt at clarification start | Same |

## Approaches considered

1. **Full template engine (tera/handlebars)** — overkill for four templates. Rejected.
2. **Unified `ActionTemplate` trait + registry** — cleaner long term but requires a larger refactor (session metadata to store action-type + context). Rejected for v1.
3. **Per-action template fields in `GenerationSettings` + simple `replace` substitution** — minimum-viable change, matches the existing `autonomy_prompt_template` pattern. **Chosen.**

## Risks & mitigations

- **DB migration failure** — migration adds a nullable column; idempotent `ALTER TABLE ... ADD COLUMN` gated on `PRAGMA table_info` (matches existing migration pattern).
- **User edits a template into something broken (e.g., deletes `{BASE_SPEC_CONTENT}`)** — accept as user's choice; render as-is. No runtime validation beyond making sure substitution doesn't panic.
- **Legacy specs carrying `## Implementation Plan` in `spec.content`** — leave intact; the new column is additive, and the rendered spec view will simply show both the old in-content plan and any new column-based plan. Future pass can migrate content-based plans into the column.
