use crate::domains::sessions::entity::Session;
use crate::domains::sessions::repository::SessionDbManager;
use anyhow::Result;
use chrono::Utc;
use log::{info, warn};
use std::path::Path;
use std::process::Command;

pub const STUB_SOURCE: &str = "auto_stub";
pub const AGENT_SOURCE: &str = "agent";

const DIFF_BYTE_LIMIT: usize = 4 * 1024;
const LOG_LINE_LIMIT: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StubWriteOutcome {
    Written,
    AlreadyReported,
    NotACandidate,
    RoundPromoted,
    NoRound,
}

pub fn delete_stub_report_for_session_name(
    db_manager: &SessionDbManager,
    session_name: &str,
) -> Result<usize> {
    db_manager.clear_auto_stub_consolidation_report_by_name(session_name)
}

pub fn delete_stub_report_for_session_id(
    db_manager: &SessionDbManager,
    session_id: &str,
) -> Result<usize> {
    db_manager.clear_auto_stub_consolidation_report_by_id(session_id)
}

pub fn ensure_stub_report_for_candidate(
    db_manager: &SessionDbManager,
    session: &Session,
    reason_state: &str,
) -> Result<StubWriteOutcome> {
    let Some(round_id) = session.consolidation_round_id.as_deref() else {
        return Ok(StubWriteOutcome::NoRound);
    };

    if session.consolidation_role.as_deref() != Some("candidate") {
        return Ok(StubWriteOutcome::NotACandidate);
    }

    if report_is_present(session) {
        return Ok(StubWriteOutcome::AlreadyReported);
    }

    let round = db_manager.get_consolidation_round(round_id)?;
    if round.status == "promoted" {
        return Ok(StubWriteOutcome::RoundPromoted);
    }

    let body = build_stub_report_body(session, reason_state);

    db_manager.update_session_consolidation_report(
        &session.name,
        &body,
        Some(&session.id),
        None,
        STUB_SOURCE,
    )?;

    info!(
        "Auto-filed consolidation stub report for candidate '{}' in round '{}'",
        session.name, round_id
    );
    Ok(StubWriteOutcome::Written)
}

fn report_is_present(session: &Session) -> bool {
    session
        .consolidation_report
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn build_stub_report_body(session: &Session, reason_state: &str) -> String {
    let now = Utc::now().to_rfc3339();
    let mut out = String::new();
    out.push_str("## Auto-filed stub report (session exited without filing)\n\n");
    out.push_str(&format!(
        "Session `{}` transitioned to {} at {} without filing a consolidation report.\n\n",
        session.name, reason_state, now
    ));

    let diff = collect_branch_diff(session);
    out.push_str("### Branch diff (`git diff --stat`)\n");
    if diff.trim().is_empty() {
        out.push_str("_No diff available._\n");
    } else {
        out.push_str("```\n");
        out.push_str(&diff);
        if !diff.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("```\n");
    }
    out.push('\n');

    let log = collect_branch_log(session);
    out.push_str("### Commits (`git log --oneline`)\n");
    if log.trim().is_empty() {
        out.push_str("_No commits available._\n");
    } else {
        out.push_str("```\n");
        out.push_str(&log);
        if !log.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("```\n");
    }
    out.push('\n');

    out.push_str("_No agent-authored analysis available._\n");
    out
}

fn collect_branch_diff(session: &Session) -> String {
    let Some(range) = branch_range(session) else {
        return String::new();
    };
    let worktree = resolve_worktree_for_git(session);
    run_git(worktree, &["diff", "--stat", &range])
        .map(|out| truncate_bytes(&out, DIFF_BYTE_LIMIT))
        .unwrap_or_default()
}

fn collect_branch_log(session: &Session) -> String {
    let Some(range) = branch_range(session) else {
        return String::new();
    };
    let worktree = resolve_worktree_for_git(session);
    run_git(worktree, &["log", "--oneline", &range])
        .map(|out| cap_lines(&out, LOG_LINE_LIMIT))
        .unwrap_or_default()
}

fn branch_range(session: &Session) -> Option<String> {
    let parent = session.parent_branch.trim();
    let branch = session.branch.trim();
    if parent.is_empty() || branch.is_empty() {
        return None;
    }
    Some(format!("{parent}...{branch}"))
}

fn resolve_worktree_for_git(session: &Session) -> &Path {
    if session.worktree_path.exists() {
        return session.worktree_path.as_path();
    }
    session.repository_path.as_path()
}

fn run_git(cwd: &Path, args: &[&str]) -> Option<String> {
    match Command::new("git").args(args).current_dir(cwd).output() {
        Ok(output) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).to_string())
        }
        Ok(output) => {
            warn!(
                "git {:?} failed in {} (status {}): {}",
                args,
                cwd.display(),
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            None
        }
        Err(e) => {
            warn!("git {:?} could not run in {}: {}", args, cwd.display(), e);
            None
        }
    }
}

fn truncate_bytes(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    let cut = s
        .char_indices()
        .take_while(|(i, _)| *i < limit)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    format!("{}\n…(truncated)\n", &s[..cut])
}

fn cap_lines(s: &str, limit: usize) -> String {
    let mut lines: Vec<&str> = s.lines().take(limit).collect();
    let more = s.lines().nth(limit).is_some();
    if more {
        lines.push("…(truncated)");
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::entity::Session;
    use crate::infrastructure::database::Database;
    use chrono::Utc;
    use std::path::PathBuf;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn make_session(repo: &Path, name: &str, role: Option<&str>, round: Option<&str>) -> Session {
        let worktree = repo.join(format!(".lucode/worktrees/{name}"));
        Session {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            display_name: None,
            version_group_id: Some("group-1".to_string()),
            version_number: Some(1),
            epic_id: None,
            repository_path: repo.to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: format!("lucode/{name}"),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: worktree,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_agent_model: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            resume_allowed: true,
            amp_thread_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            is_consolidation: role.is_some(),
            consolidation_sources: None,
            consolidation_round_id: round.map(str::to_string),
            consolidation_role: role.map(str::to_string),
            consolidation_report: None,
            consolidation_report_source: None,
            consolidation_base_session_id: None,
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: Some("confirm".to_string()),
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,
            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
            is_spec: false,
            cancelled_at: None,
        }
    }

    fn setup() -> (TempDir, PathBuf, SessionDbManager) {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().to_path_buf();
        let db = Database::new(Some(repo.join("test.db"))).unwrap();
        let manager = SessionDbManager::new(db, repo.clone());
        (tmp, repo, manager)
    }

    #[test]
    fn writes_stub_for_candidate_without_report() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        let outcome = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(outcome, StubWriteOutcome::Written);

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        let body = loaded.consolidation_report.expect("report filed");
        assert!(body.contains("Auto-filed stub report"));
        assert!(body.contains("cancelled"));
        assert_eq!(
            loaded.consolidation_report_source.as_deref(),
            Some(STUB_SOURCE)
        );
        assert_eq!(
            loaded.consolidation_base_session_id.as_deref(),
            Some(session.id.as_str())
        );
    }

    #[test]
    fn skips_when_report_already_present() {
        let (_tmp, repo, manager) = setup();
        let mut session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        session.consolidation_report = Some("agent said X".to_string());
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        let outcome = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(outcome, StubWriteOutcome::AlreadyReported);

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        assert_eq!(loaded.consolidation_report.as_deref(), Some("agent said X"));
        assert!(loaded.consolidation_report_source.is_none());
    }

    #[test]
    fn skips_when_not_a_candidate() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "judge", Some("judge"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        let outcome = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(outcome, StubWriteOutcome::NotACandidate);
    }

    #[test]
    fn skips_when_no_round() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "free", None, None);
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();

        let outcome = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(outcome, StubWriteOutcome::NoRound);
    }

    #[test]
    fn skips_when_round_is_promoted() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();
        manager
            .update_consolidation_round_confirmation("r-1", "winner-id", "judge")
            .unwrap();

        let outcome = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(outcome, StubWriteOutcome::RoundPromoted);
    }

    #[test]
    fn calling_twice_is_idempotent() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        let first = ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();
        assert_eq!(first, StubWriteOutcome::Written);

        // Refresh from DB for accurate `consolidation_report` state on second call.
        let reloaded = manager.get_session_by_name(&session.name).unwrap();
        let second = ensure_stub_report_for_candidate(&manager, &reloaded, "cancelled").unwrap();
        assert_eq!(second, StubWriteOutcome::AlreadyReported);
    }

    #[test]
    fn delete_stub_report_for_session_name_only_clears_auto_stub() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();

        let affected = delete_stub_report_for_session_name(&manager, &session.name).unwrap();
        assert_eq!(affected, 1);

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        assert!(loaded.consolidation_report.is_none());
        assert!(loaded.consolidation_report_source.is_none());
    }

    #[test]
    fn delete_stub_report_for_session_name_preserves_agent_report() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        manager
            .update_session_consolidation_report(
                &session.name,
                "## Real agent report",
                Some(&session.id),
                None,
                AGENT_SOURCE,
            )
            .unwrap();

        let affected = delete_stub_report_for_session_name(&manager, &session.name).unwrap();
        assert_eq!(affected, 0);

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        assert_eq!(
            loaded.consolidation_report.as_deref(),
            Some("## Real agent report")
        );
        assert_eq!(
            loaded.consolidation_report_source.as_deref(),
            Some(AGENT_SOURCE)
        );
    }

    #[test]
    fn delete_stub_report_for_session_id_only_clears_auto_stub() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();

        let affected = delete_stub_report_for_session_id(&manager, &session.id).unwrap();
        assert_eq!(affected, 1);

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        assert!(loaded.consolidation_report.is_none());
        assert!(loaded.consolidation_report_source.is_none());
    }

    #[test]
    fn stub_is_overwritten_when_agent_files_real_report() {
        let (_tmp, repo, manager) = setup();
        let session = make_session(&repo, "cand", Some("candidate"), Some("r-1"));
        use crate::domains::sessions::db_sessions::SessionMethods;
        manager.db_ref().create_session(&session).unwrap();
        manager
            .upsert_consolidation_round("r-1", "group-1", &[], "confirm")
            .unwrap();

        ensure_stub_report_for_candidate(&manager, &session, "cancelled").unwrap();

        manager
            .update_session_consolidation_report(
                &session.name,
                "## Real agent report",
                Some("other-source-id"),
                None,
                AGENT_SOURCE,
            )
            .unwrap();

        let loaded = manager.get_session_by_name(&session.name).unwrap();
        assert_eq!(
            loaded.consolidation_report.as_deref(),
            Some("## Real agent report")
        );
        assert_eq!(
            loaded.consolidation_report_source.as_deref(),
            Some(AGENT_SOURCE)
        );
    }
}
