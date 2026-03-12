use anyhow::{Result, anyhow};
use tokio::process::Command;

pub struct CommitMessageArgs<'a> {
    pub agent_type: &'a str,
    pub commit_subjects: &'a [String],
    pub changed_files_summary: &'a str,
    pub cli_args: Option<&'a str>,
    pub env_vars: &'a [(String, String)],
    pub binary_path: Option<&'a str>,
    pub custom_commit_prompt: Option<&'a str>,
}

fn build_commits_section(subjects: &[String]) -> String {
    if subjects.is_empty() {
        "No commits yet (uncommitted changes only).".to_string()
    } else {
        subjects
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn build_prompt(subjects: &[String], files_summary: &str) -> String {
    let commits_section = build_commits_section(subjects);

    format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a concise squash commit message for the following changes being merged.

Commits:
{commits_section}

Changed files:
{files_summary}

Rules:
- Write a single-line summary (max 72 chars), optionally followed by a blank line and bullet points
- Use conventional commit format: type(scope): description
- Common types: feat, fix, refactor, chore, docs, style, test, perf
- Focus on WHAT changed and WHY, not HOW
- Do NOT include any markdown formatting, code blocks, or explanation
- Return ONLY the commit message text, nothing else
- Do NOT use tools or commands"#
    )
}

fn resolve_commit_prompt(
    custom_commit_prompt: Option<&str>,
    commit_subjects: &[String],
    changed_files_summary: &str,
) -> String {
    if let Some(custom) = custom_commit_prompt.filter(|p| !p.is_empty()) {
        let commits_section = build_commits_section(commit_subjects);
        custom
            .replace("{commits}", &commits_section)
            .replace("{files}", changed_files_summary)
    } else {
        build_prompt(commit_subjects, changed_files_summary)
    }
}

fn build_env(env_vars: &[(String, String)]) -> Vec<(String, String)> {
    let mut combined = vec![
        ("NO_COLOR".to_string(), "1".to_string()),
        ("CLICOLOR".to_string(), "0".to_string()),
        ("TERM".to_string(), "dumb".to_string()),
        ("CI".to_string(), "1".to_string()),
        ("NONINTERACTIVE".to_string(), "1".to_string()),
    ];
    combined.extend(env_vars.iter().cloned());
    combined
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{001b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() || c == '~' {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn parse_output(stdout: &str) -> Option<String> {
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(stdout);
    let text = if let Ok(v) = parsed {
        v.as_str()
            .or_else(|| v.get("result").and_then(|x| x.as_str()))
            .map(|s| s.to_string())
    } else {
        None
    }
    .unwrap_or_else(|| stdout.to_string());

    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub async fn generate_commit_message(args: CommitMessageArgs<'_>) -> Result<Option<String>> {
    let CommitMessageArgs {
        agent_type,
        commit_subjects,
        changed_files_summary,
        cli_args,
        env_vars,
        binary_path,
        custom_commit_prompt,
    } = args;

    let prompt = resolve_commit_prompt(custom_commit_prompt, commit_subjects, changed_files_summary);
    let temp_dir = std::env::temp_dir().join("lucode_commitmsg");
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        log::warn!("Failed to create temp directory for commit message gen: {e}");
    }

    if agent_type == "claude" {
        let binary = binary_path
            .map(|s| s.to_string())
            .unwrap_or_else(super::claude::resolve_claude_binary);

        let mut cmd_args: Vec<String> = Vec::new();
        if let Some(raw) = cli_args {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                cmd_args =
                    shell_words::split(trimmed).unwrap_or_else(|_| vec![trimmed.to_string()]);
            }
        }
        let has_output_format = cmd_args
            .iter()
            .any(|t| t == "--output-format" || t.starts_with("--output-format="));
        cmd_args.push("--print".to_string());
        cmd_args.push(prompt);
        if !has_output_format {
            cmd_args.push("--output-format".to_string());
            cmd_args.push("json".to_string());
        }

        let output = Command::new(&binary)
            .args(&cmd_args)
            .current_dir(&temp_dir)
            .stdin(std::process::Stdio::null())
            .envs(build_env(env_vars))
            .output()
            .await
            .map_err(|e| anyhow!("Failed to execute {binary}: {e}"))?;

        if output.status.success() {
            let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
            return Ok(parse_output(&stdout));
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Agent returned non-zero: {}", stderr.trim());
        return Ok(None);
    }

    if agent_type == "codex" {
        let mut cmd_args: Vec<String> = vec![
            "exec".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--skip-git-repo-check".into(),
            "--json".into(),
        ];
        if let Some(cli) = cli_args {
            let mut extra =
                shell_words::split(cli).unwrap_or_else(|_| vec![cli.to_string()]);
            extra.retain(|a| a != "--search" && a != "-search");
            cmd_args.extend(extra);
        }
        let tmp_file = std::env::temp_dir().join("lucode_codex_commitmsg.txt");
        cmd_args.push("--output-last-message".into());
        cmd_args.push(tmp_file.to_string_lossy().to_string());
        cmd_args.push(prompt);

        let output = Command::new("codex")
            .args(&cmd_args)
            .current_dir(&temp_dir)
            .stdin(std::process::Stdio::null())
            .envs(build_env(env_vars))
            .output()
            .await;

        if let Ok(output) = output {
            if !output.status.success() {
                return Ok(None);
            }
            let candidate = std::fs::read_to_string(&tmp_file)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
                    parse_output(&stdout)
                });
            return Ok(candidate);
        }
        return Ok(None);
    }

    if agent_type == "gemini" {
        let binary = super::gemini::resolve_gemini_binary();
        let result = Command::new(&binary)
            .args(["--prompt", &prompt])
            .current_dir(&temp_dir)
            .stdin(std::process::Stdio::null())
            .envs(build_env(env_vars))
            .output()
            .await;

        return match result {
            Ok(output) if output.status.success() => {
                let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
                Ok(parse_output(&stdout))
            }
            _ => Ok(None),
        };
    }

    if agent_type == "opencode" || agent_type == "kilocode" {
        let binary = if agent_type == "opencode" {
            super::opencode::resolve_opencode_binary()
        } else {
            "kilocode".to_string()
        };

        let result = Command::new(&binary)
            .args(["run", &prompt])
            .current_dir(&temp_dir)
            .stdin(std::process::Stdio::null())
            .envs(build_env(env_vars))
            .output()
            .await;

        return match result {
            Ok(output) if output.status.success() => {
                let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
                Ok(parse_output(&stdout))
            }
            _ => Ok(None),
        };
    }

    log::info!("Agent type '{agent_type}' not supported for commit message generation");
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_with_commits() {
        let subjects = vec![
            "fix: resolve login redirect".to_string(),
            "test: add auth tests".to_string(),
        ];
        let files = "M src/auth.rs (+10 -3)\nA src/auth.test.rs (+25)";
        let result = build_prompt(&subjects, files);
        assert!(result.contains("fix: resolve login redirect"));
        assert!(result.contains("test: add auth tests"));
        assert!(result.contains("M src/auth.rs"));
    }

    #[test]
    fn build_prompt_without_commits() {
        let subjects: Vec<String> = vec![];
        let files = "A src/new.rs (+10)";
        let result = build_prompt(&subjects, files);
        assert!(result.contains("No commits yet"));
    }

    #[test]
    fn parse_output_json() {
        let result = parse_output(r#""feat(auth): add login flow""#);
        assert_eq!(result, Some("feat(auth): add login flow".to_string()));
    }

    #[test]
    fn parse_output_json_result_field() {
        let result = parse_output(r#"{"result": "fix: resolve bug"}"#);
        assert_eq!(result, Some("fix: resolve bug".to_string()));
    }

    #[test]
    fn parse_output_plain_text() {
        let result = parse_output("feat(ui): add dark mode toggle\n");
        assert_eq!(
            result,
            Some("feat(ui): add dark mode toggle".to_string())
        );
    }

    #[test]
    fn parse_output_empty() {
        assert_eq!(parse_output(""), None);
        assert_eq!(parse_output("   "), None);
    }

    #[test]
    fn strip_ansi_codes() {
        let input = "\x1b[32mfeat: hello\x1b[0m";
        assert_eq!(strip_ansi(input), "feat: hello");
    }

    #[test]
    fn resolve_commit_prompt_uses_default_when_none() {
        let subjects = vec!["fix: bug".to_string()];
        let files = "M src/lib.rs (+5 -2)";
        let result = resolve_commit_prompt(None, &subjects, files);
        assert!(result.contains("conventional commit format"));
        assert!(result.contains("fix: bug"));
    }

    #[test]
    fn resolve_commit_prompt_uses_default_when_empty() {
        let subjects = vec!["fix: bug".to_string()];
        let files = "M src/lib.rs (+5 -2)";
        let result = resolve_commit_prompt(Some(""), &subjects, files);
        assert!(result.contains("conventional commit format"));
    }

    #[test]
    fn resolve_commit_prompt_substitutes_custom_template() {
        let subjects = vec![
            "feat: add auth".to_string(),
            "test: auth tests".to_string(),
        ];
        let files = "M src/auth.rs (+10 -3)";
        let result = resolve_commit_prompt(
            Some("Summarize:\n{commits}\n\nFiles:\n{files}"),
            &subjects,
            files,
        );
        assert!(result.contains("- feat: add auth"));
        assert!(result.contains("- test: auth tests"));
        assert!(result.contains("M src/auth.rs (+10 -3)"));
        assert!(!result.contains("conventional commit format"));
    }

    #[test]
    fn resolve_commit_prompt_custom_with_empty_commits() {
        let subjects: Vec<String> = vec![];
        let files = "A src/new.rs (+20)";
        let result = resolve_commit_prompt(
            Some("Changes: {commits}\nFiles: {files}"),
            &subjects,
            files,
        );
        assert!(result.contains("No commits yet"));
        assert!(result.contains("A src/new.rs (+20)"));
    }
}
