use crate::mcp_api::{
    ConfirmConsolidationWinnerResponse, ImprovePlanRoundResponse, StartImprovePlanRoundParams,
    TriggerConsolidationJudgeResponse, confirm_consolidation_winner_inner,
    maybe_auto_start_consolidation_judge, start_improve_plan_round_inner,
    trigger_consolidation_judge_inner, upsert_consolidation_round,
};
use crate::{
    PROJECT_MANAGER, SETTINGS_MANAGER, commands::session_lookup_cache::global_session_lookup_cache,
    errors::SchaltError, get_core_read, get_core_read_for_project_path, get_core_write,
    get_core_write_for_project_path, get_file_watcher_manager, get_settings_manager,
    get_terminal_manager,
};
use lucode::infrastructure::attention_bridge::{
    clear_session_attention_state, clear_session_attention_state_immediate,
};
use lucode::infrastructure::database::db_specs::SpecMethods as _;
use lucode::infrastructure::events::{SchaltEvent, emit_event};
use lucode::schaltwerk_core::db_app_config::AppConfigMethods;
use lucode::schaltwerk_core::db_project_config::{DEFAULT_BRANCH_PREFIX, ProjectConfigMethods};
use lucode::schaltwerk_core::{AgentLaunchParams, SessionManager};
use lucode::services::MergeStateSnapshot;
use lucode::services::ServiceHandles;
use lucode::services::SessionMethods;
use lucode::services::format_branch_name;
use lucode::services::get_project_files_with_status;
use lucode::services::repository;
use lucode::services::{AgentManifest, parse_agent_command, submission_options_for_agent};
use lucode::services::{
    ConsolidationStats, ConsolidationStatsFilter, EnrichedSessionEntity as EnrichedSession,
    FilterMode, Session, SessionState, SortMode,
};
use lucode::services::{MergeMode, MergeOutcome, MergePreview, MergeService};
use lucode::services::{
    build_login_shell_invocation_with_shell, get_effective_shell, sh_quote_string,
    shell_invocation_to_posix,
};
use lucode::utils::env_adapter::EnvAdapter;
use std::collections::BTreeSet;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::State;
use uuid::Uuid;
mod agent_ctx;
pub mod agent_launcher;
mod codex_model_commands;
mod codex_models;
pub mod events;
mod schaltwerk_core_cli;
pub mod terminals;

pub use codex_model_commands::schaltwerk_core_list_codex_models;

fn matches_version_pattern(name: &str, base_name: &str) -> bool {
    if let Some(suffix) = name.strip_prefix(&format!("{base_name}_v")) {
        !suffix.is_empty() && suffix.chars().all(|c| c.is_numeric())
    } else {
        false
    }
}

async fn evict_session_cache_entry_for_repo(repo_key: &str, session_id: &str) {
    global_session_lookup_cache()
        .evict_repo_session(repo_key, session_id)
        .await;
}

fn emit_session_cancel_blocked(
    app: &tauri::AppHandle,
    session_name: &str,
    blocker: &lucode::domains::sessions::lifecycle::cancellation::CancelBlocker,
) {
    #[derive(serde::Serialize, Clone)]
    struct CancelBlockedPayload {
        session_name: String,
        blocker: lucode::domains::sessions::lifecycle::cancellation::CancelBlocker,
    }

    if let Err(error) = emit_event(
        app,
        SchaltEvent::SessionCancelBlocked,
        &CancelBlockedPayload {
            session_name: session_name.to_string(),
            blocker: blocker.clone(),
        },
    ) {
        log::warn!("Failed to emit cancel blocked event for {session_name}: {error}");
    }
}

fn is_conflict_error(message: &str) -> bool {
    let lowercase = message.to_lowercase();
    lowercase.contains("conflict")
        || lowercase.contains("could not apply")
        || lowercase.contains("merge failed")
        || lowercase.contains("patch failed")
}

fn summarize_error(message: &str) -> String {
    message
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(message)
        .trim()
        .to_string()
}

fn extract_conflicting_paths(message: &str) -> Vec<String> {
    let marker = "Conflicting paths:";
    let Some((_, tail)) = message.rsplit_once(marker) else {
        return Vec::new();
    };

    let first_line = tail.lines().next().unwrap_or(tail);
    first_line
        .split(',')
        .map(|part| part.trim().trim_end_matches('.').trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

fn collect_conflicting_paths_from_worktree(worktree_path: &Path) -> Vec<String> {
    let Ok(repo) = git2::Repository::open(worktree_path) else {
        return Vec::new();
    };
    let Ok(index) = repo.index() else {
        return Vec::new();
    };
    if !index.has_conflicts() {
        return Vec::new();
    }

    let Ok(conflicts_iter) = index.conflicts() else {
        return Vec::new();
    };

    let mut seen = BTreeSet::new();

    for conflict in conflicts_iter.flatten() {
        let path = conflict
            .our
            .as_ref()
            .and_then(|entry| std::str::from_utf8(&entry.path).ok())
            .or_else(|| {
                conflict
                    .their
                    .as_ref()
                    .and_then(|entry| std::str::from_utf8(&entry.path).ok())
            })
            .or_else(|| {
                conflict
                    .ancestor
                    .as_ref()
                    .and_then(|entry| std::str::from_utf8(&entry.path).ok())
            });

        if let Some(path) = path.map(str::trim).filter(|path| !path.is_empty())
            && path != ".lucode"
            && !path.starts_with(".lucode/")
        {
            seen.insert(path.to_string());
        }
    }

    seen.into_iter().collect()
}

fn resolve_conflicting_paths(message: &str, worktree_path: &Path) -> Vec<String> {
    let parsed = extract_conflicting_paths(message);
    if !parsed.is_empty() {
        return parsed;
    }

    collect_conflicting_paths_from_worktree(worktree_path)
}

fn format_agent_start_error(message: &str) -> String {
    let summary = summarize_error(message);
    format!(
        "\r\n\x1b[1;31mError: Failed to start agent\x1b[0m\r\n\r\n{summary}\r\n\r\nPlease check:\r\n- The agent binary path is correct in Settings\r\n- The binary exists and has execute permissions\r\n- The binary is compatible with your system\r\n"
    )
}

fn emit_terminal_agent_started(
    app: &tauri::AppHandle,
    terminal_id: &str,
    session_name: Option<&str>,
) {
    #[derive(serde::Serialize, Clone)]
    struct TerminalAgentStartedPayload<'a> {
        terminal_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_name: Option<&'a str>,
    }

    if let Err(err) = emit_event(
        app,
        SchaltEvent::TerminalAgentStarted,
        &TerminalAgentStartedPayload {
            terminal_id,
            session_name,
        },
    ) {
        log::warn!("Failed to emit terminal-agent-started event for {terminal_id}: {err}");
    }
}

fn emit_agent_crashed_for_dead_pane(
    app: &tauri::AppHandle,
    terminal_id: &str,
    session_name: &str,
    agent_type: &str,
) {
    #[derive(serde::Serialize, Clone)]
    struct AgentCrashPayload<'a> {
        terminal_id: &'a str,
        agent_type: &'a str,
        session_name: &'a str,
        exit_code: Option<i32>,
        buffer_size: usize,
        last_seq: u64,
    }

    let payload = AgentCrashPayload {
        terminal_id,
        agent_type,
        session_name,
        exit_code: None,
        buffer_size: 0,
        last_seq: 0,
    };

    if let Err(err) = emit_event(app, SchaltEvent::AgentCrashed, &payload) {
        log::warn!(
            "Failed to emit agent-crashed event for reattached dead pane {terminal_id}: {err}"
        );
    }
}

#[derive(serde::Serialize, Clone)]
struct SessionAddedPayload {
    session_name: String,
    branch: String,
    worktree_path: String,
    parent_branch: String,
    created_at: String,
    last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version_group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    epic: Option<lucode::domains::sessions::entity::Epic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_consolidation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_round_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_report: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_report_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_base_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_recommended_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consolidation_confirmation_mode: Option<String>,
}

fn build_session_added_payload(
    session: &Session,
    epic: Option<lucode::domains::sessions::entity::Epic>,
) -> SessionAddedPayload {
    SessionAddedPayload {
        session_name: session.name.clone(),
        branch: session.branch.clone(),
        worktree_path: session.worktree_path.to_string_lossy().to_string(),
        parent_branch: session.parent_branch.clone(),
        created_at: session.created_at.to_rfc3339(),
        last_modified: session.last_activity.map(|ts| ts.to_rfc3339()),
        version_group_id: session.version_group_id.clone(),
        version_number: session.version_number,
        epic,
        agent_type: session.original_agent_type.clone(),
        is_consolidation: session.is_consolidation.then_some(true),
        consolidation_sources: session.consolidation_sources.clone(),
        consolidation_round_id: session.consolidation_round_id.clone(),
        consolidation_role: session.consolidation_role.clone(),
        consolidation_report: session.consolidation_report.clone(),
        consolidation_report_source: session.consolidation_report_source.clone(),
        consolidation_base_session_id: session.consolidation_base_session_id.clone(),
        consolidation_recommended_session_id: session.consolidation_recommended_session_id.clone(),
        consolidation_confirmation_mode: session.consolidation_confirmation_mode.clone(),
    }
}

async fn get_agent_env_and_cli_args_async(
    agent_type: &str,
) -> (
    Vec<(String, String)>,
    String,
    Option<String>,
    lucode::domains::settings::AgentPreference,
) {
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager
            .get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        let binary_path = manager.get_effective_binary_path(agent_type).ok();
        let preferences = manager.get_agent_preferences(agent_type);
        (env_vars, cli_args, binary_path, preferences)
    } else {
        (
            vec![],
            String::new(),
            None,
            lucode::domains::settings::AgentPreference::default(),
        )
    }
}

async fn load_cached_agent_binary_paths() -> std::collections::HashMap<String, String> {
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();

        for agent in [
            "claude", "copilot", "codex", "opencode", "gemini", "droid", "qwen", "amp", "kilocode",
        ] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::trace!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                }
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    }
}

fn build_spec_clarification_prompt(spec: &lucode::domains::sessions::entity::Spec) -> String {
    let title = spec.display_name.as_deref().unwrap_or(&spec.name);
    format!(
        "You are the clarification agent for the Lucode spec \"{title}\".\n\n\
Job: turn the draft into a ready problem definition for the next task stage. Investigate deeply before asking anything. Record what you find. Only surface questions that require genuine human judgment.\n\n\
INVESTIGATION:\n\
On turn 1, before any question, do all of the following and record each as a `verified:` Context entry (match with snippet OR explicit null result):\n\
1. Read the draft end-to-end; restate intent in your own words.\n\
2. Read `CLAUDE.md` at the repo root; read any nested `CLAUDE.md` inside directories the draft names.\n\
3. Scan `plans/` for terms from the draft; list prior specs via the `lucode_spec_list` MCP tool and read relevant titles.\n\
4. Grep the repo for the draft's key nouns, proper nouns, symbols, or paths — at least one search.\n\
5. Trace one relevant data or control flow the draft touches, chosen by the strongest term match from step 4.\n\
Minimum-evidence floor (applies to every non-early-exit pass, regardless of question count): at least one `verified:` entry citing `CLAUDE.md` (root or nested), at least one `verified:` entry for `plans/` or prior specs (match or explicit null result), and at least one `verified:` entry recording a symbol/path search result (match or null).\n\
On Claude: invoke `superpowers:brainstorming` on turn 1 to expand intent; invoke `superpowers:systematic-debugging` when the draft describes a bug; use the `Agent` tool (via `superpowers:dispatching-parallel-agents` when candidate questions are independent) to run the question-research gate — one research subagent per candidate question, dispatched in parallel when independent.\n\n\
CONTEXT_FORMAT:\n\
All findings live under a `## Context` subsection in the rewritten spec. Every entry begins with one of these tags:\n\
- `verified: <path>:<line-or-range> — \"<quoted snippet or concise paraphrase from that location>\"`\n\
- `verified: searched <terms-or-question> in <scope> — <no match | summary of finding>`\n\
- `verified: researched <question> via <subagent|targeted search> — <summary>`\n\
- `assumed: <claim> because <reason>`\n\
A bare path without snippet, range, or null-result is not sufficient. Discoveries NEVER go silently into `## Problem`, `## Goal`, or `## Decisions`.\n\n\
QUESTION_RULES:\n\
- Ceiling: up to 3 explicit questions per pass. This is a ceiling, not a target.\n\
- Atomic: one interrogative, one decision, one subject. No `and`, `or`, `also`, `plus`, or comma-joined asks.\n\
- Compound-across-turns ban: splitting a compound question into sequential single questions across turns counts as one compound violation.\n\
- Every question MUST be predicated on a named `verified:` Context entry AND accompanied by a `verified: researched <question> via <subagent|targeted search> — no repo answer; requires human <intent|scope|tradeoff|priority> judgment` entry that records the failed research attempt.\n\
- Good-question shape: target user intent, scope boundaries, UX tradeoffs, priorities, or constraints unknowable from the code.\n\n\
QUESTION_RESEARCH_GATE:\n\
Before surfacing ANY candidate question to the user, run a dedicated research pass on that specific question. Outcomes:\n\
- Answered → drop the question; add the finding as a `verified:` Context entry and resolve dependent `assumed:` entries.\n\
- Partially answered (scope narrowed but judgment still required) → rewrite the question to reflect the narrower remaining ambiguity, and record what research established as a `verified:` Context entry.\n\
- Not answered (genuine user-judgment call) → the question survives, paired with a `verified: researched ... — no repo answer; requires human <intent|scope|tradeoff|priority> judgment` Context entry summarizing what was searched.\n\
Claude path: dispatch one `Agent`-tool research subagent per candidate question (parallel via `superpowers:dispatching-parallel-agents` when independent).\n\
Non-Claude path (Codex, Gemini, Droid, OpenCode, or any agent without reliable subagent dispatch): run an additional targeted deep-search per candidate question — at minimum one fresh grep using question-specific terms, one read of any file the search surfaces, and a written summary recorded as a `verified: researched ...` entry. Skipping this step is not acceptable on any agent.\n\
Fabricating a null-result entry without actually running the research counts as a regression.\n\n\
EARLY_EXIT:\n\
Permitted only when ALL four gates hold after one read of the draft:\n\
1. Draft is non-empty (at least one token after trimming whitespace).\n\
2. Draft is ≤300 characters.\n\
3. Draft references no external symbols, file paths, or domain terms that require resolution.\n\
4. Draft contains no integration verbs (wire, hook, replace, migrate, refactor, extend, integrate).\n\
List which gates passed. Failing any gate forbids early exit. On early exit: `## Context` contains one `verified:` entry naming the gates passed; the minimum-evidence floor and the question-research gate are waived (no questions are being posed); `## Problem` and `## Goal` faithfully restate the draft.\n\n\
LATER_TURNS:\n\
Do NOT redo the full five-step sweep. Diff the user's latest turn against existing Context; extract every new proper noun, file path, symbol, acronym, or domain term; produce a `verified:` entry (via bounded, targeted search or read for that specific term) or an `assumed:` entry for each before using that term in reasoning. Any NEW candidate question introduced by the follow-up is subject to the full QUESTION_RESEARCH_GATE before being surfaced. A later turn with zero new terms extracted and no new candidate questions requires an explicit \"no new terms introduced\" statement.\n\n\
PROHIBITIONS:\n\
Never ask a question whose answer is:\n\
- Findable via a symbol, path, or term search in the repo.\n\
- In `CLAUDE.md` (root or nested).\n\
- In memory.\n\
- In a prior spec.\n\
- In `plans/`.\n\
- About whether a helper exists that you have not already searched for.\n\
- Vague about scope (e.g. \"what should this cover?\").\n\
Never surface a question that lacks a paired `verified: researched ...` Context entry.\n\
Never invent requirements: `## Problem` and `## Goal` stay anchored to the draft and the user's turns; new facts go into `## Context`; a discovery that implies a new requirement is recorded as an `assumed:` entry and must be converted to a question (subject to the research gate), resolved to a `verified:` entry, or deleted before finalizing.\n\n\
Spec-writing rules:\n\
- Stay at the clarification/problem-definition level.\n\
- Rewrite the spec content only through Lucode MCP tools such as `lucode_spec_read`, `lucode_draft_update`, `lucode_spec_set_stage`, and `lucode_spec_set_attention`.\n\
- Structure the rewritten spec with `## Problem` and `## Goal`. Add `## Context`, `## Constraints`, `## Out of Scope`, or `## Decisions` only when they help clarify the request.\n\
- When blocked on missing user input, call `lucode_spec_set_attention` with `attention_required: true` and leave the concrete questions in the spec.\n\
- After the user responds and you are unblocked, call `lucode_spec_set_attention` with `attention_required: false`.\n\
- When the spec is clear, call `lucode_spec_set_stage` with stage `ready`. If it needs more clarification later, call `lucode_spec_set_stage` with stage `draft`.\n\
- Do not produce implementation steps, file lists, function signatures, code stubs, or solution plans.\n\n\
{guidance} In this clarification stage, diagrams are for framing existing structure or problem-space context only; do not draft solution-design diagrams.\n\n\
Current spec draft:\n\n\
{content}",
        guidance = lucode::domains::settings::MERMAID_DIAGRAM_GUIDANCE,
        content = spec.content
    )
}

fn resolve_spec_clarification_agent_type(
    db: &impl AppConfigMethods,
    agent_type: Option<String>,
) -> String {
    agent_type.unwrap_or_else(|| {
        db.get_spec_clarification_agent_type()
            .unwrap_or_else(|_| "claude".to_string())
    })
}

#[cfg(test)]
mod spec_clarification_prompt_tests {
    use super::{build_spec_clarification_prompt, resolve_spec_clarification_agent_type};
    use chrono::Utc;
    use lucode::infrastructure::database::Database;
    use lucode::schaltwerk_core::db_app_config::AppConfigMethods;
    use regex::Regex;
    use std::path::PathBuf;

    fn make_spec(content: &str) -> lucode::domains::sessions::entity::Spec {
        let now = Utc::now();
        lucode::domains::sessions::entity::Spec {
            id: "spec-1".to_string(),
            name: "alpha".to_string(),
            display_name: Some("Alpha".to_string()),
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            content: content.to_string(),
            implementation_plan: None,
            created_at: now,
            updated_at: now,
            stage: lucode::domains::sessions::entity::SpecStage::Draft,
            variant: lucode::domains::sessions::entity::TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: false,
            clarification_started: false,
        }
    }

    fn default_prompt() -> String {
        build_spec_clarification_prompt(&make_spec("rough draft"))
    }

    fn assert_regex(prompt: &str, pattern: &str, label: &str) {
        let re = Regex::new(pattern).unwrap_or_else(|e| panic!("bad regex {pattern}: {e}"));
        assert!(
            re.is_match(prompt),
            "expected prompt to match {label} (/{pattern}/)"
        );
    }

    #[test]
    fn prompt_mentions_attention_tool_and_problem_goal_sections() {
        let prompt = default_prompt();
        assert!(prompt.contains("lucode_spec_set_attention"));
        assert!(prompt.contains("## Problem"));
        assert!(prompt.contains("## Goal"));
    }

    #[test]
    fn prompt_has_all_required_section_anchors_with_content() {
        let prompt = default_prompt();
        for anchor in [
            "INVESTIGATION",
            "CONTEXT_FORMAT",
            "QUESTION_RULES",
            "QUESTION_RESEARCH_GATE",
            "EARLY_EXIT",
            "LATER_TURNS",
            "PROHIBITIONS",
        ] {
            assert_regex(
                &prompt,
                &format!(r"(?m)^{anchor}:\n\S"),
                &format!("non-empty {anchor}: section"),
            );
        }
    }

    #[test]
    fn investigation_section_names_required_sources() {
        let prompt = default_prompt();
        assert!(
            prompt.contains("CLAUDE.md"),
            "INVESTIGATION must name CLAUDE.md"
        );
        assert!(prompt.contains("plans/"), "INVESTIGATION must name plans/");
        assert!(
            prompt.contains("lucode_spec_list"),
            "INVESTIGATION must call the lucode_spec_list MCP tool"
        );
        assert_regex(
            &prompt,
            r"(?i)\bgrep\b",
            "INVESTIGATION must require a grep step",
        );
        assert_regex(
            &prompt,
            r"(?i)(data|control) flow",
            "INVESTIGATION must require a flow-trace step",
        );
        assert_regex(
            &prompt,
            r"(?i)nested\s+`?CLAUDE\.md`?",
            "INVESTIGATION must call for nested CLAUDE.md reads",
        );
    }

    #[test]
    fn investigation_mentions_minimum_evidence_floor() {
        let prompt = default_prompt();
        assert!(
            prompt.contains("Minimum-evidence floor"),
            "prompt must state the minimum-evidence floor"
        );
        assert_regex(
            &prompt,
            r"(?is)Minimum-evidence floor.*CLAUDE\.md.*plans/.*symbol",
            "floor must cover CLAUDE.md + plans/prior specs + symbol/path",
        );
    }

    #[test]
    fn investigation_names_claude_skill_and_subagent_mechanisms() {
        let prompt = default_prompt();
        assert!(prompt.contains("superpowers:brainstorming"));
        assert!(prompt.contains("superpowers:systematic-debugging"));
        assert!(prompt.contains("superpowers:dispatching-parallel-agents"));
        assert!(
            prompt.contains("`Agent` tool"),
            "prompt must name the Agent tool for subagent dispatch"
        );
    }

    #[test]
    fn context_format_defines_verified_and_assumed_grammars() {
        let prompt = default_prompt();
        assert!(prompt.contains("## Context"));
        assert!(
            prompt.contains("verified: <path>:<line-or-range>"),
            "CONTEXT_FORMAT must define path:line verified grammar"
        );
        assert!(
            prompt.contains("verified: searched"),
            "CONTEXT_FORMAT must define searched/null-result grammar"
        );
        assert!(
            prompt.contains("verified: researched"),
            "CONTEXT_FORMAT must define researched grammar"
        );
        assert!(
            prompt.contains("assumed: <claim> because <reason>"),
            "CONTEXT_FORMAT must define assumed grammar"
        );
    }

    #[test]
    fn question_rules_cover_ceiling_atomic_and_compound_bans() {
        let prompt = default_prompt();
        assert_regex(
            &prompt,
            r"(?i)up to 3 (explicit )?questions",
            "3-question ceiling",
        );
        assert_regex(&prompt, r"(?i)\bAtomic\b", "atomic rule");
        assert!(
            prompt.contains("Compound-across-turns"),
            "compound-across-turns ban"
        );
        assert_regex(
            &prompt,
            r"(?i)and.*or.*also.*plus",
            "compound connectives ban",
        );
        assert_regex(
            &prompt,
            r"(?i)predicated on",
            "question must be predicated on verified Context",
        );
        assert_regex(
            &prompt,
            r"(?i)user intent.*scope.*tradeoff|intent.*scope.*priorit",
            "good-question shape",
        );
    }

    #[test]
    fn question_research_gate_covers_three_outcomes_and_both_agent_paths() {
        let prompt = default_prompt();
        assert_regex(&prompt, r"(?m)- Answered", "answered outcome");
        assert_regex(
            &prompt,
            r"(?m)- Partially answered",
            "partially answered outcome",
        );
        assert_regex(&prompt, r"(?m)- Not answered", "not answered outcome");
        assert!(prompt.contains("Claude path:"), "Claude path guidance");
        assert!(
            prompt.contains("Non-Claude path"),
            "Non-Claude fallback guidance",
        );
        assert_regex(
            &prompt,
            r"(?i)targeted deep-search",
            "non-Claude fallback must require a targeted deep-search",
        );
        assert_regex(
            &prompt,
            r"(?i)fabricat(ing|ed)",
            "gate must warn against fabricated null results",
        );
    }

    #[test]
    fn every_surviving_question_paired_with_verified_researched_entry() {
        let prompt = default_prompt();
        assert_regex(
            &prompt,
            r"(?is)QUESTION_RULES:.*verified: researched",
            "QUESTION_RULES must require a paired verified: researched entry per question",
        );
        assert_regex(
            &prompt,
            r"(?is)PROHIBITIONS:.*lacks a paired `verified: researched",
            "PROHIBITIONS must ban questions lacking paired verified: researched entry",
        );
    }

    #[test]
    fn early_exit_lists_four_objective_gates() {
        let prompt = default_prompt();
        assert_regex(&prompt, r"(?m)^1\. Draft is non-empty", "gate 1");
        assert_regex(&prompt, r"(?m)^2\. Draft is .*300 characters", "gate 2");
        assert_regex(&prompt, r"(?m)^3\. Draft references no", "gate 3");
        assert_regex(
            &prompt,
            r"(?m)^4\. Draft contains no integration verbs",
            "gate 4",
        );
        assert_regex(
            &prompt,
            r"wire, hook, replace, migrate, refactor, extend, integrate",
            "integration verbs enumerated",
        );
        assert_regex(
            &prompt,
            r"(?i)(list|state) which gates passed",
            "must state which gates passed",
        );
    }

    #[test]
    fn later_turns_bans_full_sweep_and_requires_diff_extract_and_gate() {
        let prompt = default_prompt();
        assert_regex(
            &prompt,
            r"(?is)LATER_TURNS:.*Do NOT redo the full five-step sweep",
            "later turns must forbid redoing the full sweep",
        );
        assert_regex(
            &prompt,
            r"(?is)LATER_TURNS:.*Diff the user's latest turn",
            "later turns must require diff-and-extract",
        );
        assert_regex(
            &prompt,
            r"(?is)LATER_TURNS:.*QUESTION_RESEARCH_GATE",
            "later turns must require the research gate for new questions",
        );
        assert_regex(
            &prompt,
            r#"no new terms introduced"#,
            "later turns must require explicit no-new-terms statement",
        );
    }

    #[test]
    fn prohibitions_enumerate_forbidden_question_categories() {
        let prompt = default_prompt();
        for phrase in [
            "symbol",
            "CLAUDE.md",
            "memory",
            "prior spec",
            "plans/",
            "helper",
            "Vague about scope",
        ] {
            assert!(
                prompt.contains(phrase),
                "PROHIBITIONS must enumerate forbidden category containing {phrase}"
            );
        }
    }

    #[test]
    fn prompt_forbids_inventing_requirements() {
        let prompt = default_prompt();
        assert_regex(
            &prompt,
            r"(?i)Never invent requirements",
            "explicit no-invented-requirements rule",
        );
        assert_regex(
            &prompt,
            r"(?is)## Problem.*## Goal.*anchored to the draft",
            "Problem/Goal must stay anchored to the draft and user turns",
        );
    }

    #[test]
    fn resolve_spec_clarification_agent_type_uses_db_default_when_override_missing() {
        let db = Database::new(None).expect("Failed to create database");
        db.set_spec_clarification_agent_type("gemini")
            .expect("Failed to set spec clarification agent type");

        let resolved = resolve_spec_clarification_agent_type(&db, None);

        assert_eq!(resolved, "gemini");
    }

    #[test]
    fn prompt_mentions_mermaid_diagram_guidance() {
        let prompt = default_prompt();
        assert!(
            prompt.contains("mermaid"),
            "clarification prompt must mention mermaid"
        );
        assert!(
            prompt.contains("when it makes sense"),
            "clarification prompt must keep the \"when it makes sense\" trigger phrase"
        );
        for trigger in [
            "architecture",
            "data or control flow",
            "state machines",
            "sequence of events",
        ] {
            assert!(
                prompt.contains(trigger),
                "clarification prompt must list \"{trigger}\" as a diagram use case"
            );
        }
        assert!(
            prompt.contains("do not draft solution-design diagrams"),
            "clarification prompt must scope diagrams away from solution design"
        );
    }
}

#[cfg(test)]
mod consolidation_default_favorite_tests {
    use super::{ConsolidationDefaultFavoriteDto, normalize_optional};
    use lucode::infrastructure::database::Database;
    use lucode::schaltwerk_core::db_app_config::{AppConfigMethods, ConsolidationDefaultFavorite};

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().join("sessions.db");
        let db = Database::new(Some(path)).expect("Failed to create database");
        (dir, db)
    }

    #[test]
    fn repository_default_returns_claude_agent() {
        let (_dir, db) = temp_db();
        let value = db
            .get_consolidation_default_favorite()
            .expect("read default");
        assert_eq!(value.agent_type.as_deref(), Some("claude"));
        assert!(value.preset_id.is_none());
    }

    #[test]
    fn command_normalization_prefers_preset_and_clears_agent() {
        let dto = ConsolidationDefaultFavoriteDto {
            agent_type: Some("codex".to_string()),
            preset_id: Some("  preset-1 ".to_string()),
        };
        let preset_id = normalize_optional(dto.preset_id);
        let agent_type = if preset_id.is_some() {
            None
        } else {
            normalize_optional(dto.agent_type)
        };
        assert_eq!(preset_id.as_deref(), Some("preset-1"));
        assert!(agent_type.is_none());
    }

    #[test]
    fn command_normalization_keeps_agent_when_preset_blank() {
        let dto = ConsolidationDefaultFavoriteDto {
            agent_type: Some(" codex ".to_string()),
            preset_id: Some("".to_string()),
        };
        let preset_id = normalize_optional(dto.preset_id);
        let agent_type = if preset_id.is_some() {
            None
        } else {
            normalize_optional(dto.agent_type)
        };
        assert!(preset_id.is_none());
        assert_eq!(agent_type.as_deref(), Some("codex"));
    }

    #[test]
    fn command_normalization_returns_both_none_when_blank() {
        let dto = ConsolidationDefaultFavoriteDto {
            agent_type: Some("   ".to_string()),
            preset_id: None,
        };
        let preset_id = normalize_optional(dto.preset_id);
        let agent_type = if preset_id.is_some() {
            None
        } else {
            normalize_optional(dto.agent_type)
        };
        assert!(preset_id.is_none());
        assert!(agent_type.is_none());
    }

    #[test]
    fn repository_round_trips_preset_and_clears_agent() {
        let (_dir, db) = temp_db();
        db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
            agent_type: Some("codex".to_string()),
            preset_id: None,
        })
        .unwrap();
        db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
            agent_type: None,
            preset_id: Some("preset-xyz".to_string()),
        })
        .unwrap();
        let value = db.get_consolidation_default_favorite().unwrap();
        assert!(value.agent_type.is_none());
        assert_eq!(value.preset_id.as_deref(), Some("preset-xyz"));
    }
}

#[cfg(test)]
mod generation_agent_resolution_tests {
    use super::{
        GenerationAction, resolve_generation_agent_for_action, resolve_generation_cli_args,
    };

    fn settings() -> lucode::domains::settings::GenerationSettings {
        lucode::domains::settings::GenerationSettings {
            agent: None,
            model: None,
            cli_args: None,
            name_agent: None,
            commit_agent: None,
            pr_writeback_agent: None,
            consolidation_judge_agent: None,
            version_group_rename_agent: None,
            name_prompt: None,
            commit_prompt: None,
            consolidation_prompt: None,
            review_pr_prompt: None,
            plan_issue_prompt: None,
            issue_prompt: None,
            pr_prompt: None,
            autonomy_prompt_template: None,
            force_restart_prompt_template: None,
            plan_candidate_prompt_template: None,
            plan_judge_prompt_template: None,
            judge_prompt_template: None,
        }
    }

    #[test]
    fn generation_agent_defaults_to_gemini_when_unset() {
        assert_eq!(
            resolve_generation_agent_for_action(&settings(), GenerationAction::SessionName),
            "gemini"
        );
    }

    #[test]
    fn generation_agent_uses_global_setting_when_action_override_is_unset() {
        let mut generation = settings();
        generation.agent = Some("codex".to_string());

        assert_eq!(
            resolve_generation_agent_for_action(&generation, GenerationAction::CommitMessage),
            "codex"
        );
    }

    #[test]
    fn generation_agent_prefers_action_override_over_global_setting() {
        let mut generation = settings();
        generation.agent = Some("gemini".to_string());
        generation.version_group_rename_agent = Some("claude".to_string());

        assert_eq!(
            resolve_generation_agent_for_action(&generation, GenerationAction::VersionGroupRename),
            "claude"
        );
    }

    #[test]
    fn generation_cli_args_apply_when_resolved_agent_matches_global_agent() {
        let mut generation = settings();
        generation.agent = Some("claude".to_string());
        generation.cli_args = Some("--model haiku".to_string());

        assert_eq!(
            resolve_generation_cli_args(&generation, "claude", ""),
            "--model haiku"
        );
    }

    #[test]
    fn generation_cli_args_do_not_apply_when_action_override_changes_agent() {
        let mut generation = settings();
        generation.agent = Some("gemini".to_string());
        generation.commit_agent = Some("claude".to_string());
        generation.cli_args = Some("--model gemini-2.0-flash".to_string());

        assert_eq!(resolve_generation_cli_args(&generation, "claude", ""), "");
    }
}

async fn resolve_generation_agent_and_args(
    action: GenerationAction,
) -> (
    String,
    Vec<(String, String)>,
    String,
    Option<String>,
    lucode::domains::settings::AgentPreference,
    Option<String>,
    Option<String>,
) {
    let generation_settings = if let Some(sm) = SETTINGS_MANAGER.get() {
        sm.lock().await.get_generation_settings()
    } else {
        lucode::domains::settings::GenerationSettings::default()
    };

    let agent = resolve_generation_agent_for_action(&generation_settings, action);

    let (env_vars, mut cli_args, binary_path, preferences) =
        get_agent_env_and_cli_args_async(&agent).await;

    cli_args = resolve_generation_cli_args(&generation_settings, &agent, &cli_args);

    (
        agent,
        env_vars,
        cli_args,
        binary_path,
        preferences,
        generation_settings.name_prompt,
        generation_settings.commit_prompt,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GenerationAction {
    SessionName,
    CommitMessage,
    PrWriteback,
    ConsolidationJudge,
    VersionGroupRename,
}

pub(crate) fn resolve_generation_agent_for_action(
    settings: &lucode::domains::settings::GenerationSettings,
    action: GenerationAction,
) -> String {
    let action_agent = match action {
        GenerationAction::SessionName => settings.name_agent.as_deref(),
        GenerationAction::CommitMessage => settings.commit_agent.as_deref(),
        GenerationAction::PrWriteback => settings.pr_writeback_agent.as_deref(),
        GenerationAction::ConsolidationJudge => settings.consolidation_judge_agent.as_deref(),
        GenerationAction::VersionGroupRename => settings.version_group_rename_agent.as_deref(),
    };

    action_agent
        .map(str::trim)
        .filter(|agent| !agent.is_empty())
        .unwrap_or(resolve_generation_global_agent(settings))
        .to_string()
}

fn resolve_generation_global_agent(
    settings: &lucode::domains::settings::GenerationSettings,
) -> &str {
    settings
        .agent
        .as_deref()
        .map(str::trim)
        .filter(|agent| !agent.is_empty())
        .unwrap_or("gemini")
}

fn resolve_generation_cli_args(
    settings: &lucode::domains::settings::GenerationSettings,
    resolved_agent: &str,
    base_cli_args: &str,
) -> String {
    if resolved_agent != resolve_generation_global_agent(settings) {
        return base_cli_args.to_string();
    }

    let Some(generation_cli_args) = settings.cli_args.as_deref().filter(|value| !value.is_empty())
    else {
        return base_cli_args.to_string();
    };

    if base_cli_args.is_empty() {
        generation_cli_args.to_string()
    } else {
        format!("{generation_cli_args} {base_cli_args}")
    }
}

fn spawn_session_name_generation(app_handle: tauri::AppHandle, session_name: String) {
    tokio::spawn(async move {
        let session_name_clone = session_name.clone();
        let ((session_id, worktree_path, repo_path, current_branch, initial_prompt), db_clone) = {
            let core = match get_core_read().await {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "Cannot get schaltwerk_core for session '{session_name_clone}': {e}"
                    );
                    return;
                }
            };
            let manager = core.session_manager();
            let session = match manager.get_session(&session_name_clone) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("Cannot load session '{session_name_clone}' for naming: {e}");
                    return;
                }
            };

            if !session.pending_name_generation {
                log::info!(
                    "Session '{session_name_clone}' does not have pending_name_generation flag, skipping"
                );
                return;
            }

            (
                (
                    session.id.clone(),
                    session.worktree_path.clone(),
                    session.repository_path.clone(),
                    session.branch.clone(),
                    session.initial_prompt.clone(),
                ),
                core.db.clone(),
            )
        };

        log::info!(
            "Starting name generation for session '{}' with prompt: {:?}",
            session_name_clone,
            initial_prompt.as_ref().map(|p| {
                let max_len = 50;
                if p.len() <= max_len {
                    p.as_str()
                } else {
                    let mut end = max_len;
                    while !p.is_char_boundary(end) && end > 0 {
                        end -= 1;
                    }
                    &p[..end]
                }
            })
        );

        let (agent, mut env_vars, cli_args, binary_path, _, custom_name_prompt, _) =
            resolve_generation_agent_and_args(GenerationAction::SessionName).await;

        if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
            for (key, value) in project_env_vars {
                env_vars.push((key, value));
            }
        }

        let cli_args = if cli_args.is_empty() {
            None
        } else {
            Some(cli_args)
        };

        let ctx = lucode::domains::agents::naming::SessionRenameContext {
            db: &db_clone,
            session_id: &session_id,
            worktree_path: &worktree_path,
            repo_path: &repo_path,
            current_branch: &current_branch,
            agent_type: &agent,
            initial_prompt: initial_prompt.as_deref(),
            cli_args,
            env_vars,
            binary_path,
            custom_name_prompt,
        };

        match lucode::domains::agents::naming::generate_display_name_and_rename_branch(ctx).await {
            Ok(Some(display_name)) => {
                log::info!(
                    "Successfully generated display name '{display_name}' for session '{session_name_clone}'"
                );

                if let Err(e) = db_clone.set_pending_name_generation(&session_id, false) {
                    log::warn!(
                        "Failed to clear pending_name_generation for session '{session_name_clone}': {e}"
                    );
                }

                log::info!("Queueing sessions refresh after AI name generation");
                events::request_sessions_refreshed(
                    &app_handle,
                    events::SessionsRefreshReason::SessionLifecycle,
                );
            }
            Ok(None) => {
                log::warn!("Name generation returned None for session '{session_name_clone}'");
                let _ = db_clone.set_pending_name_generation(&session_id, false);
            }
            Err(e) => {
                log::error!(
                    "Failed to generate display name for session '{session_name_clone}': {e}"
                );
                let _ = db_clone.set_pending_name_generation(&session_id, false);
            }
        }
    });
}

fn spawn_spec_name_generation(
    app_handle: tauri::AppHandle,
    spec_id: String,
    spec_name: String,
    spec_content: String,
) {
    tokio::spawn(async move {
        let (db_clone, repo_path) = match get_core_read().await {
            Ok(core) => (core.db.clone(), core.repo_path.clone()),
            Err(e) => {
                log::warn!("Cannot load core for spec '{spec_name}': {e}");
                return;
            }
        };

        let (agent, mut env_vars, cli_args, binary_path, _, custom_name_prompt, _) =
            resolve_generation_agent_and_args(GenerationAction::SessionName).await;

        if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
            env_vars.extend(project_env_vars);
        }

        let cli_args = if cli_args.is_empty() {
            None
        } else {
            Some(cli_args)
        };

        let args = lucode::domains::agents::naming::NameGenerationArgs {
            db: &db_clone,
            target_id: &spec_id,
            worktree_path: Path::new(""),
            agent_type: &agent,
            initial_prompt: Some(&spec_content),
            cli_args: cli_args.as_deref(),
            env_vars: &env_vars,
            binary_path: binary_path.as_deref(),
            custom_name_prompt: custom_name_prompt.as_deref(),
        };

        match lucode::domains::agents::naming::generate_spec_display_name(args).await {
            Ok(Some(display_name)) => {
                log::info!(
                    "Generated display name '{display_name}' for spec '{spec_name}', requesting refresh"
                );
                events::request_sessions_refreshed(
                    &app_handle,
                    events::SessionsRefreshReason::SpecSync,
                );
            }
            Ok(None) => {
                log::info!("Name generation skipped or empty for spec '{spec_name}'");
            }
            Err(e) => {
                log::warn!("Failed to generate display name for spec '{spec_name}': {e}");
            }
        }
    });
}

fn should_spawn_spec_name_generation(user_edited_name: Option<bool>) -> bool {
    !user_edited_name.unwrap_or(false)
}

#[tauri::command]
pub async fn schaltwerk_core_generate_session_name(
    content: String,
    _agent_type: Option<String>,
) -> Result<Option<String>, String> {
    let (db_clone, repo_path) = match get_core_read().await {
        Ok(core) => (core.db.clone(), core.repo_path.clone()),
        Err(e) => {
            return Err(format!("Cannot load core for name generation: {e}"));
        }
    };

    let (agent, mut env_vars, cli_args, binary_path, _, custom_name_prompt, _) =
        resolve_generation_agent_and_args(GenerationAction::SessionName).await;

    if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
        env_vars.extend(project_env_vars);
    }

    let cli_args = if cli_args.is_empty() {
        None
    } else {
        Some(cli_args)
    };

    let args = lucode::domains::agents::naming::NameGenerationArgs {
        db: &db_clone,
        target_id: "namegen-preview",
        worktree_path: Path::new(""),
        agent_type: &agent,
        initial_prompt: Some(&content),
        cli_args: cli_args.as_deref(),
        env_vars: &env_vars,
        binary_path: binary_path.as_deref(),
        custom_name_prompt: custom_name_prompt.as_deref(),
    };

    lucode::domains::agents::naming::generate_name_only(args)
        .await
        .map_err(|e| format!("Name generation failed: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_generate_commit_message(
    session_name: String,
    project_path: Option<String>,
) -> Result<Option<String>, String> {
    let (db_clone, repo_path, session) = {
        let core = get_core_read_for_project_path(project_path.as_deref())
            .await
            .map_err(|e| format!("Cannot load core: {e}"))?;
        let manager = core.session_manager();
        let session = manager
            .get_session(&session_name)
            .map_err(|e| format!("Session not found: {e}"))?;
        (core.db.clone(), core.repo_path.clone(), session)
    };

    let worktree_path = session.worktree_path.clone();
    let parent_branch = session.parent_branch.clone();
    let commit_subjects = tokio::task::spawn_blocking({
        let wt = worktree_path.clone();
        let parent = parent_branch.clone();
        move || -> Vec<String> {
            let repo = match git2::Repository::open(&wt) {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("Failed to open repo for commit log: {e}");
                    return vec![];
                }
            };
            let head_oid = match repo.head().and_then(|r| r.peel_to_commit().map(|c| c.id())) {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let parent_oid = match repo
                .revparse_single(&parent)
                .and_then(|o| o.peel_to_commit().map(|c| c.id()))
            {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let merge_base = match repo.merge_base(head_oid, parent_oid) {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let mut revwalk = match repo.revwalk() {
                Ok(rw) => rw,
                Err(_) => return vec![],
            };
            let _ = revwalk.push(head_oid);
            let _ = revwalk.hide(merge_base);
            revwalk
                .filter_map(|oid| oid.ok())
                .filter_map(|oid| repo.find_commit(oid).ok())
                .take(50)
                .filter_map(|c| c.summary().map(|s| s.to_string()))
                .collect()
        }
    })
    .await
    .unwrap_or_default();

    let changed_files_summary = tokio::task::spawn_blocking({
        let wt = worktree_path.clone();
        let parent = parent_branch.clone();
        move || -> String {
            match lucode::domains::git::stats::get_changed_files(&wt, &parent) {
                Ok(files) => {
                    let limited: Vec<_> = files.iter().take(50).collect();
                    limited
                        .iter()
                        .map(|f| {
                            let change = match f.change_type.as_str() {
                                "added" => "A",
                                "deleted" => "D",
                                "renamed" => "R",
                                _ => "M",
                            };
                            format!("{} {} (+{} -{})", change, f.path, f.additions, f.deletions)
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                }
                Err(e) => {
                    log::warn!("Failed to get changed files: {e}");
                    String::new()
                }
            }
        }
    })
    .await
    .unwrap_or_default();

    if commit_subjects.is_empty() && changed_files_summary.is_empty() {
        return Ok(None);
    }

    let (agent_type_str, mut env_vars, cli_args, binary_path, _, _, custom_commit_prompt) =
        resolve_generation_agent_and_args(GenerationAction::CommitMessage).await;

    if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
        env_vars.extend(project_env_vars);
    }

    let cli_args_opt = if cli_args.is_empty() {
        None
    } else {
        Some(cli_args)
    };

    let args = lucode::domains::agents::commit_message::CommitMessageArgs {
        agent_type: &agent_type_str,
        commit_subjects: &commit_subjects,
        changed_files_summary: &changed_files_summary,
        cli_args: cli_args_opt.as_deref(),
        env_vars: &env_vars,
        binary_path: binary_path.as_deref(),
        custom_commit_prompt: custom_commit_prompt.as_deref(),
    };

    lucode::domains::agents::commit_message::generate_commit_message(args)
        .await
        .map_err(|e| format!("Commit message generation failed: {e}"))
}

#[tauri::command]
pub async fn forge_generate_writeback(
    session_name: String,
    project_path: Option<String>,
) -> Result<Option<String>, String> {
    let (db_clone, repo_path, session) = {
        let core = get_core_read_for_project_path(project_path.as_deref())
            .await
            .map_err(|e| format!("Cannot load core: {e}"))?;
        let manager = core.session_manager();
        let session = manager
            .get_session(&session_name)
            .map_err(|e| format!("Session not found: {e}"))?;
        (core.db.clone(), core.repo_path.clone(), session)
    };

    let worktree_path = session.worktree_path.clone();
    let parent_branch = session.parent_branch.clone();
    let commit_subjects = tokio::task::spawn_blocking({
        let wt = worktree_path.clone();
        let parent = parent_branch.clone();
        move || -> Vec<String> {
            let repo = match git2::Repository::open(&wt) {
                Ok(r) => r,
                Err(_) => return vec![],
            };
            let head_oid = match repo.head().and_then(|r| r.peel_to_commit().map(|c| c.id())) {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let parent_oid = match repo
                .revparse_single(&parent)
                .and_then(|o| o.peel_to_commit().map(|c| c.id()))
            {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let merge_base = match repo.merge_base(head_oid, parent_oid) {
                Ok(oid) => oid,
                Err(_) => return vec![],
            };
            let mut revwalk = match repo.revwalk() {
                Ok(rw) => rw,
                Err(_) => return vec![],
            };
            let _ = revwalk.push(head_oid);
            let _ = revwalk.hide(merge_base);
            revwalk
                .filter_map(|oid| oid.ok())
                .filter_map(|oid| repo.find_commit(oid).ok())
                .take(50)
                .filter_map(|c| c.summary().map(|s| s.to_string()))
                .collect()
        }
    })
    .await
    .map_err(|e| format!("Failed to read commit log: {e}"))?;

    let changed_files_summary = tokio::task::spawn_blocking({
        let wt = worktree_path.clone();
        let parent = parent_branch.clone();
        move || -> String {
            let repo = match git2::Repository::open(&wt) {
                Ok(r) => r,
                Err(_) => return String::new(),
            };
            let head = match repo.head().and_then(|r| r.peel_to_tree()) {
                Ok(t) => t,
                Err(_) => return String::new(),
            };
            let parent_tree = match repo.revparse_single(&parent).and_then(|o| o.peel_to_tree()) {
                Ok(t) => t,
                Err(_) => return String::new(),
            };
            let diff = match repo.diff_tree_to_tree(Some(&parent_tree), Some(&head), None) {
                Ok(d) => d,
                Err(_) => return String::new(),
            };
            let stats = match diff.stats() {
                Ok(s) => s,
                Err(_) => return String::new(),
            };
            format!(
                "{} files changed, {} insertions(+), {} deletions(-)",
                stats.files_changed(),
                stats.insertions(),
                stats.deletions()
            )
        }
    })
    .await
    .map_err(|e| format!("Failed to read diff stats: {e}"))?;

    let (agent_type_str, mut env_vars, cli_args, binary_path, _, _, _) =
        resolve_generation_agent_and_args(GenerationAction::PrWriteback).await;

    if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
        env_vars.extend(project_env_vars);
    }

    let cli_args_opt = if cli_args.is_empty() {
        None
    } else {
        Some(cli_args)
    };

    let writeback_prompt = "Summarize the changes in this session in a short markdown comment suitable for posting to the linked issue or pull request. Focus on what changed and why. Plain prose, no signatures, no code blocks unless essential. Keep it under 200 words.";

    let args = lucode::domains::agents::commit_message::CommitMessageArgs {
        agent_type: &agent_type_str,
        commit_subjects: &commit_subjects,
        changed_files_summary: &changed_files_summary,
        cli_args: cli_args_opt.as_deref(),
        env_vars: &env_vars,
        binary_path: binary_path.as_deref(),
        custom_commit_prompt: Some(writeback_prompt),
    };

    lucode::domains::agents::commit_message::generate_commit_message(args)
        .await
        .map_err(|e| format!("Writeback generation failed: {e}"))
}

async fn session_manager_read(project_path: Option<&str>) -> Result<SessionManager, String> {
    Ok(get_core_read_for_project_path(project_path)
        .await?
        .session_manager())
}

// CLI helpers live in schaltwerk_core_cli.rs and are consumed by agent_ctx

// CODEX FLAG NORMALIZATION - Why It's Needed:
//
// Codex has inconsistent CLI flag handling that differs from standard Unix conventions:
// 1. Users often type `-model` expecting it to work like `--model`, but Codex only accepts
//    the double-dash form for long flags (or the short form `-m`)
// 2. The `--profile` flag must appear BEFORE `--model` in the argument list for Codex to
//    properly apply profile settings that might override the model
// 3. This normalization ensures user intent is preserved regardless of how they type flags
//
// Examples of what this fixes:
// - User types: `-model gpt-4` → Normalized to: `--model gpt-4`
// - User types: `-profile work -model gpt-4` → Reordered so profile comes first
// - Short flags like `-m` and `-p` are preserved as-is (they work correctly)
//
// Without this normalization, Codex would silently ignore malformed flags, leading to
// unexpected behavior where the wrong model or profile is used.

// Turn accidental single-dash long options into proper double-dash for Codex
// Only affects known long flags: model, profile. Keeps true short flags intact.
// (no local wrappers needed)

#[tauri::command]
pub async fn schaltwerk_core_list_enriched_sessions(
    services: State<'_, ServiceHandles>,
) -> Result<Vec<EnrichedSession>, String> {
    let call_id = Uuid::new_v4();
    let start = Instant::now();
    log::info!("list_enriched_sessions call_id={call_id} stage=start");

    let result = services.sessions.list_enriched_sessions().await;

    match &result {
        Ok(list) => log::info!(
            "list_enriched_sessions call_id={call_id} stage=done count={} elapsed={}ms",
            list.len(),
            start.elapsed().as_millis()
        ),
        Err(err) => log::error!(
            "list_enriched_sessions call_id={call_id} stage=error elapsed={}ms error={}",
            start.elapsed().as_millis(),
            err
        ),
    }

    result
}

#[tauri::command]
pub async fn schaltwerk_core_get_merge_preview(
    name: String,
    project_path: Option<String>,
) -> Result<MergePreview, String> {
    let (db, repo_path) = {
        let core = get_core_read_for_project_path(project_path.as_deref()).await?;
        (core.db.clone(), core.repo_path.clone())
    };

    let service = MergeService::new(db, repo_path);
    service.preview(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn schaltwerk_core_get_merge_preview_with_worktree(
    name: String,
    project_path: Option<String>,
) -> Result<MergePreview, String> {
    let (db, repo_path) = {
        let core = get_core_read_for_project_path(project_path.as_deref()).await?;
        (core.db.clone(), core.repo_path.clone())
    };

    let service = MergeService::new(db, repo_path);
    service
        .preview_with_worktree(&name)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone)]
pub struct MergeCommandError {
    pub message: String,
    pub conflict: bool,
    pub conflicting_paths: Vec<String>,
}

pub async fn merge_session_with_events(
    app: &tauri::AppHandle,
    name: &str,
    mode: MergeMode,
    commit_message: Option<String>,
    project_path: Option<&str>,
) -> Result<MergeOutcome, MergeCommandError> {
    let (db, repo_path) = match get_core_write_for_project_path(project_path).await {
        Ok(core) => (core.db.clone(), core.repo_path.clone()),
        Err(e) => {
            return Err(MergeCommandError {
                message: e,
                conflict: false,
                conflicting_paths: Vec::new(),
            });
        }
    };

    let service = MergeService::new(db, repo_path);
    let manager = service.session_manager();

    let session = manager.get_session(name).map_err(|e| MergeCommandError {
        message: e.to_string(),
        conflict: false,
        conflicting_paths: Vec::new(),
    })?;
    let session_project_path = session.repository_path.to_string_lossy().to_string();

    events::emit_git_operation_started(
        app,
        name,
        &session_project_path,
        &session.branch,
        &session.parent_branch,
        mode.as_str(),
    );

    match service
        .merge_from_modal(name, mode, commit_message.clone())
        .await
    {
        Ok(outcome) => {
            events::emit_git_operation_completed(
                app,
                name,
                &session_project_path,
                &outcome.session_branch,
                &outcome.parent_branch,
                outcome.mode.as_str(),
                &outcome.new_commit,
            );
            events::request_sessions_refreshed(app, events::SessionsRefreshReason::MergeWorkflow);
            Ok(outcome)
        }
        Err(err) => {
            let raw_message = err.to_string();
            let conflict = is_conflict_error(&raw_message);
            let conflicting_paths = if conflict {
                resolve_conflicting_paths(&raw_message, &session.worktree_path)
            } else {
                Vec::new()
            };
            let summary = summarize_error(&raw_message);
            let message = if conflict {
                format!(
                    "Merge conflicts detected while updating '{}'. Resolve the conflicts in the session worktree and try again.\n{}",
                    session.parent_branch, summary
                )
            } else {
                summary.clone()
            };

            if conflict {
                let manager = service.session_manager();
                if let Ok(session) = manager.get_session(name)
                    && session.worktree_path.exists()
                    && let Ok(stats) = lucode::domains::git::service::calculate_git_stats_fast(
                        &session.worktree_path,
                        &session.parent_branch,
                    )
                {
                    let preview = service.preview_with_worktree(name).ok();
                    let mut merge_snapshot = MergeStateSnapshot::from_preview(preview.as_ref());
                    merge_snapshot.merge_has_conflicts = Some(true);
                    if merge_snapshot.merge_conflicting_paths.is_none()
                        && !conflicting_paths.is_empty()
                    {
                        merge_snapshot.merge_conflicting_paths = Some(conflicting_paths.clone());
                    }

                    let payload = lucode::domains::sessions::activity::SessionGitStatsUpdated {
                        session_id: session.id.clone(),
                        session_name: session.name.clone(),
                        project_path: session.repository_path.to_string_lossy().to_string(),
                        files_changed: stats.files_changed,
                        lines_added: stats.lines_added,
                        lines_removed: stats.lines_removed,
                        has_uncommitted: stats.has_uncommitted,
                        dirty_files_count: Some(stats.dirty_files_count),
                        commits_ahead_count: preview
                            .as_ref()
                            .map(|value| value.commits_ahead_count),
                        has_conflicts: stats.has_conflicts,
                        top_uncommitted_paths: None,
                        merge_has_conflicts: merge_snapshot.merge_has_conflicts,
                        merge_conflicting_paths: merge_snapshot.merge_conflicting_paths,
                        merge_is_up_to_date: merge_snapshot.merge_is_up_to_date,
                        ready_to_merge: None,
                        ready_to_merge_checks: None,
                    };

                    if let Err(err) = emit_event(app, SchaltEvent::SessionGitStats, &payload) {
                        log::debug!(
                            "Failed to emit SessionGitStats after merge failure for {}: {}",
                            session.name,
                            err
                        );
                    }
                }
            }

            events::emit_git_operation_failed(
                app,
                events::GitOperationFailure {
                    session_name: name,
                    project_path: &session_project_path,
                    session_branch: &session.branch,
                    parent_branch: &session.parent_branch,
                    mode: mode.as_str(),
                    status: if conflict { "conflict" } else { "error" },
                    error: &message,
                },
            );
            Err(MergeCommandError {
                message,
                conflict,
                conflicting_paths,
            })
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_merge_session_to_main(
    app: tauri::AppHandle,
    name: String,
    mode: MergeMode,
    commit_message: Option<String>,
    project_path: Option<String>,
) -> Result<(), SchaltError> {
    merge_session_with_events(&app, &name, mode, commit_message, project_path.as_deref())
        .await
        .map(|_| ())
        .map_err(|err| {
            if err.conflict {
                SchaltError::MergeConflict {
                    files: err.conflicting_paths,
                    message: err.message,
                }
            } else {
                SchaltError::GitOperationFailed {
                    operation: "merge_session_to_main".to_string(),
                    message: err.message,
                }
            }
        })
}

#[tauri::command]
pub async fn schaltwerk_core_update_session_from_parent(
    name: String,
    project_path: Option<String>,
) -> Result<lucode::services::UpdateSessionFromParentResult, String> {
    let core = get_core_read_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Session not found: {e}"))?;

    if session.session_state == SessionState::Spec {
        return Ok(lucode::services::UpdateSessionFromParentResult {
            status: lucode::services::UpdateFromParentStatus::NoSession,
            parent_branch: session.parent_branch.clone(),
            message: "Cannot update a spec session".to_string(),
            conflicting_paths: Vec::new(),
        });
    }

    let result = lucode::services::update_session_from_parent(
        &session.name,
        &session.worktree_path,
        &session.repository_path,
        &session.parent_branch,
    );

    Ok(result)
}

#[tauri::command]
pub async fn restart_session_terminals(session_name: String) -> Result<(), String> {
    log::info!("Restarting terminals for session: {session_name}");
    terminals::close_session_terminals_if_any(&session_name).await;
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_archive_spec_session(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    let (repo, count) = {
        let core = get_core_write().await?;
        let manager = core.session_manager();
        manager
            .archive_spec_session(&name)
            .map_err(|e| format!("Failed to archive spec: {e}"))?;
        let repo = core.repo_path.to_string_lossy().to_string();
        let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
        (repo, count)
    };
    events::emit_archive_updated(&app, &repo, count);
    // Also emit a SessionRemoved event so the frontend can compute the next selection consistently
    events::emit_session_removed(&app, &name);
    evict_session_cache_entry_for_repo(&repo, &name).await;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_archived_specs()
-> Result<Vec<lucode::domains::sessions::entity::ArchivedSpec>, String> {
    let manager = session_manager_read(None).await?;
    manager
        .list_archived_specs()
        .map_err(|e| format!("Failed to list archived specs: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_restore_archived_spec(
    app: tauri::AppHandle,
    id: String,
    new_name: Option<String>,
) -> Result<Session, String> {
    let (spec_name, repo, count) = {
        let core = get_core_write().await?;
        let manager = core.session_manager();
        let spec = manager
            .restore_archived_spec(&id, new_name.as_deref())
            .map_err(|e| format!("Failed to restore archived spec: {e}"))?;
        let repo = core.repo_path.to_string_lossy().to_string();
        let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
        (spec.name, repo, count)
    };
    events::emit_archive_updated(&app, &repo, count);
    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    let core = get_core_write().await?;
    let manager = core.session_manager();
    let session = manager
        .list_sessions_by_state(SessionState::Spec)
        .map_err(|e| format!("Failed to list specs: {e}"))?
        .into_iter()
        .find(|s| s.name == spec_name)
        .ok_or_else(|| "Spec session not found after restore".to_string())?;

    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_delete_archived_spec(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let (repo, count) = {
        let core = get_core_write().await?;
        let manager = core.session_manager();
        manager
            .delete_archived_spec(&id)
            .map_err(|e| format!("Failed to delete archived spec: {e}"))?;
        let repo = core.repo_path.to_string_lossy().to_string();
        let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
        (repo, count)
    };
    events::emit_archive_updated(&app, &repo, count);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_archive_max_entries() -> Result<i32, String> {
    let manager = session_manager_read(None).await?;
    manager
        .get_archive_max_entries()
        .map_err(|e| format!("Failed to get archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_archive_max_entries(limit: i32) -> Result<(), String> {
    let manager = {
        let core = get_core_write().await?;
        core.session_manager()
    };
    manager
        .set_archive_max_entries(limit)
        .map_err(|e| format!("Failed to set archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_project_files(
    app: tauri::AppHandle,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    let force_refresh = force_refresh.unwrap_or(false);

    let repo_path = {
        let core = get_core_read().await?;
        core.repo_path.clone()
    };

    let (files, refreshed) = get_project_files_with_status(&repo_path, force_refresh)
        .map_err(|e| format!("Failed to list project files: {e}"))?;

    if refreshed {
        let _ = emit_event(&app, SchaltEvent::ProjectFilesUpdated, &files);
    }

    Ok(files)
}

#[tauri::command]
pub async fn schaltwerk_core_list_enriched_sessions_sorted(
    sort_mode: String,
    filter_mode: String,
) -> Result<Vec<EnrichedSession>, String> {
    let call_id = Uuid::new_v4();
    let start = Instant::now();
    log::info!(
        "list_enriched_sessions_sorted call_id={call_id} stage=start sort={sort_mode} filter={filter_mode}"
    );

    let sort_mode_str = sort_mode.clone();
    let filter_mode_str = filter_mode.clone();
    let sort_mode = sort_mode
        .parse::<SortMode>()
        .map_err(|e| format!("Invalid sort mode '{sort_mode_str}': {e}"))?;
    let filter_mode = filter_mode_str
        .parse::<FilterMode>()
        .map_err(|e| format!("Invalid filter mode '{filter_mode_str}': {e}"))?;

    let manager = session_manager_read(None).await?;

    let result = manager.list_enriched_sessions_sorted(sort_mode, filter_mode);

    match &result {
        Ok(sessions) => log::info!(
            "list_enriched_sessions_sorted call_id={call_id} stage=done count={} elapsed={}ms",
            sessions.len(),
            start.elapsed().as_millis()
        ),
        Err(e) => log::error!(
            "list_enriched_sessions_sorted call_id={call_id} stage=error elapsed={}ms error={}",
            start.elapsed().as_millis(),
            e
        ),
    }

    result.map_err(|e| format!("Failed to get sorted sessions: {e}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionParams {
    name: String,
    prompt: Option<String>,
    base_branch: Option<String>,
    custom_branch: Option<String>,
    use_existing_branch: Option<bool>,
    sync_with_origin: Option<bool>,
    user_edited_name: Option<bool>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    epic_id: Option<String>,
    agent_type: Option<String>,
    autonomy_enabled: Option<bool>,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    pr_number: Option<i64>,
    is_consolidation: Option<bool>,
    consolidation_source_ids: Option<Vec<String>>,
    consolidation_round_id: Option<String>,
    consolidation_role: Option<String>,
    consolidation_confirmation_mode: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schaltwerk_core_create_session(
    app: tauri::AppHandle,
    name: String,
    prompt: Option<String>,
    base_branch: Option<String>,
    custom_branch: Option<String>,
    use_existing_branch: Option<bool>,
    sync_with_origin: Option<bool>,
    user_edited_name: Option<bool>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    epic_id: Option<String>,
    agent_type: Option<String>,
    autonomy_enabled: Option<bool>,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    pr_number: Option<i64>,
    is_consolidation: Option<bool>,
    consolidation_source_ids: Option<Vec<String>>,
    consolidation_round_id: Option<String>,
    consolidation_role: Option<String>,
    consolidation_confirmation_mode: Option<String>,
) -> Result<Session, SchaltError> {
    let params = CreateSessionParams {
        name,
        prompt,
        base_branch,
        custom_branch,
        use_existing_branch,
        sync_with_origin,
        user_edited_name,
        version_group_id,
        version_number,
        epic_id,
        agent_type,
        autonomy_enabled,
        issue_number,
        issue_url,
        pr_number,
        is_consolidation,
        consolidation_source_ids,
        consolidation_round_id,
        consolidation_role,
        consolidation_confirmation_mode,
    };
    let was_user_edited = params.user_edited_name.unwrap_or(false);
    let was_auto_generated = !was_user_edited;

    let autonomy_template = {
        let settings_manager = get_settings_manager(&app)
            .await
            .map_err(|message| SchaltError::DatabaseError { message })?;
        let manager = settings_manager.lock().await;
        manager
            .get_generation_settings()
            .autonomy_prompt_template
            .unwrap_or_else(lucode::domains::settings::default_autonomy_prompt_template)
    };
    let expanded_prompt = lucode::domains::sessions::autonomy::build_initial_prompt(
        params.prompt.as_deref(),
        params.autonomy_enabled.unwrap_or(false),
        &autonomy_template,
    );

    let creation_params = lucode::domains::sessions::service::SessionCreationParams {
        name: &params.name,
        prompt: expanded_prompt.as_deref(),
        base_branch: params.base_branch.as_deref(),
        custom_branch: params.custom_branch.as_deref(),
        use_existing_branch: params.use_existing_branch.unwrap_or(false),
        sync_with_origin: params.sync_with_origin.unwrap_or(false),
        was_auto_generated,
        version_group_id: params.version_group_id.as_deref(),
        version_number: params.version_number,
        epic_id: params.epic_id.as_deref(),
        agent_type: params.agent_type.as_deref(),
        pr_number: params.pr_number,
        is_consolidation: params.is_consolidation.unwrap_or(false),
        consolidation_source_ids: params.consolidation_source_ids,
        consolidation_round_id: params.consolidation_round_id.as_deref(),
        consolidation_role: params.consolidation_role.as_deref(),
        consolidation_confirmation_mode: params.consolidation_confirmation_mode.as_deref(),
    };
    let (session, epic) = {
        let core = get_core_write()
            .await
            .map_err(|e| SchaltError::DatabaseError {
                message: e.to_string(),
            })?;
        let manager = core.session_manager();
        let session = manager
            .create_session_with_agent(creation_params)
            .map_err(|e| {
                let msg = e.to_string();
                if msg.to_lowercase().contains("already exists") {
                    SchaltError::SessionAlreadyExists {
                        session_id: params.name.clone(),
                    }
                } else {
                    SchaltError::DatabaseError { message: msg }
                }
            })?;
        let epic = session
            .epic_id
            .as_deref()
            .and_then(|epic_id| manager.get_epic_by_id(epic_id).ok());
        if params.issue_number.is_some() || params.issue_url.is_some() {
            core.db
                .update_session_issue_info(
                    &session.id,
                    params.issue_number,
                    params.issue_url.as_deref(),
                )
                .map_err(|e| SchaltError::DatabaseError {
                    message: format!("Failed to persist session issue metadata: {e}"),
                })?;
        }
        (session, epic)
    };

    let session_name_clone = session.name.clone();
    let app_handle = app.clone();

    if session.is_consolidation
        && let (Some(round_id), Some(group_id), Some(source_ids), Some(mode)) = (
            session.consolidation_round_id.as_deref(),
            session.version_group_id.as_deref(),
            session.consolidation_sources.as_ref(),
            session.consolidation_confirmation_mode.as_deref(),
        )
        && let Err(err) = upsert_consolidation_round(
            &get_core_read()
                .await
                .map_err(|e| SchaltError::DatabaseError {
                    message: e.to_string(),
                })?
                .db,
            session.repository_path.as_path(),
            round_id,
            group_id,
            source_ids,
            mode,
        )
    {
        return Err(SchaltError::DatabaseError {
            message: format!("Failed to persist consolidation round: {err}"),
        });
    }

    let _ = emit_event(
        &app,
        SchaltEvent::SessionAdded,
        &build_session_added_payload(&session, epic),
    );

    // Only trigger auto-rename for standalone sessions (not part of a version group).
    // Version group sessions are renamed together via schaltwerk_core_rename_version_group.
    if was_auto_generated && params.version_group_id.is_none() {
        log::info!(
            "Session '{}' was auto-generated (no version group), spawning name generation agent",
            params.name
        );
        spawn_session_name_generation(app_handle, session_name_clone);
    } else {
        log::info!(
            "Session '{}' was_auto_generated={}, version_group={}, skipping individual name generation",
            params.name,
            was_auto_generated,
            params.version_group_id.is_some()
        );
    }

    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_trigger_consolidation_judge(
    app: tauri::AppHandle,
    round_id: String,
    early: Option<bool>,
) -> Result<TriggerConsolidationJudgeResponse, String> {
    trigger_consolidation_judge_inner(&app, &round_id, early.unwrap_or(false))
        .await
        .map_err(|(_, message)| message)
}

#[tauri::command]
pub async fn schaltwerk_core_start_improve_plan_round(
    app: tauri::AppHandle,
    name: String,
    agent_type: Option<String>,
    base_branch: Option<String>,
    confirmation_mode: Option<String>,
) -> Result<ImprovePlanRoundResponse, String> {
    start_improve_plan_round_inner(
        &app,
        &name,
        StartImprovePlanRoundParams {
            agent_type,
            base_branch,
            confirmation_mode,
        },
    )
    .await
    .map_err(|(_, message)| message)
}

#[tauri::command]
pub async fn schaltwerk_core_confirm_consolidation_winner(
    app: tauri::AppHandle,
    round_id: String,
    winner_session_id: String,
    override_reason: Option<String>,
) -> Result<ConfirmConsolidationWinnerResponse, String> {
    confirm_consolidation_winner_inner(
        &app,
        &round_id,
        &winner_session_id,
        override_reason.as_deref(),
        "user",
    )
    .await
    .map_err(|(_, message)| message)
}

#[tauri::command]
pub async fn schaltwerk_core_get_consolidation_stats(
    repository_path: Option<String>,
    vertical: Option<String>,
) -> Result<ConsolidationStats, String> {
    let core = get_core_read_for_project_path(repository_path.as_deref()).await?;
    let repo =
        lucode::domains::sessions::SessionDbManager::new(core.db.clone(), core.repo_path.clone());
    repo.get_consolidation_stats(ConsolidationStatsFilter {
        repository_path,
        vertical,
    })
    .map_err(|err| format!("Failed to load consolidation stats: {err}"))
}

#[tauri::command]
pub async fn schaltwerk_core_update_consolidation_outcome_vertical(
    round_id: String,
    vertical: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let repo =
        lucode::domains::sessions::SessionDbManager::new(core.db.clone(), core.repo_path.clone());
    repo.update_consolidation_outcome_vertical(&round_id, &vertical)
        .map_err(|err| format!("Failed to update consolidation outcome vertical: {err}"))
}

#[tauri::command]
pub async fn schaltwerk_core_rename_version_group(
    app: tauri::AppHandle,
    base_name: String,
    prompt: String,
    _base_branch: Option<String>,
    version_group_id: Option<String>,
) -> Result<(), String> {
    log::info!("=== RENAME VERSION GROUP CALLED ===");
    log::info!("Base name: '{base_name}'");

    // Get all sessions with this base name pattern
    let (all_sessions, db) = {
        let core = get_core_read().await?;
        let manager = core.session_manager();
        let sessions = manager
            .list_sessions()
            .map_err(|e| format!("Failed to list sessions: {e}"))?;
        (sessions, core.db.clone())
    };

    // Prefer grouping by version_group_id if provided
    let version_sessions: Vec<Session> = if let Some(group_id) = &version_group_id {
        let filtered: Vec<Session> = all_sessions
            .iter()
            .filter(|s| s.version_group_id.as_ref() == Some(group_id))
            .cloned()
            .collect();
        if filtered.is_empty() {
            log::warn!(
                "No sessions found for version_group_id '{group_id}', falling back to name-based matching"
            );
            Vec::new()
        } else {
            filtered
        }
    } else {
        Vec::new()
    };

    let version_sessions: Vec<Session> = if version_sessions.is_empty() {
        // Fallback to name-based matching for backward compatibility
        all_sessions
            .into_iter()
            .filter(|s| s.name == base_name || matches_version_pattern(&s.name, &base_name))
            .collect()
    } else {
        version_sessions
    };

    if version_sessions.is_empty() {
        log::warn!("No version sessions found for base name '{base_name}'");
        return Ok(());
    }

    log::info!(
        "Found {} version sessions for base name '{base_name}'",
        version_sessions.len()
    );

    // Get the first session's details for name generation
    let first_session = &version_sessions[0];
    let worktree_path = first_session.worktree_path.clone();
    let repo_path = first_session.repository_path.clone();
    let (agent_type, mut env_vars, cli_args, binary_path, _preferences, custom_name_prompt, _) =
        resolve_generation_agent_and_args(GenerationAction::VersionGroupRename).await;

    if let Ok(project_env_vars) = db.get_project_environment_variables(&repo_path) {
        for (key, value) in project_env_vars {
            env_vars.push((key, value));
        }
    }

    let name_args = lucode::domains::agents::naming::NameGenerationArgs {
        db: &db,
        target_id: &first_session.id,
        worktree_path: &worktree_path,
        agent_type: &agent_type,
        initial_prompt: Some(&prompt),
        cli_args: if cli_args.is_empty() {
            None
        } else {
            Some(cli_args.as_str())
        },
        env_vars: &env_vars,
        binary_path: binary_path.as_deref(),
        custom_name_prompt: custom_name_prompt.as_deref(),
    };

    let generated_name =
        match lucode::domains::agents::naming::generate_display_name(name_args).await {
            Ok(Some(name)) => name,
            Ok(None) => {
                log::warn!("Name generation returned None for version group '{base_name}'");
                return Ok(());
            }
            Err(e) => {
                log::error!("Failed to generate display name for version group '{base_name}': {e}");
                return Err(format!("Failed to generate name: {e}"));
            }
        };

    log::info!("Generated name '{generated_name}' for version group '{base_name}'");

    let branch_prefix = db
        .get_project_branch_prefix(&repo_path)
        .unwrap_or_else(|err| {
            log::warn!("Falling back to default branch prefix while renaming sessions: {err}");
            DEFAULT_BRANCH_PREFIX.to_string()
        });

    for session in version_sessions {
        // Extract version suffix
        let version_suffix = session.name.strip_prefix(&base_name).unwrap_or("");
        let new_session_name = format!("{generated_name}{version_suffix}");
        let new_branch_name = format_branch_name(&branch_prefix, &new_session_name);

        log::info!(
            "Renaming session '{}' to '{new_session_name}'",
            session.name
        );

        // Update display name in database
        if let Err(e) = db.update_session_display_name(&session.id, &new_session_name) {
            log::error!(
                "Failed to update display name for session '{}': {e}",
                session.name
            );
        }

        // Rename the git branch
        if session.branch != new_branch_name {
            match lucode::domains::git::branches::rename_branch(
                &repo_path,
                &session.branch,
                &new_branch_name,
            ) {
                Ok(()) => {
                    log::info!(
                        "Renamed branch from '{}' to '{new_branch_name}'",
                        session.branch
                    );

                    // Update worktree to use new branch
                    if let Err(e) = lucode::services::worktrees::update_worktree_branch(
                        &session.worktree_path,
                        &new_branch_name,
                    ) {
                        log::error!("Failed to update worktree for new branch: {e}");
                    }

                    // Update branch name in database
                    if let Err(e) = db.update_session_branch(&session.id, &new_branch_name) {
                        log::error!("Failed to update branch name in database: {e}");
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Could not rename branch for session '{}': {e}",
                        session.name
                    );
                }
            }
        }

        // Clear pending name generation flag
        let _ = db.set_pending_name_generation(&session.id, false);
    }

    log::info!("Queueing sessions refresh after version group rename");
    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions() -> Result<Vec<Session>, String> {
    session_manager_read(None)
        .await?
        .list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_epics()
-> Result<Vec<lucode::domains::sessions::entity::Epic>, String> {
    session_manager_read(None)
        .await?
        .list_epics()
        .map_err(|e| format!("Failed to list epics: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_create_epic(
    app: tauri::AppHandle,
    name: String,
    color: Option<String>,
) -> Result<lucode::domains::sessions::entity::Epic, String> {
    let core = get_core_write().await?;
    let manager = core.session_manager();

    let epic = manager
        .create_epic(&name, color.as_deref())
        .map_err(|e| format!("Failed to create epic: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::Unknown);
    Ok(epic)
}

#[tauri::command]
pub async fn schaltwerk_core_update_epic(
    app: tauri::AppHandle,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<lucode::domains::sessions::entity::Epic, String> {
    let core = get_core_write().await?;
    let manager = core.session_manager();

    let epic = manager
        .update_epic(&id, &name, color.as_deref())
        .map_err(|e| format!("Failed to update epic: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::Unknown);
    Ok(epic)
}

#[tauri::command]
pub async fn schaltwerk_core_delete_epic(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let core = get_core_write().await?;
    let manager = core.session_manager();
    manager
        .delete_epic(&id)
        .map_err(|e| format!("Failed to delete epic: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::Unknown);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_set_item_epic(
    app: tauri::AppHandle,
    name: String,
    epic_id: Option<String>,
) -> Result<(), String> {
    let core = get_core_write().await?;
    let manager = core.session_manager();
    manager
        .set_item_epic(&name, epic_id.as_deref())
        .map_err(|e| format!("Failed to set epic: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::Unknown);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_session(
    name: String,
    project_path: Option<String>,
) -> Result<Session, SchaltError> {
    let manager = session_manager_read(project_path.as_deref())
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?;
    manager
        .get_session(&name)
        .map_err(|_| SchaltError::SessionNotFound {
            session_id: name.clone(),
        })
}

#[tauri::command]
pub async fn schaltwerk_core_get_spec(
    name: String,
    project_path: Option<String>,
) -> Result<lucode::domains::sessions::entity::Spec, SchaltError> {
    let manager = session_manager_read(project_path.as_deref())
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?;

    manager
        .get_spec(&name)
        .map_err(|_| SchaltError::SessionNotFound {
            session_id: name.clone(),
        })
}

#[tauri::command]
pub async fn schaltwerk_core_get_session_agent_content(
    name: String,
    project_path: Option<String>,
) -> Result<(Option<String>, Option<String>), SchaltError> {
    session_manager_read(project_path.as_deref())
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?
        .get_session_task_content(&name)
        .map_err(|e| SchaltError::from_session_lookup(&name, e))
}

#[tauri::command]
pub async fn schaltwerk_core_cancel_session(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
) -> Result<(), SchaltError> {
    log::info!("Starting cancel session: {name}");

    let (is_spec, repo_path_str, archive_count_after_opt) = {
        let core = get_core_write_for_project_path(project_path.as_deref())
            .await
            .map_err(|e| SchaltError::DatabaseError {
                message: e.to_string(),
            })?;
        let manager = core.session_manager();

        let session = manager.get_session(&name).map_err(|e| {
            log::error!("Cancel {name}: Session not found: {e}");
            SchaltError::SessionNotFound {
                session_id: name.clone(),
            }
        })?;

        if session.session_state == lucode::domains::sessions::entity::SessionState::Spec {
            manager
                .archive_spec_session(&name)
                .map_err(|e| SchaltError::DatabaseError {
                    message: format!("Failed to archive spec: {e}"),
                })?;
            let repo = core.repo_path.to_string_lossy().to_string();
            let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
            (true, repo, Some(count))
        } else {
            if let Some(blocker) = manager.detect_cancel_blocker(&name).map_err(|e| {
                SchaltError::GitOperationFailed {
                    operation: "detect_cancel_blocker".to_string(),
                    message: e.to_string(),
                }
            })? {
                log::warn!("Cancel {name}: blocked by {blocker:?}");
                emit_session_cancel_blocked(&app, &name, &blocker);
                return Err(SchaltError::CancelBlocked { blocker });
            }

            if let Err(e) = manager.archive_prompt_for_session(&name) {
                log::warn!("Cancel {name}: Failed to archive prompt before cancel: {e}");
            }
            (false, core.repo_path.to_string_lossy().to_string(), None)
        }
    };

    if is_spec {
        // Emit events for spec archive and UI refresh, close terminals if any, then return early
        events::emit_archive_updated(&app, &repo_path_str, archive_count_after_opt.unwrap_or(0));
        // Ensure frontend selection logic runs consistently by emitting SessionRemoved for specs too
        events::emit_session_removed(&app, &name);
        evict_session_cache_entry_for_repo(&repo_path_str, &name).await;
        events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);

        terminals::close_session_terminals_if_any(&name).await;
        return Ok(());
    }

    // Emit a "cancelling" event instead of "removed"
    events::emit_session_cancelling(&app, &name);

    let app_for_refresh = app.clone();
    let name_for_bg = name.clone();
    let repo_for_eviction = repo_path_str.clone();
    tokio::spawn(async move {
        log::debug!("Cancel {name_for_bg}: Starting background work");

        // Always close terminals BEFORE removing the worktree to avoid leaving
        // shells in deleted directories (which causes getcwd errors in tools like `just`).
        terminals::close_session_terminals_if_any(&name_for_bg).await;

        // Get session info with a brief lock, then release before slow filesystem operations
        let session_info = match get_core_write().await {
            Ok(core) => {
                let manager = core.session_manager();
                manager.get_session_for_cancellation(&name_for_bg)
            }
            Err(e) => Err(anyhow::anyhow!(e)),
        };

        let consolidation_round_id = session_info
            .as_ref()
            .ok()
            .and_then(|info| info.session.consolidation_round_id.clone());

        if let Ok(ref info) = session_info {
            // File an auto_stub report if the session is a candidate exiting without
            // one. Runs against the still-intact worktree so the stub can include a
            // branch diff snapshot.
            if let Ok(core) = get_core_write().await {
                let db_manager = lucode::domains::sessions::SessionDbManager::new(
                    core.db.clone(),
                    core.repo_path.clone(),
                );
                if let Err(e) =
                    lucode::domains::sessions::consolidation_stub::ensure_stub_report_for_candidate(
                        &db_manager,
                        &info.session,
                        "cancelled",
                    )
                {
                    log::warn!("Cancel {name_for_bg}: stub report write failed: {e}");
                }
            }
        }

        let cancel_result = match session_info {
            Ok(info) => {
                // Perform slow filesystem operations WITHOUT holding the core write lock
                use lucode::schaltwerk_core::{
                    CancellationConfig, StandaloneCancellationCoordinator,
                };
                let coordinator = StandaloneCancellationCoordinator::new(
                    info.repo_path.clone(),
                    info.session.clone(),
                );
                let config = CancellationConfig::default();
                let result = coordinator.cancel_filesystem_only(config).await;

                // Only acquire lock briefly for final DB update
                match result {
                    Ok(fs_result) => match get_core_write().await {
                        Ok(core) => {
                            let manager = core.session_manager();
                            manager.finalize_session_cancellation(&info.session.id, fs_result)
                        }
                        Err(e) => Err(anyhow::anyhow!(e)),
                    },
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(e),
        };

        if cancel_result.is_ok()
            && let Some(round_id) = consolidation_round_id
        {
            let auto_judge_context = match get_core_read().await {
                Ok(core) => Some((core.db.clone(), core.session_manager())),
                Err(error) => {
                    log::warn!(
                        "Cancel {name_for_bg}: failed to prepare auto-judge context: {error}"
                    );
                    None
                }
            };
            if let Some((db, manager)) = auto_judge_context {
                let _ = maybe_auto_start_consolidation_judge(
                    &app_for_refresh,
                    &db,
                    &manager,
                    &round_id,
                )
                .await;
            }
        }

        match cancel_result {
            Ok(()) => {
                log::info!("Cancel {name_for_bg}: Successfully completed in background");

                // Now emit the actual removal event after successful cancellation
                #[derive(serde::Serialize, Clone)]
                struct SessionRemovedPayload {
                    session_name: String,
                }
                let _ = emit_event(
                    &app_for_refresh,
                    SchaltEvent::SessionRemoved,
                    &SessionRemovedPayload {
                        session_name: name_for_bg.clone(),
                    },
                );
                evict_session_cache_entry_for_repo(&repo_for_eviction, &name_for_bg).await;
                clear_session_attention_state(name_for_bg.clone());

                events::request_sessions_refreshed(
                    &app_for_refresh,
                    events::SessionsRefreshReason::SessionLifecycle,
                );
            }
            Err(e) => {
                if let Some(blocked) = e.downcast_ref::<
                    lucode::domains::sessions::lifecycle::cancellation::CancelBlockedError,
                >() {
                    log::warn!(
                        "Cancel {name_for_bg}: background filesystem preflight blocked by {:?}",
                        blocked.blocker
                    );
                    emit_session_cancel_blocked(&app_for_refresh, &name_for_bg, &blocked.blocker);
                } else {
                    log::error!("CRITICAL: Background cancel failed for {name_for_bg}: {e}");

                    #[derive(serde::Serialize, Clone)]
                    struct CancelErrorPayload {
                        session_name: String,
                        error: String,
                    }
                    let _ = emit_event(
                        &app_for_refresh,
                        SchaltEvent::CancelError,
                        &CancelErrorPayload {
                            session_name: name_for_bg.clone(),
                            error: e.to_string(),
                        },
                    );
                }

                events::request_sessions_refreshed(
                    &app_for_refresh,
                    events::SessionsRefreshReason::SessionLifecycle,
                );
            }
        }

        // Terminals were already closed above; nothing more to do here.

        log::info!("Cancel {name_for_bg}: All background work completed");
    });

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_force_cancel_session(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
) -> Result<(), SchaltError> {
    log::info!("Starting force cancel session: {name}");

    let (manager, repo_path_str, round_id, db) = {
        let core = get_core_write_for_project_path(project_path.as_deref())
            .await
            .map_err(|e| SchaltError::DatabaseError {
                message: e.to_string(),
            })?;
        let manager = core.session_manager();
        let round_id = manager
            .get_session(&name)
            .ok()
            .and_then(|session| session.consolidation_round_id);
        (
            manager,
            core.repo_path.to_string_lossy().to_string(),
            round_id,
            core.db.clone(),
        )
    };

    terminals::close_session_terminals_if_any(&name).await;

    manager
        .force_cancel_session(&name)
        .await
        .map_err(|error| SchaltError::GitOperationFailed {
            operation: "force_cancel_session".to_string(),
            message: error.to_string(),
        })?;

    if let Some(round_id) = round_id {
        let _ = maybe_auto_start_consolidation_judge(&app, &db, &manager, &round_id).await;
    }

    #[derive(serde::Serialize, Clone)]
    struct SessionRemovedPayload {
        session_name: String,
    }
    let _ = emit_event(
        &app,
        SchaltEvent::SessionRemoved,
        &SessionRemovedPayload {
            session_name: name.clone(),
        },
    );
    evict_session_cache_entry_for_repo(&repo_path_str, &name).await;
    clear_session_attention_state(name.clone());

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);
    log::info!("Force cancel {name}: completed");

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_convert_session_to_draft(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
) -> Result<String, String> {
    log::info!("Converting session to spec: {name}");

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();
    let repo_path_str = core.repo_path.to_string_lossy().to_string();

    // Close associated terminals BEFORE removing the worktree to avoid leaving shells
    // pointing at a deleted directory (which triggers getcwd errors).
    terminals::close_session_terminals_if_any(&name).await;

    match manager.convert_session_to_draft_async(&name).await {
        Ok(new_spec_name) => {
            log::info!("Successfully converted session to spec: {name}");

            // Close associated terminals
            terminals::close_session_terminals_if_any(&name).await;

            // Clean up any orphaned worktrees after conversion
            // This handles cases where worktree removal failed during conversion
            // We do this synchronously but with error handling to ensure it doesn't fail the conversion
            if let Err(e) = manager.cleanup_orphaned_worktrees() {
                log::warn!("Worktree cleanup after conversion failed (non-fatal): {e}");
            } else {
                log::info!(
                    "Successfully cleaned up orphaned worktrees after converting session to spec"
                );
            }

            // Emit event to notify frontend of the change
            log::info!("Queueing sessions refresh after converting session to spec");
            events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);
            evict_session_cache_entry_for_repo(&repo_path_str, &name).await;
            events::emit_selection_spec(&app, &new_spec_name);

            Ok(new_spec_name)
        }
        Err(e) => {
            log::error!("Failed to convert session '{name}' to spec: {e}");
            Err(format!("Failed to convert session '{name}' to spec: {e}"))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_convert_version_group_to_spec(
    app: tauri::AppHandle,
    base_name: String,
    session_names: Vec<String>,
    project_path: Option<String>,
) -> Result<String, String> {
    log::info!(
        "Converting version group '{base_name}' ({} sessions) to a single spec",
        session_names.len()
    );

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();
    let repo_path_str = core.repo_path.to_string_lossy().to_string();

    for name in &session_names {
        terminals::close_session_terminals_if_any(name).await;
    }

    match manager
        .convert_version_group_to_spec_async(&base_name, &session_names)
        .await
    {
        Ok(new_spec_name) => {
            for name in &session_names {
                terminals::close_session_terminals_if_any(name).await;
                evict_session_cache_entry_for_repo(&repo_path_str, name).await;
            }

            if let Err(e) = manager.cleanup_orphaned_worktrees() {
                log::warn!("Worktree cleanup after group convert failed (non-fatal): {e}");
            }

            events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);
            events::emit_selection_spec(&app, &new_spec_name);

            Ok(new_spec_name)
        }
        Err(e) => {
            log::error!("Failed to convert version group '{base_name}' to spec: {e}");
            Err(format!(
                "Failed to convert version group '{base_name}' to spec: {e}"
            ))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_update_git_stats(
    session_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session_by_id(&session_id)
        .map_err(|e| format!("Failed to get session for stats update: {e}"))?;

    lucode::domains::git::service::calculate_git_stats_fast(
        &session.worktree_path,
        &session.parent_branch,
    )
    .map(|_| ())
    .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_core_write().await?;
    let manager = core.session_manager();

    manager
        .cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude(
    app: tauri::AppHandle,
    session_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    schaltwerk_core_start_claude_with_restart(app, session_name, false, cols, rows).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentParams {
    pub session_name: String,
    #[serde(default)]
    pub force_restart: bool,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub terminal_id: Option<String>,
    pub agent_type: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    pub skip_prompt: Option<bool>,
}

#[tauri::command]
pub async fn schaltwerk_core_start_session_agent(
    app: tauri::AppHandle,
    session_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    schaltwerk_core_start_session_agent_with_restart(
        app,
        StartAgentParams {
            session_name,
            force_restart: false,
            cols,
            rows,
            terminal_id: None,
            agent_type: None,
            prompt: None,
            skip_prompt: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude_with_restart(
    app: tauri::AppHandle,
    session_name: String,
    force_restart: bool,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    schaltwerk_core_start_agent_in_terminal(
        app,
        AgentStartParams {
            session_name,
            force_restart,
            cols,
            rows,
            terminal_id_override: None,
            agent_type_override: None,
            skip_prompt: false,
            prompt_override: None,
        },
    )
    .await
}

struct AgentStartParams {
    session_name: String,
    force_restart: bool,
    cols: Option<u16>,
    rows: Option<u16>,
    terminal_id_override: Option<String>,
    agent_type_override: Option<String>,
    skip_prompt: bool,
    prompt_override: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentStartMode {
    Fresh,
    ForcedRestart,
    Reattach,
    DeadPaneSurfaceRestart,
}

impl AgentStartMode {
    fn as_str(self) -> &'static str {
        match self {
            AgentStartMode::Fresh => "fresh",
            AgentStartMode::ForcedRestart => "forced_restart",
            AgentStartMode::Reattach => "reattach",
            AgentStartMode::DeadPaneSurfaceRestart => "dead_pane_surface_restart",
        }
    }
}

struct StartModeInputs {
    force_restart: bool,
    tmux_session_alive: bool,
    agent_pane_alive: Option<bool>,
    agent_type_override_differs: bool,
}

fn decide_agent_start_mode(inputs: StartModeInputs) -> AgentStartMode {
    if inputs.force_restart {
        return AgentStartMode::ForcedRestart;
    }
    if !inputs.tmux_session_alive {
        return AgentStartMode::Fresh;
    }
    if inputs.agent_type_override_differs {
        return AgentStartMode::ForcedRestart;
    }
    if inputs.agent_pane_alive == Some(false) {
        return AgentStartMode::DeadPaneSurfaceRestart;
    }
    AgentStartMode::Reattach
}

fn does_agent_type_override_differ(
    agent_type_override: Option<&str>,
    recorded_agent_type: Option<&str>,
) -> bool {
    match (agent_type_override, recorded_agent_type) {
        (Some(override_type), Some(recorded_type)) => override_type != recorded_type,
        (Some(_), None) => true,
        _ => false,
    }
}

fn should_persist_prompt_override(start_mode: AgentStartMode) -> bool {
    matches!(
        start_mode,
        AgentStartMode::Fresh | AgentStartMode::ForcedRestart
    )
}

fn normalized_model_preference(
    preferences: &lucode::domains::settings::AgentPreference,
) -> Option<String> {
    preferences
        .model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToOwned::to_owned)
}

async fn schaltwerk_core_start_agent_in_terminal(
    app: tauri::AppHandle,
    params: AgentStartParams,
) -> Result<String, String> {
    let AgentStartParams {
        session_name,
        force_restart,
        cols,
        rows,
        terminal_id_override,
        agent_type_override,
        skip_prompt,
        prompt_override,
    } = params;
    log::info!(
        "Starting agent for session: {session_name}, terminal_id_override={terminal_id_override:?}, agent_type_override={agent_type_override:?}, skip_prompt={skip_prompt}"
    );

    // We only need read access to the core snapshot; avoid write lock to prevent launch deadlocks
    let core = get_core_read().await?;
    let db = core.db.clone();
    let repo_path = core.repo_path.clone();
    let manager = core.session_manager();
    drop(core); // release lock before any potentially long operations

    let session = manager
        .get_session(&session_name)
        .map_err(|e| format!("Failed to get session: {e}"))?;
    let recorded_agent_type = session.original_agent_type.clone();
    let agent_type_override_differs = does_agent_type_override_differ(
        agent_type_override.as_deref(),
        recorded_agent_type.as_deref(),
    );
    let agent_type = agent_type_override.clone().unwrap_or_else(|| {
        recorded_agent_type
            .clone()
            .unwrap_or_else(|| db.get_agent_type().unwrap_or_else(|_| "claude".to_string()))
    });

    if agent_type == "terminal" {
        log::info!("Skipping agent startup for terminal-only session: {session_name}");
        return Ok("Terminal-only session - no agent to start".to_string());
    }

    let terminal_id = terminal_id_override
        .unwrap_or_else(|| terminals::terminal_id_for_session_top(&session_name));
    let terminal_manager = get_terminal_manager().await?;
    let tmux_session_alive = terminal_manager.terminal_exists(&terminal_id).await?;
    let agent_pane_alive = if tmux_session_alive && !force_restart && !agent_type_override_differs {
        Some(terminal_manager.agent_pane_alive(&terminal_id).await?)
    } else {
        None
    };
    let start_mode = decide_agent_start_mode(StartModeInputs {
        force_restart,
        tmux_session_alive,
        agent_pane_alive,
        agent_type_override_differs,
    });
    let should_queue_initial_command = matches!(
        start_mode,
        AgentStartMode::Fresh | AgentStartMode::ForcedRestart
    );
    log::info!(
        "Agent start branch for session '{session_name}' terminal={terminal_id}: branch={}, force_restart={force_restart}, tmux_session_alive={tmux_session_alive}, agent_pane_alive={agent_pane_alive:?}, agent_type_override_differs={agent_type_override_differs}",
        start_mode.as_str()
    );

    if start_mode == AgentStartMode::ForcedRestart && tmux_session_alive {
        log::info!("Terminal {terminal_id} exists, closing before forced restart");
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }

    if let Some(prompt) = prompt_override.as_ref() {
        if should_persist_prompt_override(start_mode) {
            if let Err(err) = manager.update_session_initial_prompt(&session_name, prompt) {
                log::warn!("Failed to update initial prompt for session '{session_name}': {err}");
            }
        } else {
            log::warn!(
                "Prompt override supplied for session '{session_name}', but branch={} reattaches an existing tmux session so the prompt will not be delivered to the live agent",
                start_mode.as_str()
            );
        }
    }

    if !should_queue_initial_command {
        let cwd = session.worktree_path.to_string_lossy().to_string();
        log::info!("Checking permissions for reattach working directory: {cwd}");
        if let Err(err) = terminals::ensure_cwd_access(&cwd) {
            let message = format_agent_start_error(&err);
            let _ = terminal_manager
                .inject_terminal_error(
                    terminal_id.clone(),
                    cwd.clone(),
                    message,
                    cols.unwrap_or(80),
                    rows.unwrap_or(24),
                )
                .await;
            return Err(err);
        }

        let create_result = match (cols, rows) {
            (Some(c), Some(r)) => {
                terminal_manager
                    .create_terminal_with_size(terminal_id.clone(), cwd.clone(), c, r)
                    .await
            }
            _ => {
                terminal_manager
                    .create_terminal(terminal_id.clone(), cwd.clone())
                    .await
            }
        };
        if let Err(err) = create_result {
            let message = format_agent_start_error(&err);
            let _ = terminal_manager
                .inject_terminal_error(
                    terminal_id.clone(),
                    session.worktree_path.to_string_lossy().to_string(),
                    message,
                    cols.unwrap_or(80),
                    rows.unwrap_or(24),
                )
                .await;
            return Err(err);
        }

        log::info!(
            "Successfully reattached terminal {terminal_id} for session '{session_name}' using branch={}",
            start_mode.as_str()
        );

        if start_mode == AgentStartMode::DeadPaneSurfaceRestart {
            emit_agent_crashed_for_dead_pane(&app, &terminal_id, &session_name, &agent_type);
        } else {
            emit_terminal_agent_started(&app, &terminal_id, Some(&session_name));
        }

        return Ok(format!("Reattached existing {agent_type} session"));
    }

    // Resolve binary paths at command level (with caching)
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();

        // Get resolved binary paths for all agents
        for agent in [
            "claude", "copilot", "codex", "opencode", "gemini", "droid", "qwen", "amp", "kilocode",
        ] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::trace!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                }
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };

    // Get MCP servers for Amp
    let amp_mcp_servers = if agent_type == "amp" {
        if let Some(settings_manager) = SETTINGS_MANAGER.get() {
            let settings = settings_manager.lock().await;
            Some(settings.get_amp_mcp_servers())
        } else {
            None
        }
    } else {
        None
    };

    let force_restart = start_mode == AgentStartMode::ForcedRestart;
    let force_restart_prompt_template = if force_restart {
        Some(if let Some(settings_manager) = SETTINGS_MANAGER.get() {
            let settings = settings_manager.lock().await;
            settings
                .get_generation_settings()
                .force_restart_prompt_template
                .unwrap_or_else(lucode::domains::settings::default_force_restart_prompt_template)
        } else {
            lucode::domains::settings::default_force_restart_prompt_template()
        })
    } else {
        None
    };

    let spec = manager
        .start_claude_in_session_with_restart_and_binary(AgentLaunchParams {
            session_name: &session_name,
            force_restart,
            binary_paths: &binary_paths,
            amp_mcp_servers: amp_mcp_servers.as_ref(),
            agent_type_override: agent_type_override.as_deref(),
            skip_prompt,
            force_restart_prompt_template: force_restart_prompt_template.as_deref(),
        })
        .map_err(|e| {
            log::error!("Failed to build {agent_type} command for session {session_name}: {e}");
            format!("Failed to start {agent_type} in session: {e}")
        })?;

    let command = spec.shell_command.clone();
    let initial_command = spec.initial_command.clone();

    log::info!("Claude command for session {session_name}: {command}");

    if agent_type == "amp"
        && let Err(e) = manager.spawn_amp_thread_watcher(&session_name)
    {
        log::warn!("Failed to spawn amp thread watcher for session '{session_name}': {e}");
    }

    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    let agent_kind = agent_ctx::infer_agent_kind(&agent_name);
    let queue_policy = initial_command_queue_policy(agent_type.as_str(), agent_kind.manifest_key());

    // Check if we have permission to access the working directory
    log::info!("Checking permissions for working directory: {cwd}");
    if let Err(err) = terminals::ensure_cwd_access(&cwd) {
        let message = format_agent_start_error(&err);
        let _ = terminal_manager
            .inject_terminal_error(
                terminal_id.clone(),
                cwd.clone(),
                message,
                cols.unwrap_or(80),
                rows.unwrap_or(24),
            )
            .await;
        return Err(err);
    }
    log::info!("Working directory access confirmed: {cwd}");

    if should_queue_initial_command
        && queue_policy.auto_send_initial_command
        && let Some(initial) = initial_command.clone().filter(|v| !v.trim().is_empty())
    {
        let preview = initial
            .chars()
            .filter(|c| *c != '\r' && *c != '\n')
            .take(80)
            .collect::<String>();
        log::info!(
            "Queueing initial command for session '{session_name}' (agent={agent_type}, len={}, ready_marker={:?}, delay_ms={}) preview=\"{preview}\"",
            initial.len(),
            queue_policy.ready_marker.as_deref(),
            queue_policy
                .dispatch_delay
                .map(|d| d.as_millis())
                .unwrap_or(0),
        );
        terminal_manager
            .queue_initial_command(
                terminal_id.clone(),
                initial,
                queue_policy.ready_marker.clone(),
                queue_policy.dispatch_delay,
                queue_policy.use_bracketed_paste,
                queue_policy.needs_delayed_submit,
            )
            .await?;
    }

    let (mut env_vars, cli_args, preferences) =
        agent_ctx::collect_agent_env_and_cli(&agent_kind, &repo_path, &db).await;
    let original_agent_model = normalized_model_preference(&preferences);
    if let Err(err) = db.set_session_original_settings_with_model(
        &session.id,
        &agent_type,
        original_agent_model.as_deref(),
    ) {
        log::warn!("Failed to persist original agent settings for '{session_name}': {err}");
    }
    log::info!(
        "Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'",
        env_vars.len()
    );

    EnvAdapter::set_var("LUCODE_SESSION", &session_name);
    if !env_vars.iter().any(|(key, _)| key == "LUCODE_SESSION") {
        env_vars.push(("LUCODE_SESSION".to_string(), session_name.clone()));
    }

    // Inject session-specific environment variables for the setup script and agent
    env_vars.push((
        "REPO_PATH".to_string(),
        repo_path.to_string_lossy().to_string(),
    ));
    env_vars.push((
        "WORKTREE_PATH".to_string(),
        session.worktree_path.to_string_lossy().to_string(),
    ));
    env_vars.push(("SESSION_NAME".to_string(), session_name.clone()));
    env_vars.push(("BRANCH_NAME".to_string(), session.branch.clone()));

    // If a project setup script exists, run it ONCE inside this terminal before exec'ing the agent.
    // This streams all setup output to the agent terminal and avoids blocking session creation.
    // We gate with a marker file in the worktree: .lucode/setup.done
    let mut use_shell_chain = false;
    let mut shell_cmd: Option<String> = None;
    let marker_rel = ".lucode/setup.done";

    // For Amp commands with pipes (containing " | amp"), use shell chain to preserve the pipe
    let has_pipe =
        command.contains(" | amp") || (command.contains(" | ") && agent_name.ends_with("/amp"));
    if has_pipe {
        log::info!("Detected Amp command with pipe, using shell chain to preserve it: {command}");
        // Extract the actual command part (after " && ")
        if let Some(cmd_part) = command.split(" && ").nth(1) {
            shell_cmd = Some(cmd_part.to_string());
            use_shell_chain = true;
        }
    }
    if let Ok(Some(setup)) = db.get_project_setup_script(&repo_path)
        && !setup.trim().is_empty()
    {
        // Persist setup script to a temp file for reliable execution
        let temp_dir = std::env::temp_dir();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let script_path = temp_dir.join(format!("schalt_setup_{session_name}_{ts}.sh"));
        if let Err(e) = std::fs::write(&script_path, setup) {
            log::warn!("Failed to write setup script to temp file: {e}");
        } else {
            let marker_q = sh_quote_string(marker_rel);
            let script_q = sh_quote_string(&script_path.display().to_string());
            let script_command = format!("sh {script_q}");

            let (user_shell, default_args) = get_effective_shell();
            let login_invocation = build_login_shell_invocation_with_shell(
                &user_shell,
                &default_args,
                &script_command,
            );
            let run_setup_command = shell_invocation_to_posix(&login_invocation);

            // If we already have a shell_cmd (e.g., from Amp with pipe), wrap it with setup
            let is_piped_cmd = use_shell_chain && shell_cmd.is_some();
            let exec_cmd = if is_piped_cmd {
                // Amp with pipe: wrap the piped command with setup (no exec prefix needed)
                if let Some(existing_cmd) = shell_cmd.as_ref() {
                    existing_cmd.clone()
                } else {
                    log::error!(
                        "Shell command missing while attempting to chain piped Amp command"
                    );
                    return Err("Failed to build chained shell command".to_string());
                }
            } else {
                // Regular agent: build exec command from agent_name and args
                let mut exec_cmd = String::new();
                exec_cmd.push_str(&sh_quote_string(&agent_name));
                for a in &agent_args {
                    exec_cmd.push(' ');
                    exec_cmd.push_str(&sh_quote_string(a));
                }
                exec_cmd
            };

            // For piped commands, exec is already in the command (or not needed)
            // For regular agents, use exec to replace the shell
            let exec_prefix = if is_piped_cmd { "" } else { "exec " };
            let chained = format!(
                "set -e; if [ ! -f {marker_q} ]; then {run_setup_command}; rm -f {script_q}; mkdir -p .lucode; : > {marker_q}; fi; {exec_prefix}{exec_cmd}"
            );
            shell_cmd = Some(chained);
            use_shell_chain = true;
        }
    }

    // Build final args using centralized logic (handles Codex ordering/normalization)
    let final_args =
        agent_ctx::build_final_args(&agent_kind, agent_args.clone(), &cli_args, &preferences);

    // Codex prompt ordering is now handled in the CLI args section above

    // Log the exact command that will be executed
    let kind_str = match agent_kind {
        agent_ctx::AgentKind::Claude => "claude",
        agent_ctx::AgentKind::Copilot => "copilot",
        agent_ctx::AgentKind::Codex => "codex",
        agent_ctx::AgentKind::OpenCode => "opencode",
        agent_ctx::AgentKind::Gemini => "gemini",
        agent_ctx::AgentKind::Amp => "amp",
        agent_ctx::AgentKind::Droid => "droid",
        agent_ctx::AgentKind::Qwen => "qwen",
        agent_ctx::AgentKind::Kilocode => "kilocode",
        agent_ctx::AgentKind::Fallback => "claude",
    };
    log::info!(
        "FINAL COMMAND CONSTRUCTION for {kind_str}: command='{agent_name}', args={final_args:?}"
    );

    // Apply command prefix if configured (e.g., "vt" for VibeTunnel)
    let command_prefix = agent_launcher::get_agent_command_prefix().await;
    let (agent_name, final_args) =
        agent_launcher::apply_command_prefix(command_prefix, agent_name, final_args);

    let (launch_command, launch_args, launch_env) = if use_shell_chain {
        let Some(chained_command) = shell_cmd.take() else {
            log::error!("Shell chain requested without prepared command");
            return Err("Failed to construct shell command chain".to_string());
        };
        (
            "sh".to_string(),
            vec!["-lc".to_string(), chained_command],
            env_vars,
        )
    } else {
        (agent_name.clone(), final_args, env_vars)
    };

    let prepared_launch = agent_launcher::launch_script::prepare_terminal_launch(
        launch_command,
        launch_args,
        launch_env,
    )?;
    if let Some(path) = prepared_launch.launch_script_path.as_ref() {
        log::info!(
            "Routing oversized agent launch for terminal {terminal_id} through launch script {}",
            path.display()
        );
    }

    // Create terminal with initial size if provided
    let create_result = match (cols, rows) {
        (Some(c), Some(r)) => {
            use lucode::services::CreateTerminalWithAppAndSizeParams;
            terminal_manager
                .create_terminal_with_app_and_size(CreateTerminalWithAppAndSizeParams {
                    id: terminal_id.clone(),
                    cwd,
                    command: prepared_launch.command,
                    args: prepared_launch.args,
                    env: prepared_launch.env,
                    cols: c,
                    rows: r,
                })
                .await
        }
        _ => {
            terminal_manager
                .create_terminal_with_app(
                    terminal_id.clone(),
                    cwd,
                    prepared_launch.command,
                    prepared_launch.args,
                    prepared_launch.env,
                )
                .await
        }
    };

    if let Err(err) = create_result {
        let message = format_agent_start_error(&err);
        let _ = terminal_manager
            .inject_terminal_error(
                terminal_id.clone(),
                session.worktree_path.to_string_lossy().to_string(),
                message,
                cols.unwrap_or(80),
                rows.unwrap_or(24),
            )
            .await;
        return Err(err);
    }

    // For OpenCode and other TUI applications, the frontend will handle
    // proper sizing based on the actual terminal container dimensions.
    // No hardcoded resize is needed anymore as we now support dynamic sizing.

    // For Gemini, we rely on the CLI's own interactive prompt flag.
    // Do not implement non-deterministic paste-based workarounds.

    log::info!("Successfully started agent in terminal: {terminal_id}");

    if start_mode == AgentStartMode::DeadPaneSurfaceRestart {
        emit_agent_crashed_for_dead_pane(&app, &terminal_id, &session_name, &agent_type);
    } else {
        emit_terminal_agent_started(&app, &terminal_id, Some(&session_name));
    }

    Ok(command)
}

#[tauri::command]
pub async fn schaltwerk_core_start_session_agent_with_restart(
    app: tauri::AppHandle,
    params: StartAgentParams,
) -> Result<String, String> {
    let StartAgentParams {
        session_name,
        force_restart,
        cols,
        rows,
        terminal_id,
        agent_type,
        prompt,
        skip_prompt,
    } = params;
    log::info!(
        "[AGENT_LAUNCH_TRACE] schaltwerk_core_start_session_agent_with_restart called: session={session_name}, force_restart={force_restart}, terminal_id={terminal_id:?}, agent_type={agent_type:?}, skip_prompt={skip_prompt:?}, prompt_override={}",
        prompt.is_some()
    );
    schaltwerk_core_start_agent_in_terminal(
        app,
        AgentStartParams {
            session_name,
            force_restart,
            cols,
            rows,
            terminal_id_override: terminal_id,
            agent_type_override: agent_type,
            skip_prompt: skip_prompt.unwrap_or(false),
            prompt_override: prompt,
        },
    )
    .await
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude_orchestrator(
    app: tauri::AppHandle,
    terminal_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    agent_type: Option<String>,
    fresh_session: Option<bool>,
) -> Result<String, String> {
    let agent_label = agent_type.as_deref().unwrap_or("claude");
    log::info!(
        "[AGENT_LAUNCH_TRACE] Starting {agent_label} for orchestrator in terminal: {terminal_id}"
    );

    log::info!("[AGENT_LAUNCH_TRACE] Acquiring core read lock for {terminal_id}");
    let core = match get_core_read().await {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get schaltwerk_core for orchestrator: {e}");
            if e.contains("No active project") {
                return Err("No project is currently open. Please open a project folder first before starting the orchestrator.".to_string());
            }
            return Err(format!("Failed to initialize orchestrator: {e}"));
        }
    };
    log::info!("[AGENT_LAUNCH_TRACE] Acquired core read lock for {terminal_id}");

    let db = core.db.clone();
    let repo_path = core.repo_path.clone();
    let manager = core.session_manager();
    let configured_default_branch = db
        .get_default_base_branch()
        .map_err(|err| {
            log::warn!(
                "Failed to read default base branch while starting orchestrator watcher: {err}"
            );
            err
        })
        .ok()
        .flatten();

    let binary_paths = load_cached_agent_binary_paths().await;

    let command_spec = if fresh_session.unwrap_or(false) {
        manager
            .start_fresh_agent_in_orchestrator(&binary_paths, agent_type.as_deref())
            .map_err(|e| {
                log::error!("Failed to build fresh orchestrator command: {e}");
                format!("Failed to start fresh {agent_label} in orchestrator: {e}")
            })?
    } else {
        manager
            .start_agent_in_orchestrator(&binary_paths, agent_type.as_deref(), None)
            .map_err(|e| {
                log::error!("Failed to build orchestrator command: {e}");
                format!("Failed to start {agent_label} in orchestrator: {e}")
            })?
    };

    drop(core);
    log::info!("[AGENT_LAUNCH_TRACE] Dropped core read lock for {terminal_id}");

    let launch_result = agent_launcher::launch_in_terminal(
        terminal_id.clone(),
        command_spec,
        &db,
        repo_path.as_path(),
        cols,
        rows,
        true,
    )
    .await;

    match launch_result {
        Ok(_) => {
            emit_terminal_agent_started(&app, &terminal_id, None);

            let base_branch = configured_default_branch.unwrap_or_else(|| {
                repository::get_default_branch(repo_path.as_path())
                    .unwrap_or_else(|_| "main".to_string())
            });

            if let Ok(manager) = get_file_watcher_manager().await
                && let Err(err) = manager
                    .start_watching_orchestrator(repo_path.clone(), base_branch.clone())
                    .await
            {
                log::warn!(
                    "Failed to start orchestrator file watcher for {} on branch {}: {err}",
                    repo_path.display(),
                    base_branch
                );
            }

            Ok("orchestrator-started".to_string())
        }
        Err(err) => {
            log::error!("[AGENT_LAUNCH_TRACE] Orchestrator launch failed for {terminal_id}: {err}");
            #[derive(serde::Serialize, Clone)]
            struct OrchestratorLaunchFailedPayload<'a> {
                terminal_id: &'a str,
                error: &'a str,
            }
            let _ = emit_event(
                &app,
                SchaltEvent::OrchestratorLaunchFailed,
                &OrchestratorLaunchFailedPayload {
                    terminal_id: &terminal_id,
                    error: err.as_str(),
                },
            );
            if let Ok(manager) = get_terminal_manager().await
                && let Err(close_err) = manager.close_terminal(terminal_id.clone()).await
            {
                log::warn!(
                    "[AGENT_LAUNCH_TRACE] Failed to close terminal {terminal_id} after launch failure: {close_err}"
                );
            }
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_start_spec_orchestrator(
    app: tauri::AppHandle,
    terminal_id: String,
    spec_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
    agent_type: Option<String>,
) -> Result<String, String> {
    start_spec_orchestrator_impl(Some(app), terminal_id, spec_name, cols, rows, agent_type).await
}

pub async fn start_spec_orchestrator_impl(
    app: Option<tauri::AppHandle>,
    terminal_id: String,
    spec_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
    agent_type: Option<String>,
) -> Result<String, String> {
    let core = get_core_read().await.map_err(|e| {
        log::error!("Failed to get schaltwerk_core for spec orchestrator: {e}");
        format!("Failed to initialize spec orchestrator: {e}")
    })?;

    let db = core.db.clone();
    let resolved_agent_type = resolve_spec_clarification_agent_type(&db, agent_type);
    let agent_label = resolved_agent_type.as_str();
    log::info!(
        "[AGENT_LAUNCH_TRACE] Starting {agent_label} for spec orchestrator '{spec_name}' in terminal: {terminal_id}"
    );

    let repo_path = core.repo_path.clone();
    let manager = core.session_manager();
    let spec = manager
        .get_spec(&spec_name)
        .map_err(|e| format!("Failed to load spec '{spec_name}': {e}"))?;
    let binary_paths = load_cached_agent_binary_paths().await;

    let command_spec = if spec.clarification_started {
        manager
            .start_agent_in_orchestrator(&binary_paths, Some(agent_label), None)
            .map_err(|e| {
                log::error!("Failed to build resumable spec orchestrator command: {e}");
                format!("Failed to resume {agent_label} for spec '{spec_name}': {e}")
            })?
    } else {
        manager
            .start_fresh_agent_in_orchestrator(&binary_paths, Some(agent_label))
            .map_err(|e| {
                log::error!("Failed to build fresh spec orchestrator command: {e}");
                format!("Failed to start fresh {agent_label} for spec '{spec_name}': {e}")
            })?
    };

    drop(core);

    let launch_result = agent_launcher::launch_in_terminal(
        terminal_id.clone(),
        command_spec,
        &db,
        repo_path.as_path(),
        cols,
        rows,
        true,
    )
    .await;

    match launch_result {
        Ok(_) => {
            if let Some(app_handle) = app.as_ref() {
                emit_terminal_agent_started(app_handle, &terminal_id, Some(&spec.name));
            }
            Ok("spec-orchestrator-started".to_string())
        }
        Err(err) => {
            log::error!(
                "[AGENT_LAUNCH_TRACE] Spec orchestrator launch failed for {terminal_id}: {err}"
            );
            if let Ok(manager) = get_terminal_manager().await
                && let Err(close_err) = manager.close_terminal(terminal_id.clone()).await
            {
                log::warn!(
                    "[AGENT_LAUNCH_TRACE] Failed to close terminal {terminal_id} after launch failure: {close_err}"
                );
            }
            Err(err)
        }
    }
}

fn request_spec_sessions_refresh(app: Option<&tauri::AppHandle>) {
    if let Some(app_handle) = app {
        events::request_sessions_refreshed(app_handle, events::SessionsRefreshReason::SpecSync);
    }
}

async fn clear_spec_attention_after_user_reply(
    db: &lucode::infrastructure::database::Database,
    spec_id: &str,
    spec_name: &str,
) -> Result<(), String> {
    db.update_spec_attention_required(spec_id, false)
        .map_err(|e| format!("Failed to clear spec attention for '{spec_name}': {e}"))?;
    clear_session_attention_state_immediate(spec_name).await;
    Ok(())
}

pub async fn submit_spec_clarification_prompt_impl(
    app: Option<tauri::AppHandle>,
    terminal_id: String,
    spec_name: String,
    agent_type: Option<String>,
) -> Result<String, String> {
    let core = get_core_read().await.map_err(|e| {
        log::error!("Failed to get schaltwerk_core for spec clarification submit: {e}");
        format!("Failed to initialize spec orchestrator: {e}")
    })?;

    let db = core.db.clone();
    let resolved_agent_type = resolve_spec_clarification_agent_type(&db, agent_type);
    let manager = core.session_manager();
    let spec = manager
        .get_spec(&spec_name)
        .map_err(|e| format!("Failed to load spec '{spec_name}': {e}"))?;

    drop(core);

    let prompt = build_spec_clarification_prompt(&spec);
    let (use_bracketed_paste, needs_delayed_submit) =
        lucode::domains::terminal::submission::submission_options_for_agent(Some(
            resolved_agent_type.as_str(),
        ));

    let terminal_manager = get_terminal_manager().await?;
    let terminal_exists = terminal_manager
        .terminal_exists(&terminal_id)
        .await
        .map_err(|err| format!("Failed to verify terminal {terminal_id}: {err}"))?;

    if !terminal_exists {
        return Err(format!(
            "Clarification terminal {terminal_id} is not running for spec '{spec_name}'"
        ));
    }

    terminal_manager
        .paste_and_submit_terminal(
            terminal_id.clone(),
            prompt.into_bytes(),
            use_bracketed_paste,
            needs_delayed_submit,
        )
        .await
        .map_err(|err| format!("Failed to submit clarification prompt to {terminal_id}: {err}"))?;

    let mut needs_refresh = false;

    if spec.attention_required {
        clear_spec_attention_after_user_reply(&db, &spec.id, &spec.name).await?;
        needs_refresh = true;
    }

    if !spec.clarification_started {
        db.update_spec_clarification_started(&spec.id, true)
            .map_err(|e| {
                format!("Failed to update clarification_started for '{spec_name}': {e}")
            })?;
        needs_refresh = true;
    }

    if needs_refresh {
        request_spec_sessions_refresh(app.as_ref());
    }

    Ok("spec-clarification-prompt-submitted".to_string())
}

#[tauri::command]
pub async fn schaltwerk_core_submit_spec_clarification_prompt(
    app: tauri::AppHandle,
    terminal_id: String,
    spec_name: String,
    agent_type: Option<String>,
) -> Result<String, String> {
    submit_spec_clarification_prompt_impl(Some(app), terminal_id, spec_name, agent_type).await
}

pub async fn reset_spec_orchestrator_impl(
    app: Option<tauri::AppHandle>,
    terminal_id: String,
    spec_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
    agent_type: Option<String>,
) -> Result<String, String> {
    log::info!("Resetting spec orchestrator '{spec_name}' for terminal: {terminal_id}");

    let terminal_manager = get_terminal_manager().await?;
    if let Err(err) = terminal_manager.close_terminal(terminal_id.clone()).await {
        log::warn!("Failed to close spec orchestrator terminal {terminal_id}: {err}");
    }

    let core = get_core_read().await.map_err(|e| {
        log::error!("Failed to get schaltwerk_core for spec orchestrator reset: {e}");
        format!("Failed to initialize spec orchestrator: {e}")
    })?;
    let db = core.db.clone();
    let session_manager = core.session_manager();
    let spec = session_manager
        .get_spec(&spec_name)
        .map_err(|e| format!("Failed to load spec '{spec_name}': {e}"))?;

    drop(core);

    db.update_spec_clarification_started(&spec.id, false)
        .map_err(|e| format!("Failed to reset clarification_started for '{spec_name}': {e}"))?;
    request_spec_sessions_refresh(app.as_ref());

    start_spec_orchestrator_impl(app, terminal_id, spec_name, cols, rows, agent_type).await
}

#[tauri::command]
pub async fn schaltwerk_core_reset_spec_orchestrator(
    app: tauri::AppHandle,
    terminal_id: String,
    spec_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
    agent_type: Option<String>,
) -> Result<String, String> {
    reset_spec_orchestrator_impl(Some(app), terminal_id, spec_name, cols, rows, agent_type).await
}

#[tauri::command]
pub async fn schaltwerk_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_core_write().await?;
    core.db
        .set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

async fn resolve_agent_model_for_capture(agent_type: &str) -> Option<String> {
    let settings_manager = SETTINGS_MANAGER.get()?;
    let manager = settings_manager.lock().await;
    manager
        .get_agent_preferences(agent_type)
        .model
        .and_then(|model| {
            let trimmed = model.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        })
}

#[tauri::command]
pub async fn schaltwerk_core_set_session_agent_type(
    app: tauri::AppHandle,
    session_name: String,
    agent_type: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_write_for_project_path(project_path.as_deref()).await?;

    // Update global agent type
    core.db
        .set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set global agent type: {e}"))?;

    // Get the session to find its ID
    let session = core
        .db
        .get_session_by_name(&core.repo_path, &session_name)
        .map_err(|e| format!("Failed to find session {session_name}: {e}"))?;

    let model = resolve_agent_model_for_capture(&agent_type).await;

    // Update session's original settings to use the new agent type
    core.db
        .set_session_original_settings_with_model(&session.id, &agent_type, model.as_deref())
        .map_err(|e| format!("Failed to update session agent type: {e}"))?;

    log::info!(
        "Updated agent type to '{}' for session '{}' (id: {})",
        agent_type,
        session_name,
        session.id
    );

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_agent_type() -> Result<String, String> {
    let core = get_core_read().await?;
    core.db
        .get_agent_type()
        .map_err(|e| format!("Failed to get agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_orchestrator_agent_type(
    app: tauri::AppHandle,
    agent_type: String,
) -> Result<(), String> {
    let core = get_core_write().await?;
    core.db
        .set_orchestrator_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set orchestrator agent type: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_orchestrator_agent_type() -> Result<String, String> {
    let core = get_core_read().await?;
    core.db
        .get_orchestrator_agent_type()
        .map_err(|e| format!("Failed to get orchestrator agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_spec_clarification_agent_type(
    app: tauri::AppHandle,
    agent_type: String,
) -> Result<(), String> {
    let core = get_core_write().await?;
    core.db
        .set_spec_clarification_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set spec clarification agent type: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SessionLifecycle);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_spec_clarification_agent_type() -> Result<String, String> {
    let core = get_core_read().await?;
    core.db
        .get_spec_clarification_agent_type()
        .map_err(|e| format!("Failed to get spec clarification agent type: {e}"))
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationDefaultFavoriteDto {
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub preset_id: Option<String>,
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tauri::command]
pub async fn schaltwerk_core_get_consolidation_default_favorite()
-> Result<ConsolidationDefaultFavoriteDto, String> {
    let core = get_core_read().await?;
    let value = core
        .db
        .get_consolidation_default_favorite()
        .map_err(|e| format!("Failed to get consolidation default favorite: {e}"))?;
    Ok(ConsolidationDefaultFavoriteDto {
        agent_type: value.agent_type,
        preset_id: value.preset_id,
    })
}

#[tauri::command]
pub async fn schaltwerk_core_set_consolidation_default_favorite(
    value: ConsolidationDefaultFavoriteDto,
) -> Result<(), String> {
    let preset_id = normalize_optional(value.preset_id);
    let agent_type = if preset_id.is_some() {
        None
    } else {
        normalize_optional(value.agent_type)
    };
    let normalized = lucode::schaltwerk_core::db_app_config::ConsolidationDefaultFavorite {
        agent_type,
        preset_id,
    };

    let core = get_core_write().await?;
    core.db
        .set_consolidation_default_favorite(&normalized)
        .map_err(|e| format!("Failed to set consolidation default favorite: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_font_sizes() -> Result<(i32, i32), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .cloned()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let (mut terminal, mut ui) = {
        let manager = settings_manager.lock().await;
        manager.get_font_sizes()
    };

    let should_attempt_migration = if let Some(project_manager) = PROJECT_MANAGER.get() {
        project_manager.current_project_path().await.is_some()
    } else {
        false
    };

    if should_attempt_migration {
        match get_core_read().await {
            Ok(core) => {
                let db_result = core.db.get_font_sizes();
                drop(core);

                if let Ok((db_terminal, db_ui)) = db_result
                    && (db_terminal, db_ui) != (terminal, ui)
                {
                    {
                        let mut manager = settings_manager.lock().await;
                        if let Err(err) = manager.set_font_sizes(db_terminal, db_ui) {
                            log::warn!("Failed to migrate font sizes to settings: {err}");
                        }
                    }
                    terminal = db_terminal;
                    ui = db_ui;
                }
            }
            Err(err) => {
                if !err.contains("No active project") {
                    log::warn!("Failed to read font sizes from project database: {err}");
                }
            }
        }
    }

    Ok((terminal, ui))
}

#[tauri::command]
pub async fn schaltwerk_core_set_font_sizes(
    terminal_font_size: i32,
    ui_font_size: i32,
) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .cloned()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    {
        let mut manager = settings_manager.lock().await;
        manager
            .set_font_sizes(terminal_font_size, ui_font_size)
            .map_err(|e| format!("Failed to save font sizes: {e}"))?;
    }

    let should_attempt_db_update = if let Some(project_manager) = PROJECT_MANAGER.get() {
        project_manager.current_project_path().await.is_some()
    } else {
        false
    };

    if should_attempt_db_update {
        match get_core_write().await {
            Ok(core) => {
                core.db
                    .set_font_sizes(terminal_font_size, ui_font_size)
                    .map_err(|e| format!("Failed to set font sizes: {e}"))?;
            }
            Err(err) => {
                if err.contains("No active project") {
                    log::debug!("Skipping project font size update: {err}");
                } else {
                    return Err(err);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_has_uncommitted_changes(
    name: String,
    project_path: Option<String>,
) -> Result<bool, String> {
    let manager = session_manager_read(project_path.as_deref()).await?;

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))?;

    lucode::domains::git::has_uncommitted_changes(&session.worktree_path)
        .map_err(|e| format!("Failed to check uncommitted changes: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schaltwerk_core_create_spec_session(
    app: tauri::AppHandle,
    name: String,
    spec_content: String,
    agent_type: Option<String>,
    epic_id: Option<String>,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    user_edited_name: Option<bool>,
) -> Result<Session, String> {
    log::info!("Creating spec: {name} with agent_type={agent_type:?}");

    let core = get_core_write().await?;
    let manager = core.session_manager();

    let spec = manager
        .create_spec_session_with_agent(
            &name,
            &spec_content,
            agent_type.as_deref(),
            None,
            epic_id.as_deref(),
        )
        .map_err(|e| format!("Failed to create spec session: {e}"))?;
    if issue_number.is_some() || issue_url.is_some() {
        core.db
            .update_spec_issue_info(&spec.id, issue_number, issue_url.as_deref())
            .map_err(|e| format!("Failed to persist spec issue metadata: {e}"))?;
    }
    if pr_number.is_some() || pr_url.is_some() {
        core.db
            .update_spec_pr_info(&spec.id, pr_number, pr_url.as_deref())
            .map_err(|e| format!("Failed to persist spec PR metadata: {e}"))?;
    }

    if should_spawn_spec_name_generation(user_edited_name) {
        spawn_spec_name_generation(
            app.clone(),
            spec.id.clone(),
            spec.name.clone(),
            spec_content.clone(),
        );
    }

    let spec_session = manager
        .list_sessions_by_state(SessionState::Spec)
        .map_err(|e| format!("Failed to list specs: {e}"))?
        .into_iter()
        .find(|s| s.name == spec.name)
        .ok_or_else(|| {
            "Spec session not found after creation; inconsistent spec/session sync".to_string()
        })?;

    log::info!("Queueing sessions refresh after creating spec session");
    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    drop(core);

    Ok(spec_session)
}
#[tauri::command]
pub async fn schaltwerk_core_update_session_state(
    name: String,
    state: String,
) -> Result<(), String> {
    log::info!("Updating session state: {name} -> {state}");

    let session_state = state
        .parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;

    let core = get_core_write().await?;
    let manager = core.session_manager();

    manager
        .update_session_state(&name, session_state)
        .map_err(|e| format!("Failed to update session state: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_update_spec_content(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
    log::info!("Updating spec content for session: {name}");

    let core = get_core_write().await?;
    let manager = core.session_manager();

    persist_spec_content_with_refresh(
        &name,
        &content,
        |session_id, next_content| {
            manager
                .update_spec_content(session_id, next_content)
                .map_err(|e| format!("Failed to update spec content: {e}"))
        },
        || {
            request_spec_sessions_refresh(Some(&app));
        },
    )?;

    Ok(())
}

fn persist_spec_content_with_refresh<P, F>(
    name: &str,
    content: &str,
    persist: P,
    after_save: F,
) -> Result<(), String>
where
    P: FnOnce(&str, &str) -> Result<(), String>,
    F: FnOnce(),
{
    persist(name, content)?;
    after_save();
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_spec_review_comments(
    name: String,
    project_path: Option<String>,
) -> Result<Vec<lucode::infrastructure::database::PersistedSpecReviewComment>, String> {
    let manager = session_manager_read(project_path.as_deref()).await?;
    manager
        .list_spec_review_comments(&name)
        .map_err(|e| format!("Failed to list spec review comments: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_save_spec_review_comments(
    name: String,
    comments: Vec<lucode::infrastructure::database::PersistedSpecReviewComment>,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();
    manager
        .save_spec_review_comments(&name, &comments)
        .map_err(|e| format!("Failed to save spec review comments: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_clear_spec_review_comments(
    name: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();
    manager
        .clear_spec_review_comments(&name)
        .map_err(|e| format!("Failed to clear spec review comments: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_spec_stage(
    app: tauri::AppHandle,
    name: String,
    stage: String,
) -> Result<(), String> {
    log::info!("Updating spec stage: {name} -> {stage}");

    let parsed_stage = match stage
        .parse::<lucode::domains::sessions::entity::SpecStage>()
        .map_err(|_| format!("Invalid spec stage: {stage}"))?
    {
        stage @ (lucode::domains::sessions::entity::SpecStage::Draft
        | lucode::domains::sessions::entity::SpecStage::Ready) => stage,
        _ => return Err(format!("Invalid spec stage: {stage}")),
    };

    let core = get_core_write().await?;
    let manager = core.session_manager();
    let spec = manager
        .get_spec(&name)
        .map_err(|e| format!("Failed to load spec '{name}': {e}"))?;

    core.db
        .update_spec_stage(&spec.id, parsed_stage)
        .map_err(|e| format!("Failed to update spec stage: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_set_spec_attention_required(
    app: tauri::AppHandle,
    name: String,
    attention_required: bool,
) -> Result<(), String> {
    log::info!("Updating spec attention requirement: {name} -> {attention_required}");

    let core = get_core_write().await?;
    let manager = core.session_manager();
    let spec = manager
        .get_spec(&name)
        .map_err(|e| format!("Failed to load spec '{name}': {e}"))?;

    core.db
        .update_spec_attention_required(&spec.id, attention_required)
        .map_err(|e| format!("Failed to update spec attention: {e}"))?;

    if !attention_required {
        clear_session_attention_state(name);
    }

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_rename_draft_session(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    log::info!("Renaming spec session from '{old_name}' to '{new_name}'");

    let core = get_core_write().await?;
    let manager = core.session_manager();

    manager
        .rename_draft_session(&old_name, &new_name)
        .map_err(|e| format!("Failed to rename spec session: {e}"))?;

    // Emit sessions-refreshed event to update UI
    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_rename_session_display_name(
    app: tauri::AppHandle,
    session_id: String,
    new_display_name: String,
) -> Result<(), String> {
    log::info!(
        "Renaming session display name: session_id={session_id}, new_name={new_display_name}"
    );

    let sanitized = lucode::domains::agents::naming::sanitize_name(&new_display_name);
    if sanitized.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }

    let core = get_core_read().await?;
    let manager = core.session_manager();
    let db = core.db.clone();

    let current_name = if let Ok(session) = manager.get_session(&session_id) {
        session.name.clone()
    } else if let Ok(spec) = manager.get_spec(&session_id) {
        spec.name.clone()
    } else {
        return Err(format!("Session or spec '{session_id}' not found"));
    };

    let sessions = manager.list_sessions().map_err(|e| e.to_string())?;
    let specs = manager.list_specs().map_err(|e| e.to_string())?;

    let duplicate_session = sessions.iter().find(|s| {
        s.name != current_name
            && s.display_name
                .as_ref()
                .map(|dn| dn == &sanitized)
                .unwrap_or(false)
    });
    let duplicate_spec = specs.iter().find(|s| {
        s.name != current_name
            && s.display_name
                .as_ref()
                .map(|dn| dn == &sanitized)
                .unwrap_or(false)
    });

    if duplicate_session.is_some() || duplicate_spec.is_some() {
        return Err(format!(
            "A session with the name '{sanitized}' already exists"
        ));
    }

    if let Ok(session) = manager.get_session(&session_id) {
        db.update_session_display_name(&session.id, &sanitized)
            .map_err(|e| format!("Failed to update session display name: {e}"))?;
    } else if let Ok(spec) = manager.get_spec(&session_id) {
        use lucode::infrastructure::database::db_specs::SpecMethods;
        db.update_spec_display_name(&spec.id, &sanitized)
            .map_err(|e| format!("Failed to update spec display name: {e}"))?;
    }

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_append_spec_content(
    name: String,
    content: String,
) -> Result<(), String> {
    log::info!("Appending to spec content for session: {name}");

    let core = get_core_write().await?;
    let manager = core.session_manager();

    manager
        .append_spec_content(&name, &content)
        .map_err(|e| format!("Failed to append spec content: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_link_session_to_issue(
    app: tauri::AppHandle,
    name: String,
    issue_number: i64,
    issue_url: String,
    project_path: Option<String>,
) -> Result<(), String> {
    log::info!("Linking session '{name}' to issue #{issue_number}");

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Session not found: {e}"))?;

    core.db
        .update_session_issue_info(&session.id, Some(issue_number), Some(&issue_url))
        .map_err(|e| format!("Failed to link session to issue: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_link_session_to_pr(
    app: tauri::AppHandle,
    name: String,
    pr_number: i64,
    pr_url: String,
    project_path: Option<String>,
) -> Result<(), String> {
    log::info!("Linking session '{name}' to PR #{pr_number}");

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Session not found: {e}"))?;

    core.db
        .update_session_pr_info(&session.id, Some(pr_number), Some(&pr_url))
        .map_err(|e| format!("Failed to link session to PR: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_unlink_session_from_issue(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
) -> Result<(), String> {
    log::info!("Unlinking issue from session '{name}'");

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Session not found: {e}"))?;

    core.db
        .update_session_issue_info(&session.id, None, None)
        .map_err(|e| format!("Failed to unlink issue from session: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_unlink_session_from_pr(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
) -> Result<(), String> {
    log::info!("Unlinking PR from session '{name}'");

    let core = get_core_write_for_project_path(project_path.as_deref()).await?;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Session not found: {e}"))?;

    core.db
        .update_session_pr_info(&session.id, None, None)
        .map_err(|e| format!("Failed to unlink PR from session: {e}"))?;

    events::request_sessions_refreshed(&app, events::SessionsRefreshReason::SpecSync);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions_by_state(state: String) -> Result<Vec<Session>, String> {
    log::info!("Listing sessions by state: {state}");

    let session_state = state
        .parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;

    let core = get_core_read().await?;
    let manager = core.session_manager();

    manager
        .list_sessions_by_state(session_state)
        .map_err(|e| format!("Failed to list sessions by state: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_reset_orchestrator(terminal_id: String) -> Result<String, String> {
    log::info!("Resetting orchestrator for terminal: {terminal_id}");

    // Close the current terminal first
    let manager = get_terminal_manager().await?;
    if let Err(e) = manager.close_terminal(terminal_id.clone()).await {
        log::warn!("Failed to close terminal {terminal_id}: {e}");
        // Continue anyway, terminal might already be closed
    }

    // Start a FRESH orchestrator session (bypassing session discovery)
    schaltwerk_core_start_fresh_orchestrator(terminal_id).await
}

fn build_fresh_orchestrator_command_spec<DB: AppConfigMethods>(
    db: &DB,
    manager: &SessionManager,
    binary_paths: &std::collections::HashMap<String, String>,
) -> Result<(String, lucode::services::AgentLaunchSpec), String> {
    let orchestrator_agent = db
        .get_orchestrator_agent_type()
        .unwrap_or_else(|_| "claude".to_string());
    let command_spec = manager
        .start_fresh_agent_in_orchestrator(binary_paths, None)
        .map_err(|e| {
            log::error!("Failed to build fresh orchestrator command: {e}");
            format!("Failed to start fresh {orchestrator_agent} in orchestrator: {e}")
        })?;

    Ok((orchestrator_agent, command_spec))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InitialCommandQueuePolicy {
    auto_send_initial_command: bool,
    ready_marker: Option<String>,
    dispatch_delay: Option<Duration>,
    use_bracketed_paste: bool,
    needs_delayed_submit: bool,
}

fn initial_command_queue_policy(agent_type: &str, manifest_key: &str) -> InitialCommandQueuePolicy {
    let (auto_send_initial_command, ready_marker) = AgentManifest::get(manifest_key)
        .map(|manifest| {
            (
                manifest.auto_send_initial_command,
                manifest.ready_marker.clone(),
            )
        })
        .unwrap_or((false, None));
    let (use_bracketed_paste, needs_delayed_submit) =
        submission_options_for_agent(Some(agent_type));
    let dispatch_delay = match agent_type {
        "copilot" | "kilocode" => Some(Duration::from_millis(1500)),
        // OpenCode dispatches when the manifest ready_marker matches; the
        // longer fallback deadline guards against marker text drift across
        // upstream OpenCode releases so the prompt cannot hang forever.
        "opencode" => Some(Duration::from_millis(5000)),
        _ => None,
    };

    InitialCommandQueuePolicy {
        auto_send_initial_command,
        ready_marker,
        dispatch_delay,
        use_bracketed_paste,
        needs_delayed_submit,
    }
}

#[tauri::command]
pub async fn schaltwerk_core_start_fresh_orchestrator(
    terminal_id: String,
) -> Result<String, String> {
    // First check if we have a valid project initialized
    let core = match get_core_read().await {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get schaltwerk_core for fresh orchestrator: {e}");
            // If we can't get a schaltwerk_core (no project), create a user-friendly error
            if e.contains("No active project") {
                return Err("No project is currently open. Please open a project folder first before starting the orchestrator.".to_string());
            }
            return Err(format!("Failed to initialize orchestrator: {e}"));
        }
    };
    let manager = core.session_manager();
    let repo_path = core.repo_path.clone();
    let configured_default_branch = core
        .db
        .get_default_base_branch()
        .map_err(|err| {
            log::warn!(
                "Failed to read default base branch while starting fresh orchestrator watcher: {err}"
            );
            err
        })
        .ok()
        .flatten();

    let binary_paths = load_cached_agent_binary_paths().await;
    let (orchestrator_agent, command_spec) =
        build_fresh_orchestrator_command_spec(&core.db, &manager, &binary_paths)?;

    log::info!(
        "Starting fresh orchestrator in terminal {terminal_id} with configured agent: {orchestrator_agent}"
    );
    log::info!(
        "Fresh orchestrator command for agent {orchestrator_agent}: {}",
        command_spec.shell_command.as_str()
    );

    // Delegate to shared launcher (no initial size for fresh)
    let result = agent_launcher::launch_in_terminal(
        terminal_id.clone(),
        command_spec,
        &core.db,
        &core.repo_path,
        None,
        None,
        true,
    )
    .await?;

    drop(core);

    let base_branch = configured_default_branch.unwrap_or_else(|| {
        repository::get_default_branch(repo_path.as_path()).unwrap_or_else(|_| "main".to_string())
    });

    match get_file_watcher_manager().await {
        Ok(manager) => {
            if let Err(err) = manager
                .start_watching_orchestrator(repo_path.clone(), base_branch.clone())
                .await
            {
                log::warn!(
                    "Failed to start orchestrator file watcher after fresh start for {} on branch {}: {err}",
                    repo_path.display(),
                    base_branch
                );
            }
        }
        Err(err) => {
            log::warn!("File watcher manager unavailable while starting fresh orchestrator: {err}");
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use lucode::schaltwerk_core::Database;
    use lucode::services::AgentLaunchSpec;
    use serde_json::Value;
    use tempfile::TempDir;

    fn run_git(current_dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(current_dir)
            .status()
            .expect("git command should start");
        assert!(
            status.success(),
            "git {:?} failed in {}",
            args,
            current_dir.display()
        );
    }

    fn write_file(path: &Path, relative_path: &str, contents: &str) {
        let file_path = path.join(relative_path);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).expect("parent directory should be created");
        }
        std::fs::write(file_path, contents).expect("file should be written");
    }

    fn create_test_session_manager() -> (SessionManager, TempDir, Database) {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let repo_path = temp_dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).expect("repo directory should be created");

        run_git(&repo_path, &["init"]);
        run_git(&repo_path, &["config", "user.email", "test@example.com"]);
        run_git(&repo_path, &["config", "user.name", "Test User"]);
        write_file(&repo_path, "README.md", "initial\n");
        run_git(&repo_path, &["add", "README.md"]);
        run_git(&repo_path, &["commit", "-m", "initial"]);

        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).expect("database should be created");
        let manager = SessionManager::new(db.clone(), repo_path);

        (manager, temp_dir, db)
    }

    #[test]
    fn test_codex_flag_normalization_integration() {
        // Test the full pipeline as used in actual code
        let cli_args = "-model gpt-4 -p work -m claude";
        let mut args = shell_words::split(cli_args).unwrap();

        crate::commands::schaltwerk_core::schaltwerk_core_cli::fix_codex_single_dash_long_flags(
            &mut args,
        );
        crate::commands::schaltwerk_core::schaltwerk_core_cli::reorder_codex_model_after_profile(
            &mut args,
        );

        // After normalization:
        // 1. -model should become --model
        // 2. -p should stay as -p (short flag)
        // 3. -m should stay as -m (short flag)
        // 4. Profile flags should come before model flags

        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"-m".to_string()));

        let p_idx = args.iter().position(|x| x == "-p").unwrap();
        let model_idx = args.iter().position(|x| x == "--model").unwrap();
        let m_idx = args.iter().position(|x| x == "-m").unwrap();

        assert!(p_idx < model_idx);
        assert!(p_idx < m_idx);
    }

    #[test]
    fn test_sh_quote_string_basic() {
        assert_eq!(sh_quote_string(""), "''");
        assert_eq!(sh_quote_string("abc"), "'abc'");
        assert_eq!(sh_quote_string("a'b"), "'a'\\''b'");
        assert_eq!(sh_quote_string("a b"), "'a b'");
        assert!(sh_quote_string("--flag").starts_with("'--flag'"));
    }

    #[test]
    fn spec_name_generation_respects_user_edited_name() {
        assert!(should_spawn_spec_name_generation(None));
        assert!(should_spawn_spec_name_generation(Some(false)));
        assert!(!should_spawn_spec_name_generation(Some(true)));
    }

    #[tokio::test]
    async fn clear_spec_attention_after_user_reply_flips_db_flag() {
        use chrono::Utc;
        use lucode::infrastructure::database::Database;
        use lucode::infrastructure::database::db_specs::SpecMethods;
        use std::path::PathBuf;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().expect("temp dir");
        let db = Database::new(Some(temp_dir.path().join("clear.db"))).expect("database");
        let now = Utc::now();
        let spec = lucode::domains::sessions::entity::Spec {
            id: "spec-waiting".to_string(),
            name: "waiting-spec".to_string(),
            display_name: None,
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".to_string(),
            content: "".to_string(),
            implementation_plan: None,
            stage: lucode::domains::sessions::entity::SpecStage::Ready,
            variant: lucode::domains::sessions::entity::TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: true,
            clarification_started: true,
            created_at: now,
            updated_at: now,
        };
        db.create_spec(&spec).expect("create spec");

        super::clear_spec_attention_after_user_reply(&db, &spec.id, &spec.name)
            .await
            .expect("helper clears attention");

        let reloaded = db.get_spec_by_id(&spec.id).expect("spec reload");
        assert!(!reloaded.attention_required);
    }

    #[tokio::test]
    async fn orchestrator_launch_propagates_errors() {
        async fn run_with_stubbed_launch<L, Fut>(launch_fn: L) -> Result<String, String>
        where
            L: Fn(
                String,
                AgentLaunchSpec,
                &Database,
                &std::path::Path,
                Option<u16>,
                Option<u16>,
                bool,
            ) -> Fut,
            Fut: std::future::Future<Output = Result<String, String>>,
        {
            let temp_dir = tempfile::tempdir().unwrap();
            let db_path = temp_dir.path().join("test.db");
            let db = Database::new(Some(db_path)).unwrap();
            let spec = AgentLaunchSpec::new(
                "echo orchestrator".to_string(),
                temp_dir.path().to_path_buf(),
            );

            launch_fn(
                "orchestrator-terminal".to_string(),
                spec,
                &db,
                temp_dir.path(),
                None,
                None,
                true,
            )
            .await
        }

        let result = run_with_stubbed_launch(
            |_id, _spec, _db, _repo, _cols, _rows, _force_restart| async {
                Err("launch failed".to_string())
            },
        )
        .await;

        assert_eq!(result.unwrap_err(), "launch failed".to_string());
    }

    #[test]
    fn build_fresh_orchestrator_command_spec_uses_persisted_orchestrator_agent() {
        let (manager, _temp_dir, db) = create_test_session_manager();
        db.set_orchestrator_agent_type("codex")
            .expect("orchestrator agent type should persist");

        let (agent, command_spec) =
            build_fresh_orchestrator_command_spec(&db, &manager, &std::collections::HashMap::new())
                .expect("fresh orchestrator command should build");

        assert_eq!(agent, "codex");
        assert!(
            command_spec.shell_command.contains("codex"),
            "expected Codex orchestrator command: {}",
            command_spec.shell_command
        );
        assert!(
            command_spec.shell_command.contains(" codex --sandbox "),
            "expected Codex sandbox flag in command: {}",
            command_spec.shell_command
        );
        assert!(
            !command_spec.shell_command.contains(" resume "),
            "fresh orchestrator command must not resume: {}",
            command_spec.shell_command
        );
    }

    #[test]
    fn opencode_initial_command_queue_policy_uses_manifest_marker_with_fallback_deadline() {
        let policy = initial_command_queue_policy("opencode", "opencode");

        assert!(policy.auto_send_initial_command);
        assert_eq!(policy.ready_marker.as_deref(), Some("? for shortcuts"));
        assert_eq!(policy.dispatch_delay, Some(Duration::from_millis(5000)));
        assert!(policy.use_bracketed_paste);
        assert!(policy.needs_delayed_submit);
    }

    #[test]
    fn resolve_conflicting_paths_prefers_explicit_marker() {
        let paths = resolve_conflicting_paths(
            "Merge failed. Conflicting paths: src/lib.rs, src/main.rs",
            Path::new("/tmp/does-not-need-to-exist"),
        );

        assert_eq!(
            paths,
            vec!["src/lib.rs".to_string(), "src/main.rs".to_string()]
        );
    }

    #[test]
    fn resolve_conflicting_paths_falls_back_to_worktree_index() {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let repo_path = temp_dir.path();

        run_git(repo_path, &["init"]);
        run_git(repo_path, &["config", "user.email", "test@example.com"]);
        run_git(repo_path, &["config", "user.name", "Test User"]);

        write_file(repo_path, "conflict.txt", "base\n");
        run_git(repo_path, &["add", "conflict.txt"]);
        run_git(repo_path, &["commit", "-m", "base"]);
        run_git(repo_path, &["branch", "-M", "main"]);
        run_git(repo_path, &["checkout", "-b", "feature"]);

        write_file(repo_path, "conflict.txt", "feature\n");
        run_git(repo_path, &["add", "conflict.txt"]);
        run_git(repo_path, &["commit", "-m", "feature"]);

        run_git(repo_path, &["checkout", "main"]);
        write_file(repo_path, "conflict.txt", "main\n");
        run_git(repo_path, &["add", "conflict.txt"]);
        run_git(repo_path, &["commit", "-m", "main"]);

        let output = std::process::Command::new("git")
            .args(["merge", "feature"])
            .current_dir(repo_path)
            .output()
            .expect("merge command should run");
        assert!(!output.status.success(), "merge should conflict");

        let paths =
            resolve_conflicting_paths("Merge failed without explicit path marker", repo_path);
        assert_eq!(paths, vec!["conflict.txt".to_string()]);
    }

    #[test]
    fn session_added_payload_includes_version_metadata() {
        let payload = build_session_added_payload(
            &Session {
                id: "session-1".to_string(),
                name: "feature-consolidation".to_string(),
                display_name: None,
                version_group_id: Some("group-1".to_string()),
                version_number: Some(2),
                epic_id: None,
                repository_path: std::path::PathBuf::from("/tmp/repo"),
                repository_name: "repo".to_string(),
                branch: "schaltwerk/feature-consolidation".to_string(),
                parent_branch: "main".to_string(),
                original_parent_branch: None,
                worktree_path: std::path::PathBuf::from(
                    "/tmp/repo/.lucode/worktrees/feature-consolidation",
                ),
                status: lucode::domains::sessions::entity::SessionStatus::Active,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                last_activity: Some(Utc::now()),
                initial_prompt: None,
                ready_to_merge: false,
                original_agent_type: Some("claude".to_string()),
                original_agent_model: None,
                pending_name_generation: false,
                was_auto_generated: false,
                spec_content: None,
                session_state: SessionState::Running,
                resume_allowed: true,
                amp_thread_id: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
                pr_state: None,
                is_consolidation: true,
                consolidation_sources: Some(vec![
                    "feature_v1".to_string(),
                    "feature_v2".to_string(),
                ]),
                consolidation_round_id: Some("round-1".to_string()),
                consolidation_role: Some("candidate".to_string()),
                consolidation_report: None,
                consolidation_report_source: None,
                consolidation_base_session_id: Some("feature_v1".to_string()),
                consolidation_recommended_session_id: None,
                consolidation_confirmation_mode: Some("confirm".to_string()),
                promotion_reason: None,
                ci_autofix_enabled: false,
                merged_at: None,
                task_id: None,
                task_stage: None,
                task_role: None,
            },
            None,
        );

        let serialized = serde_json::to_value(payload).expect("payload should serialize");
        assert_eq!(
            serialized.get("version_group_id"),
            Some(&Value::String("group-1".to_string()))
        );
        assert_eq!(serialized.get("version_number"), Some(&Value::from(2)));
    }

    #[test]
    fn persist_spec_content_with_refresh_requests_refresh_after_save() {
        let refresh_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let refresh_count_for_closure = refresh_count.clone();
        let persisted = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let persisted_for_closure = persisted.clone();

        persist_spec_content_with_refresh(
            "spec-refresh",
            "after",
            move |session_id, next_content| {
                persisted_for_closure
                    .lock()
                    .expect("persist log")
                    .push(format!("{session_id}:{next_content}"));
                Ok(())
            },
            move || {
                refresh_count_for_closure.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            },
        )
        .expect("spec content should update");

        assert_eq!(
            persisted.lock().expect("persisted entries").as_slice(),
            ["spec-refresh:after"],
        );
        assert_eq!(
            refresh_count.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "refresh callback should run exactly once"
        );
    }

    #[test]
    fn persist_spec_content_with_refresh_skips_refresh_after_failure() {
        let refresh_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let refresh_count_for_closure = refresh_count.clone();

        let result = persist_spec_content_with_refresh(
            "spec-refresh",
            "after",
            |_session_id, _next_content| Err("write failed".to_string()),
            move || {
                refresh_count_for_closure.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            },
        );

        assert_eq!(result, Err("write failed".to_string()));
        assert_eq!(
            refresh_count.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "refresh callback should not run after a failed save"
        );
    }
}

// Internal implementation used by both the Tauri command and unit tests
pub async fn reset_session_worktree_impl(
    app: Option<tauri::AppHandle>,
    session_name: String,
) -> Result<(), SchaltError> {
    log::info!("Resetting session worktree to base for: {session_name}");
    let core = get_core_write()
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?;
    let manager = core.session_manager();

    // Delegate to SessionManager (defensive checks live there)
    manager.reset_session_worktree(&session_name).map_err(|e| {
        let message = e.to_string();
        let normalized = message.to_lowercase();
        if normalized.contains("failed to get session")
            || normalized.contains("query returned no rows")
        {
            SchaltError::from_session_lookup(&session_name, message)
        } else {
            SchaltError::git("reset_session_worktree", message)
        }
    })?;

    // Emit sessions refreshed so UI updates its diffs/state when AppHandle is available
    if let Some(app_handle) = app {
        events::request_sessions_refreshed(&app_handle, events::SessionsRefreshReason::GitUpdate);
    }
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_reset_session_worktree(
    app: tauri::AppHandle,
    session_name: String,
) -> Result<(), SchaltError> {
    reset_session_worktree_impl(Some(app), session_name).await
}

#[tauri::command]
pub async fn schaltwerk_core_discard_file_in_session(
    session_name: String,
    file_path: String,
) -> Result<(), SchaltError> {
    log::info!("Discarding file changes in session '{session_name}' for path: {file_path}");
    let core = get_core_write()
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?;
    let manager = core.session_manager();
    manager
        .discard_file_in_session(&session_name, &file_path)
        .map_err(|e| {
            let message = e.to_string();
            let normalized = message.to_lowercase();
            if normalized.contains("failed to get session")
                || normalized.contains("query returned no rows")
            {
                SchaltError::from_session_lookup(&session_name, message)
            } else {
                SchaltError::git("discard_file_in_session", message)
            }
        })
}

#[tauri::command]
pub async fn schaltwerk_core_discard_file_in_orchestrator(
    file_path: String,
) -> Result<(), SchaltError> {
    log::info!("Discarding file changes in orchestrator for path: {file_path}");
    let core = get_core_write()
        .await
        .map_err(|e| SchaltError::DatabaseError {
            message: e.to_string(),
        })?;
    // Operate directly on the main repo workdir
    let repo_path = std::path::Path::new(&core.repo_path).to_path_buf();

    // Safety: disallow .lucode paths
    if file_path.starts_with(".lucode/") {
        return Err(SchaltError::invalid_input(
            "file_path",
            "Refusing to discard changes under .lucode",
        ));
    }

    lucode::domains::git::worktrees::discard_path_in_worktree(
        &repo_path,
        std::path::Path::new(&file_path),
        None,
    )
    .map_err(|e| SchaltError::git("discard_file_in_orchestrator", e))
}

#[tauri::command]
pub async fn session_set_autofix(
    session_name: String,
    enabled: bool,
    project_path: Option<String>,
) -> Result<(), String> {
    let core = get_core_read_for_project_path(project_path.as_deref())
        .await
        .map_err(|e| format!("Cannot load core: {e}"))?;
    let conn = core
        .db
        .get_conn()
        .map_err(|e| format!("Failed to get connection: {e}"))?;
    conn.execute(
        "UPDATE sessions SET ci_autofix_enabled = ?1 WHERE name = ?2 AND repository_path = ?3",
        rusqlite::params![
            enabled,
            session_name,
            core.repo_path.to_string_lossy().as_ref()
        ],
    )
    .map_err(|e| format!("Failed to update autofix: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn session_get_autofix(
    session_name: String,
    project_path: Option<String>,
) -> Result<bool, String> {
    let core = get_core_read_for_project_path(project_path.as_deref())
        .await
        .map_err(|e| format!("Cannot load core: {e}"))?;
    let manager = core.session_manager();
    let session = manager
        .get_session(&session_name)
        .map_err(|e| format!("Session not found: {e}"))?;
    Ok(session.ci_autofix_enabled)
}

#[tauri::command]
pub async fn session_try_autofix(
    app: tauri::AppHandle,
    session_name: String,
    ci_failed: bool,
    commit_sha: String,
    failing_jobs: Vec<String>,
    project_path: Option<String>,
) -> Result<bool, String> {
    if !ci_failed {
        return Ok(false);
    }

    let core = get_core_read_for_project_path(project_path.as_deref())
        .await
        .map_err(|e| format!("Cannot load core: {e}"))?;
    let manager = core.session_manager();
    let session = manager
        .get_session(&session_name)
        .map_err(|e| format!("Session not found: {e}"))?;

    if !session.ci_autofix_enabled {
        return Ok(false);
    }

    if session.session_state != lucode::domains::sessions::SessionState::Running {
        return Ok(false);
    }

    let conn = core
        .db
        .get_conn()
        .map_err(|e| format!("Failed to get connection: {e}"))?;

    let already_handled: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM autofix_attempts WHERE session_name = ?1 AND commit_sha = ?2 AND repository_path = ?3",
            rusqlite::params![session_name, commit_sha, core.repo_path.to_string_lossy().as_ref()],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if already_handled {
        log::debug!(
            "[autofix] Already handled failure for session={session_name} sha={commit_sha}"
        );
        return Ok(false);
    }

    conn.execute(
        "INSERT OR IGNORE INTO autofix_attempts (session_name, commit_sha, repository_path, attempted_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            session_name,
            commit_sha,
            core.repo_path.to_string_lossy().as_ref(),
            chrono::Utc::now().timestamp()
        ],
    )
    .map_err(|e| format!("Failed to record autofix attempt: {e}"))?;

    let job_names = if failing_jobs.is_empty() {
        "unknown".to_string()
    } else {
        failing_jobs.join(", ")
    };
    let failure_suffix = format!(
        "\n\n---\nCI failed on commit {commit_sha}. Failing jobs: {job_names}. Please inspect and fix."
    );

    let prompt_override =
        session.initial_prompt.as_deref().unwrap_or("").to_string() + &failure_suffix;

    let params = StartAgentParams {
        session_name: session_name.clone(),
        force_restart: true,
        cols: None,
        rows: None,
        terminal_id: None,
        agent_type: session.original_agent_type.clone(),
        prompt: Some(prompt_override),
        skip_prompt: Some(false),
    };

    log::info!(
        "[autofix] Restarting agent for session={session_name} due to CI failure on {commit_sha}"
    );

    match schaltwerk_core_start_session_agent_with_restart(app, params).await {
        Ok(_) => Ok(true),
        Err(e) => {
            log::error!("[autofix] Failed to restart agent for {session_name}: {e}");
            Err(format!("Autofix restart failed: {e}"))
        }
    }
}

#[cfg(test)]
mod agent_start_mode_tests {
    use super::*;

    #[test]
    fn chooses_fresh_when_no_tmux_session_exists() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: false,
            tmux_session_alive: false,
            agent_pane_alive: None,
            agent_type_override_differs: false,
        });

        assert_eq!(mode, AgentStartMode::Fresh);
    }

    #[test]
    fn chooses_reattach_for_existing_live_session_without_force() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: false,
            tmux_session_alive: true,
            agent_pane_alive: Some(true),
            agent_type_override_differs: false,
        });

        assert_eq!(mode, AgentStartMode::Reattach);
    }

    #[test]
    fn surfaces_restart_for_existing_dead_pane_without_force() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: false,
            tmux_session_alive: true,
            agent_pane_alive: Some(false),
            agent_type_override_differs: false,
        });

        assert_eq!(mode, AgentStartMode::DeadPaneSurfaceRestart);
    }

    #[test]
    fn force_restart_wins_over_existing_live_session() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: true,
            tmux_session_alive: true,
            agent_pane_alive: Some(true),
            agent_type_override_differs: false,
        });

        assert_eq!(mode, AgentStartMode::ForcedRestart);
    }

    #[test]
    fn differing_agent_type_override_forces_restart() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: false,
            tmux_session_alive: true,
            agent_pane_alive: Some(true),
            agent_type_override_differs: true,
        });

        assert_eq!(mode, AgentStartMode::ForcedRestart);
    }

    #[test]
    fn agent_type_override_differs_when_recorded_type_is_missing() {
        assert!(does_agent_type_override_differ(Some("codex"), None));
    }

    #[test]
    fn differing_agent_type_override_without_tmux_starts_fresh() {
        let mode = decide_agent_start_mode(StartModeInputs {
            force_restart: false,
            tmux_session_alive: false,
            agent_pane_alive: None,
            agent_type_override_differs: true,
        });

        assert_eq!(mode, AgentStartMode::Fresh);
    }

    #[test]
    fn prompt_override_persists_only_for_launching_modes() {
        assert!(should_persist_prompt_override(AgentStartMode::Fresh));
        assert!(should_persist_prompt_override(
            AgentStartMode::ForcedRestart
        ));
        assert!(!should_persist_prompt_override(AgentStartMode::Reattach));
        assert!(!should_persist_prompt_override(
            AgentStartMode::DeadPaneSurfaceRestart
        ));
    }
}

#[cfg(test)]
mod reset_tests {
    use super::*;

    #[tokio::test]
    async fn test_reset_session_worktree_requires_project() {
        // Without a project initialized, expect a readable error
        let result = reset_session_worktree_impl(None, "nope".to_string()).await;
        assert!(result.is_err());
        let msg = result.err().unwrap().to_string();
        assert!(
            msg.contains("No active project")
                || msg.contains("Failed to get lucode core")
                || msg.contains("No project is currently open")
        );
    }
}
