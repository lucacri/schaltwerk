# Action Prompt Templates — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move each post-spec-start action's prompt block into a user-editable Settings template with a `{BASE_SPEC_CONTENT}` placeholder, and stop mutating `spec.content` when the plan-round winner is confirmed.

**Architecture:** New shared placeholder renderer (`render_action_prompt_template`) + three per-action wrappers (plan-candidate, judge, force-restart). Each action's template lives in `GenerationSettings` with a default. Confirmed plan content moves from `spec.content` into a new `spec.implementation_plan` column.

**Tech Stack:** Rust (Tauri backend), React/TypeScript (Vitest frontend), SQLite, chezmoi-unrelated. Tests: `cargo nextest`, `vitest`.

---

## Pre-flight

- Working directory: `/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/append-action-specs_v1`
- Branch: `lucode/append-action-specs_v1`
- Design doc: `docs/plans/2026-04-19-action-prompt-templates-design.md`
- Do NOT make intermediate commits — user asked for a squashed commit at the end. Use checkpoint stashes or rely on clean tree.

---

## Task 1 — Shared placeholder renderer (Rust)

**Files:**
- Create: `src-tauri/src/domains/sessions/action_prompts.rs`
- Modify: `src-tauri/src/domains/sessions/mod.rs` (add `pub mod action_prompts;`)

**Step 1: Write failing tests first**

Add to `src-tauri/src/domains/sessions/action_prompts.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::render_action_prompt_template;

    #[test]
    fn substitutes_single_placeholder() {
        let rendered = render_action_prompt_template(
            "Hello {NAME}!",
            &[("NAME", "world")],
        );
        assert_eq!(rendered, "Hello world!");
    }

    #[test]
    fn substitutes_multiple_placeholders() {
        let rendered = render_action_prompt_template(
            "{GREETING}, {NAME}!",
            &[("GREETING", "Hi"), ("NAME", "there")],
        );
        assert_eq!(rendered, "Hi, there!");
    }

    #[test]
    fn leaves_unknown_placeholders_untouched() {
        let rendered = render_action_prompt_template(
            "Known {KNOWN}, unknown {MISSING}",
            &[("KNOWN", "ok")],
        );
        assert_eq!(rendered, "Known ok, unknown {MISSING}");
    }

    #[test]
    fn does_not_recursively_substitute_values_containing_placeholder_tokens() {
        let rendered = render_action_prompt_template(
            "{A} then {B}",
            &[("A", "{B}"), ("B", "final")],
        );
        // "{B}" injected by A must NOT be re-expanded.
        assert_eq!(rendered, "{B} then final");
    }

    #[test]
    fn handles_empty_value() {
        let rendered = render_action_prompt_template(
            "Before{X}After",
            &[("X", "")],
        );
        assert_eq!(rendered, "BeforeAfter");
    }

    #[test]
    fn handles_repeated_placeholder() {
        let rendered = render_action_prompt_template(
            "{X} and {X} again",
            &[("X", "foo")],
        );
        assert_eq!(rendered, "foo and foo again");
    }
}
```

**Step 2: Run tests to confirm failure**

Run: `cd src-tauri && cargo test -p lucode domains::sessions::action_prompts::tests --no-run` → compile error (module missing).

**Step 3: Implement minimal code**

Top of file:

```rust
/// Replace `{KEY}` occurrences in `template` with the values from `vars`.
///
/// - Substitutes all occurrences of each `{KEY}` once.
/// - Non-recursive: already-substituted text is not scanned again.
/// - Unknown placeholders remain untouched.
pub fn render_action_prompt_template(template: &str, vars: &[(&str, &str)]) -> String {
    // Single-pass token scan so injected values are never re-expanded.
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(close_rel) = template[i + 1..].find('}') {
                let key = &template[i + 1..i + 1 + close_rel];
                let is_valid_key = !key.is_empty()
                    && key
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_');
                if is_valid_key {
                    if let Some((_, value)) = vars.iter().find(|(k, _)| *k == key) {
                        out.push_str(value);
                        i += 1 + close_rel + 1;
                        continue;
                    }
                }
            }
        }
        // Push one character (UTF-8 safe — find char boundary).
        let ch = template[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}
```

Also register the module in `mod.rs`:

```rust
pub mod action_prompts;
```

**Step 4: Run tests — PASS**

Run: `cd src-tauri && cargo test -p lucode action_prompts`
Expected: all 6 tests pass.

---

## Task 2 — Default action templates & GenerationSettings fields

**Files:**
- Modify: `src-tauri/src/domains/settings/defaults.rs`
- Modify: `src-tauri/src/domains/settings/types.rs`
- Modify: `src-tauri/src/domains/settings/mod.rs` (re-export new defaults if not already)

**Step 1: Add failing tests**

Append to the existing `#[cfg(test)] mod` in `defaults.rs`:

```rust
#[cfg(test)]
mod action_template_default_tests {
    use super::*;

    #[test]
    fn force_restart_template_contains_base_spec_content_placeholder() {
        assert!(default_force_restart_prompt_template().contains("{BASE_SPEC_CONTENT}"));
    }

    #[test]
    fn plan_candidate_template_contains_required_placeholders() {
        let tmpl = default_plan_candidate_prompt_template();
        assert!(tmpl.contains("{BASE_SPEC_CONTENT}"));
        assert!(tmpl.contains("{SPEC_ID}"));
    }

    #[test]
    fn judge_template_contains_block_placeholders() {
        let tmpl = default_judge_prompt_template();
        assert!(tmpl.contains("{ROUND_TYPE_NOUN}"));
        assert!(tmpl.contains("{SOURCE_SESSIONS_BLOCK}"));
        assert!(tmpl.contains("{CANDIDATES_BLOCK}"));
        assert!(tmpl.contains("{RECOMMENDED_ACTION}"));
    }
}
```

**Step 2: Run tests — FAIL** (functions don't exist yet).

**Step 3: Implement**

Add to `defaults.rs`:

```rust
pub fn default_force_restart_prompt_template() -> String {
    concat!(
        "This is a continuation of prior work in this worktree, not a fresh start.\n",
        "There are already committed and/or uncommitted changes in this worktree. ",
        "Before doing anything else, inspect the current state with git status and ",
        "git diff and continue from what is already there instead of redoing completed work.\n\n",
        "The original spec follows below.\n\n",
        "{BASE_SPEC_CONTENT}",
    )
    .to_string()
}

pub fn default_plan_candidate_prompt_template() -> String {
    concat!(
        "You are preparing an implementation plan for this clarified Lucode spec.\n\n",
        "Inspect the repository as needed. Do not implement code. Write a concise, ",
        "actionable Markdown implementation plan, then call lucode_consolidation_report ",
        "with your plan as report and base_session_id set to '{SPEC_ID}'.\n\n",
        "Spec content:\n\n{BASE_SPEC_CONTENT}",
    )
    .to_string()
}

pub fn default_judge_prompt_template() -> String {
    concat!(
        "Review every {ROUND_TYPE_NOUN} for this Lucode round.\n\n",
        "Source sessions:\n{SOURCE_SESSIONS_BLOCK}\n",
        "Candidates:\n{CANDIDATES_BLOCK}\n",
        "{RECOMMENDED_ACTION}",
    )
    .to_string()
}
```

Extend `GenerationSettings` in `types.rs`:

```rust
#[serde(default)]
pub force_restart_prompt_template: Option<String>,
#[serde(default)]
pub plan_candidate_prompt_template: Option<String>,
#[serde(default)]
pub judge_prompt_template: Option<String>,
```

Update `domains/settings/mod.rs` (or the `pub use` block in `defaults.rs`) so the three new `default_*` functions are reachable as `lucode::domains::settings::default_X_prompt_template()`.

**Step 4: Run tests — PASS**

Run: `cd src-tauri && cargo test -p lucode -- settings::defaults::action_template_default_tests`.

---

## Task 3 — Surface new defaults via Tauri `get_default_generation_prompts`

**Files:**
- Modify: `src-tauri/src/commands/settings.rs:783-807`

**Step 1: Update tests**

There is already a `get_default_generation_prompts_returns_non_empty` test at `settings.rs:1544`. Add a new test:

```rust
#[test]
fn get_default_generation_prompts_includes_action_templates() {
    let d = super::get_default_generation_prompts();
    assert!(d.force_restart_prompt_template.contains("{BASE_SPEC_CONTENT}"));
    assert!(d.plan_candidate_prompt_template.contains("{BASE_SPEC_CONTENT}"));
    assert!(d.judge_prompt_template.contains("{CANDIDATES_BLOCK}"));
}
```

**Step 2: Run — FAIL** (fields missing on struct).

**Step 3: Implement**

Extend `DefaultGenerationPrompts` struct and the returned value with three new string fields wired to the new `default_*` functions.

**Step 4: Run — PASS**.

---

## Task 4 — DB migration: `specs.implementation_plan`

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
  - `CREATE TABLE specs` block (line ~175): add `implementation_plan TEXT,`
  - `apply_specs_migrations` function: add `let _ = conn.execute("ALTER TABLE specs ADD COLUMN implementation_plan TEXT", []);`
  - Extend legacy migration `INSERT` statement to include `NULL` for the new column.
- Modify: `src-tauri/src/domains/sessions/entity.rs:131-149` — add `pub implementation_plan: Option<String>` to `Spec`.
- Modify: `src-tauri/src/infrastructure/database/db_specs.rs` — extend `create_spec`, `get_spec_by_*`, `list_specs`, `row_to_spec` to round-trip the new column; add trait method `update_spec_implementation_plan(&self, id: &str, plan: Option<&str>) -> Result<()>` with impl.
- Modify: `src-tauri/src/domains/sessions/repository.rs` — expose `update_spec_implementation_plan` helper.

**Step 1: Add failing test** in `db_specs.rs` tests module:

```rust
#[test]
fn update_spec_implementation_plan_roundtrip() {
    let db = create_test_database();
    db.create_spec(&make_spec("s1", "plan-spec", "/repo")).unwrap();
    assert!(db.get_spec_by_id("s1").unwrap().implementation_plan.is_none());

    db.update_spec_implementation_plan("s1", Some("My plan body")).unwrap();
    assert_eq!(
        db.get_spec_by_id("s1").unwrap().implementation_plan.as_deref(),
        Some("My plan body"),
    );

    db.update_spec_implementation_plan("s1", None).unwrap();
    assert!(db.get_spec_by_id("s1").unwrap().implementation_plan.is_none());
}
```

The existing `make_spec` helper must be updated to initialize the new `implementation_plan: None`. Do the same in every other test site that constructs a `Spec { … }` literal.

**Step 2: Run — FAIL**.

**Step 3: Implement** (follow pattern of neighboring `update_spec_*` functions).

**Step 4: Run — PASS**.

---

## Task 5 — Action prompt wrappers (Rust)

**Files:**
- Modify: `src-tauri/src/domains/sessions/action_prompts.rs`

**Step 1: Add failing tests** in the `tests` module:

```rust
use crate::domains::sessions::entity::{Session, SessionState, SessionStatus, Spec, SpecStage};
// (Imports and fixture helpers follow repo conventions.)

#[test]
fn render_plan_candidate_prompt_substitutes_spec_id_and_content() {
    let spec = fixture_spec("the-spec", "SPEC-ID", "Do the thing.");
    let rendered = super::render_plan_candidate_prompt(
        &super::default_plan_candidate_prompt_template(),
        &spec,
    );
    assert!(rendered.contains("SPEC-ID"));
    assert!(rendered.contains("Do the thing."));
}

#[test]
fn render_judge_prompt_plan_round_flavor() {
    let candidates = vec![
        fixture_candidate_session("cand-a", "report-a", "base-a", "agent"),
        fixture_candidate_session("cand-b", "report-b", "base-b", "auto_stub"),
    ];
    let sources = vec!["source-x".into()];
    let rendered = super::render_judge_prompt(
        &super::default_judge_prompt_template(),
        &candidates,
        &sources,
        "plan",
    );
    assert!(rendered.contains("Improve Plan"));
    assert!(rendered.contains("cand-a"));
    assert!(rendered.contains("report-a"));
    assert!(rendered.contains("note: This candidate has only an auto-filed stub report."));
    assert!(rendered.contains("recommended_session_id"));
}

#[test]
fn render_judge_prompt_consolidation_round_flavor() {
    let rendered = super::render_judge_prompt(
        &super::default_judge_prompt_template(),
        &[],
        &[],
        "consolidation",
    );
    assert!(rendered.contains("consolidation candidate"));
}

#[test]
fn render_force_restart_prompt_substitutes_base_spec_content() {
    let rendered = super::render_force_restart_prompt(
        &super::default_force_restart_prompt_template(),
        "original prompt body",
    );
    assert!(rendered.contains("original prompt body"));
    assert!(rendered.contains("continuation of prior work"));
}
```

Fixture helpers (`fixture_spec`, `fixture_candidate_session`) build minimal `Spec` and `Session` structs — see `domains/sessions/entity.rs` for fields. They belong in `action_prompts.rs` `#[cfg(test)]` module.

**Step 2: Run — FAIL**.

**Step 3: Implement**

Add top-level:

```rust
use crate::domains::sessions::entity::{Session, Spec};
use super::super::settings::{
    default_judge_prompt_template, default_plan_candidate_prompt_template,
    default_force_restart_prompt_template,
};
// The re-exports above are placeholders; use full paths if preferred.

pub fn render_plan_candidate_prompt(template: &str, spec: &Spec) -> String {
    render_action_prompt_template(
        template,
        &[
            ("SPEC_ID", spec.id.as_str()),
            ("BASE_SPEC_CONTENT", spec.content.as_str()),
        ],
    )
}

pub fn render_force_restart_prompt(template: &str, base_prompt: &str) -> String {
    render_action_prompt_template(
        template,
        &[("BASE_SPEC_CONTENT", base_prompt)],
    )
}

pub fn render_judge_prompt(
    template: &str,
    candidate_sessions: &[Session],
    source_session_ids: &[String],
    round_type: &str,
) -> String {
    let round_type_noun = if round_type == "plan" {
        "Improve Plan candidate"
    } else {
        "consolidation candidate"
    };

    let recommended_action = if round_type == "plan" {
        "Choose the strongest implementation plan. File your reasoning through \
         lucode_consolidation_report with recommended_session_id set to the winning \
         candidate session ID. Do not call lucode_promote directly."
    } else {
        "Choose the strongest consolidation candidate. File your reasoning through \
         lucode_consolidation_report with recommended_session_id set to the winning \
         candidate session ID. Do not call lucode_promote directly."
    };

    let mut sources_block = String::new();
    for s in source_session_ids {
        sources_block.push_str(&format!("- {s}\n"));
    }

    let mut candidates_block = String::new();
    for candidate in candidate_sessions {
        let report = candidate
            .consolidation_report
            .as_deref()
            .unwrap_or("<missing report>");
        let base = candidate
            .consolidation_base_session_id
            .as_deref()
            .unwrap_or("<missing base>");
        let report_source = candidate
            .consolidation_report_source
            .as_deref()
            .unwrap_or("agent");
        candidates_block.push_str(&format!(
            "- {name}\n  base_session_id: {base}\n  report_source: {report_source}\n",
            name = candidate.name,
        ));
        if report_source == "auto_stub" {
            candidates_block
                .push_str("  note: This candidate has only an auto-filed stub report.\n");
        }
        candidates_block.push_str(&format!("  report:\n{report}\n\n"));
    }

    render_action_prompt_template(
        template,
        &[
            ("ROUND_TYPE_NOUN", round_type_noun),
            ("SOURCE_SESSIONS_BLOCK", sources_block.as_str()),
            ("CANDIDATES_BLOCK", candidates_block.as_str()),
            ("RECOMMENDED_ACTION", recommended_action),
        ],
    )
}
```

**Step 4: Run — PASS**.

---

## Task 6 — Wire plan-candidate to settings-driven template

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
  - Remove body of `build_plan_candidate_prompt` at ~line 5588.
  - Call site around line 5690: fetch setting, fall back to default, call `render_plan_candidate_prompt`.

**Step 1: Add test** (new or update existing). Goal: rendering must substitute placeholders when `plan_candidate_prompt_template` is set in settings, and must fall back to the default when unset.

A unit-level test on the render helper already exists from Task 5. For the call-site wiring, add an integration test inside `mcp_api.rs` `#[cfg(test)] mod tests` that constructs a mock settings manager returning a custom template and asserts the resulting prompt contains the custom sentinel text. If the harness is too heavy, at minimum add a doctest-style assertion that `render_plan_candidate_prompt(&custom_template, &spec)` includes the sentinel.

**Step 2: Run — FAIL**.

**Step 3: Implement**

At the plan candidate creation site, replace `let prompt = build_plan_candidate_prompt(&spec);` with:

```rust
let plan_candidate_template = {
    let manager = settings_manager.lock().await;
    manager
        .get_generation_settings()
        .plan_candidate_prompt_template
        .unwrap_or_else(lucode::domains::settings::default_plan_candidate_prompt_template)
};
let prompt = lucode::domains::sessions::action_prompts::render_plan_candidate_prompt(
    &plan_candidate_template,
    &spec,
);
```

Thread `settings_manager` into `create_improve_plan_round_start_context` as an argument (the function is currently sync; make it async and update the caller). If making it async is disruptive, resolve the template in the async caller before calling the helper and pass `prompt: &str` down.

Delete the now-unused `build_plan_candidate_prompt` function.

**Step 4: Run — PASS**.

---

## Task 7 — Wire judge to settings-driven template

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
  - Replace `build_judge_prompt` call sites to fetch settings + call `render_judge_prompt`.
  - Delete `build_judge_prompt` (lines 1388-1437) once unused.

**Step 1: Add/adjust test** in `mcp_api.rs` tests for the judge wiring — reuse approach from Task 6.

**Step 2: Run — FAIL**.

**Step 3: Implement**

Find every call site (judge trigger + auto-trigger). At each, fetch:

```rust
let judge_template = {
    let manager = settings_manager.lock().await;
    manager
        .get_generation_settings()
        .judge_prompt_template
        .unwrap_or_else(lucode::domains::settings::default_judge_prompt_template)
};
let prompt = lucode::domains::sessions::action_prompts::render_judge_prompt(
    &judge_template,
    &candidate_sessions,
    &source_session_ids,
    round_type,
);
```

Delete `build_judge_prompt` and its tests (or refactor the tests to target `render_judge_prompt` with the default template — keep coverage).

**Step 4: Run — PASS**.

---

## Task 8 — Wire force-restart to settings-driven template

**Files:**
- Modify: `src-tauri/src/domains/sessions/service.rs` — replace `build_force_restart_prompt` body.
- Modify: `src-tauri/src/commands/schaltwerk_core.rs:3565-3600` (caller of `start_claude_in_session_with_restart_and_binary` + friends) — fetch the template in the async Tauri command and thread into `AgentLaunchParams`.
- Modify: `src-tauri/src/domains/sessions/service.rs` — extend `AgentLaunchParams` with `force_restart_prompt_template: Option<&str>` OR require the caller to pre-compute the force-restart prompt string.

**Decision:** Extend `AgentLaunchParams` with an `&str` template field (always provided). The service layer calls `render_force_restart_prompt(template, base_prompt)` only when preamble is needed (i.e., when there are uncommitted changes or commits ahead).

**Step 1: Add failing test** — reuse existing `build_force_restart_prompt` tests; convert them to call the renamed `render_force_restart_prompt` using the default template. Assert that the rendered output still contains the original preamble text and the base prompt.

**Step 2: Run — FAIL**.

**Step 3: Implement**

- Rename/replace `build_force_restart_prompt` to a thin wrapper that:
  1. Computes whether a preamble is needed (existing `has_uncommitted_changes` + `commits_ahead_count` logic).
  2. If not needed, returns `Some(Cow::Borrowed(initial_prompt))`.
  3. Otherwise returns `Some(Cow::Owned(render_force_restart_prompt(template, initial_prompt)))`.
- Add `force_restart_prompt_template: &'a str` to `AgentLaunchParams<'a>`.
- In `schaltwerk_core.rs`, load the template once per launch (same pattern as autonomy template at lines 1898-1907), pass it in.

**Step 4: Run — PASS**.

---

## Task 9 — Remove `write_implementation_plan_section` mutation of `spec.content`

**Files:**
- Modify: `src-tauri/src/mcp_api.rs:7638-7665` (confirm-winner path for plan rounds).
- Optionally delete `write_implementation_plan_section` (lines 6430-6472) and its tests at 4849-4890 if no other callers remain.

**Step 1: Add failing test** in `mcp_api.rs` tests:

```rust
#[tokio::test]
async fn confirm_plan_round_winner_persists_to_implementation_plan_not_spec_content() {
    // Arrange: create a spec with known content, a plan round, a candidate with a report.
    // Act: call the confirm-winner handler for round_type = "plan".
    // Assert:
    //   - spec.content is unchanged.
    //   - spec.implementation_plan == winner.consolidation_report (trimmed).
}
```

The existing `mcp_api.rs` tests already exercise the plan-round confirmation flow (search for `confirm_plan_round` / `write_implementation_plan_section_*`). Follow that harness.

**Step 2: Run — FAIL**.

**Step 3: Implement**

Replace:

```rust
let updated_content = write_implementation_plan_section(&spec.content, plan);
SpecMethods::update_spec_content(db, &spec.id, &updated_content).map_err(...)?;
```

With:

```rust
SpecMethods::update_spec_implementation_plan(db, &spec.id, Some(plan.trim())).map_err(...)?;
```

Remove the now-orphan `write_implementation_plan_section` function and its tests unless something else references them.

**Step 4: Run — PASS**.

---

## Task 10 — Frontend Spec type + UI render of `implementation_plan`

**Files:**
- Modify: `src/common/sessionTypes.ts` (or wherever `Spec` is declared on the frontend) — add `implementation_plan?: string | null`.
- Modify: spec preview / detail components that render `spec.content` — append a `## Implementation Plan` section (when `implementation_plan` is non-empty) below the main markdown.

**Step 1: Find the frontend Spec type declaration**

Run: `grep -rn "interface Spec\\b\\|type Spec\\b" src/`

**Step 2: Add failing vitest** for the spec view component, asserting that when the prop includes a non-empty `implementation_plan`, the rendered output contains the plan body under an "Implementation Plan" heading.

**Step 3: Implement** the render change using the existing MarkdownRenderer.

**Step 4: Run frontend tests** — `bun run test:vitest -- <componentfile>` (or the equivalent single-file test invocation in the repo).

---

## Task 11 — Frontend Settings UI for three new templates

**Files:**
- Modify: `src/common/generationPrompts.ts` — add three new `force_restart_prompt_template`, `plan_candidate_prompt_template`, `judge_prompt_template` fields to both interfaces; add fallback defaults in `FALLBACK_DEFAULT_GENERATION_PROMPTS`; extend `resolveGenerationPrompts`.
- Modify: `src/common/i18n/types.ts` — add new keys under `settings.agentConfiguration`: `forceRestartTemplate`, `forceRestartTemplateDesc`, `forceRestartTemplateHint` (and the same for `planCandidateTemplate` and `judgeTemplate`).
- Modify: `src/locales/en.json` (and matching structure for any other locale that must stay in sync).
- Modify: `src/components/modals/SettingsModal.tsx`:
  - Extend `DefaultGenerationPrompts` usage — state for each template string.
  - Load into state in the settings fetch block.
  - Send in `saveGenerationSettings` when non-default.
  - Render three new `Textarea` blocks alongside the existing autonomy textarea (`renderAutonomyTemplateSettings`). Consider extracting a small helper that accepts `title`, `description`, `hint`, `value`, `defaultValue`, `onChange`, `onBlur` to avoid duplicating the JSX four times.
- Modify: `src/common/generationPrompts.test.ts` — extend existing round-trip tests.

**Step 1: Write failing vitest** for `resolveGenerationPrompts` covering new fields.

**Step 2: Run** — FAIL.

**Step 3: Implement the TS plumbing, then the UI**

**Step 4: Run** `bun run lint && bun run test:vitest` for affected suites — expect PASS.

---

## Task 12 — Full validation

Run the project validation gate:

```bash
just test
```

This runs TypeScript lint + type-check, MCP lint/tests, frontend vitest, Rust clippy, `cargo shear`, `knip`, `cargo nextest`. All must be green. Fix anything that goes red.

---

## Task 13 — Code review and squashed commit

1. Use the `superpowers:requesting-code-review` skill on the collected changes.
2. Address any findings.
3. Re-run `just test`.
4. Create ONE final squashed commit (amend the design-doc commit into the final tree, then rebase-squash or soft-reset + single commit):
   ```bash
   git reset --soft "$(git merge-base HEAD main)"
   git status            # sanity check the staged set
   git commit -m "feat(prompts): user-editable action templates with BASE_SPEC_CONTENT\n\n- Add force_restart/plan_candidate/judge templates in GenerationSettings with defaults.\n- New render_action_prompt_template helper; per-action wrappers (plan candidate, judge, force restart).\n- Stop mutating spec.content at plan-round confirm-winner; persist plan in new specs.implementation_plan column.\n- Surface new templates and implementation_plan in the Settings UI and spec preview."
   ```
5. Do NOT push. User runs the push.

---

## Notes / watchouts

- Tests that construct `Spec { … }` literals are scattered — expect several test files to need `implementation_plan: None` added.
- `AgentLaunchParams` is a struct passed by value; extending it affects many callers. Use a default-valued helper (e.g., `AgentLaunchParams::builder()` if one exists, or a sensible `Default` impl) where possible.
- The `consolidate` prompt in `src/common/generationPrompts.ts` already uses single-brace `{key}` substitution via `renderGenerationPrompt`. The new placeholder convention is compatible.
- macOS-only; do not worry about Windows/Linux.
- Don't introduce comments in code unless a WHY is non-obvious (per CLAUDE.md).
