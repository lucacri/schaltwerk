use std::env;
use std::io;
use std::path::PathBuf;
use std::sync::OnceLock;

use log::{debug, info, warn};

use super::github_cli::{CommandRunner, SystemCommandRunner};

#[derive(Debug)]
pub enum GitlabCliError {
    NotInstalled,
    NoGitRemote,
    CommandFailed {
        program: String,
        args: Vec<String>,
        status: Option<i32>,
        stdout: String,
        stderr: String,
    },
    Io(io::Error),
    Json(serde_json::Error),
    Git(anyhow::Error),
    InvalidInput(String),
    InvalidOutput(String),
}

impl std::fmt::Display for GitlabCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitlabCliError::NotInstalled => write!(f, "GitLab CLI (glab) is not installed."),
            GitlabCliError::NoGitRemote => {
                write!(f, "No Git remotes configured for this repository.")
            }
            GitlabCliError::CommandFailed {
                program,
                status,
                stderr,
                ..
            } => write!(
                f,
                "Command `{program}` failed with status {status:?}: {stderr}"
            ),
            GitlabCliError::Io(err) => write!(f, "IO error: {err}"),
            GitlabCliError::Json(err) => write!(f, "JSON error: {err}"),
            GitlabCliError::Git(err) => write!(f, "Git error: {err}"),
            GitlabCliError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            GitlabCliError::InvalidOutput(msg) => write!(f, "Invalid CLI output: {msg}"),
        }
    }
}

impl std::error::Error for GitlabCliError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            GitlabCliError::Io(err) => Some(err),
            GitlabCliError::Json(err) => Some(err),
            GitlabCliError::Git(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for GitlabCliError {
    fn from(value: serde_json::Error) -> Self {
        GitlabCliError::Json(value)
    }
}

pub struct GitlabCli<R: CommandRunner = SystemCommandRunner> {
    runner: R,
    program: String,
}

impl GitlabCli<SystemCommandRunner> {
    pub fn new() -> Self {
        Self {
            runner: SystemCommandRunner,
            program: resolve_gitlab_cli_program(),
        }
    }
}

impl Default for GitlabCli<SystemCommandRunner> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: CommandRunner> GitlabCli<R> {
    pub fn with_runner(runner: R) -> Self {
        Self {
            runner,
            program: "glab".to_string(),
        }
    }

    pub fn ensure_installed(&self) -> Result<(), GitlabCliError> {
        debug!(
            "[GitlabCli] Checking if GitLab CLI is installed: program='{}', PATH={}",
            self.program,
            std::env::var("PATH").unwrap_or_else(|_| "<not set>".to_string())
        );
        match self.runner.run(&self.program, &["--version"], None, &[]) {
            Ok(output) => {
                if output.success() {
                    if GITLAB_CLI_VERSION_LOGGED.set(()).is_ok() {
                        info!("GitLab CLI detected: {}", output.stdout.trim());
                    } else {
                        debug!("GitLab CLI detected: {}", output.stdout.trim());
                    }
                    Ok(())
                } else {
                    debug!(
                        "GitLab CLI version command failed with status {:?}: stdout={}, stderr={}",
                        output.status, output.stdout, output.stderr
                    );
                    Err(GitlabCliError::NotInstalled)
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                debug!("GitLab CLI binary not found at '{}'", self.program);
                Err(GitlabCliError::NotInstalled)
            }
            Err(err) => {
                debug!("GitLab CLI check failed with IO error: {err}");
                Err(GitlabCliError::Io(err))
            }
        }
    }
}

pub fn map_runner_error(err: io::Error) -> GitlabCliError {
    if err.kind() == io::ErrorKind::NotFound {
        GitlabCliError::NotInstalled
    } else {
        GitlabCliError::Io(err)
    }
}

pub fn command_failure(
    program: &str,
    args: &[String],
    output: super::github_cli::CommandOutput,
) -> GitlabCliError {
    GitlabCliError::CommandFailed {
        program: program.to_string(),
        args: args.to_vec(),
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    }
}

pub fn format_cli_error(err: GitlabCliError) -> String {
    match err {
        GitlabCliError::NotInstalled => {
            #[cfg(target_os = "macos")]
            {
                "GitLab CLI (glab) is not installed. Install it via `brew install glab`.".to_string()
            }
            #[cfg(target_os = "windows")]
            {
                "GitLab CLI (glab) is not installed. Install it via `scoop install glab` or `winget install GLab.GLab`.".to_string()
            }
            #[cfg(target_os = "linux")]
            {
                "GitLab CLI (glab) is not installed. See https://gitlab.com/gitlab-org/cli#installation".to_string()
            }
        }
        GitlabCliError::CommandFailed {
            program,
            args,
            stdout,
            stderr,
            ..
        } => {
            let details = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };
            format!(
                "{} command failed ({}): {}",
                program,
                args.join(" "),
                details.trim()
            )
        }
        GitlabCliError::Io(err) => err.to_string(),
        GitlabCliError::Json(err) => format!("Failed to parse GitLab CLI response: {err}"),
        GitlabCliError::Git(err) => format!("Git operation failed: {err}"),
        GitlabCliError::InvalidInput(msg) => msg,
        GitlabCliError::InvalidOutput(msg) => msg,
        GitlabCliError::NoGitRemote => {
            "No Git remotes configured for this project. Add a remote (e.g. `git remote add origin ...`) and try again.".to_string()
        }
    }
}

pub fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }

    result
}

static GLAB_PROGRAM_CACHE: OnceLock<String> = OnceLock::new();
static GITLAB_CLI_VERSION_LOGGED: OnceLock<()> = OnceLock::new();

fn resolve_gitlab_cli_program() -> String {
    GLAB_PROGRAM_CACHE
        .get_or_init(resolve_gitlab_cli_program_uncached)
        .clone()
}

fn resolve_gitlab_cli_program_uncached() -> String {
    if let Ok(custom) = env::var("GITLAB_CLI_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitlabCli] Using GITLAB_CLI_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    if let Ok(custom) = env::var("GLAB_BINARY_PATH") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            log::info!("[GitlabCli] Using GLAB_BINARY_PATH override: {trimmed}");
            return trimmed.to_string();
        }
    }

    let command = "glab";

    #[cfg(unix)]
    {
        if let Ok(home) = env::var("HOME") {
            let user_paths = [
                format!("{home}/.local/bin"),
                format!("{home}/.cargo/bin"),
                format!("{home}/bin"),
            ];

            for path in &user_paths {
                let full_path = PathBuf::from(path).join(command);
                if full_path.exists() {
                    let resolved = full_path.to_string_lossy().to_string();
                    log::info!("[GitlabCli] Found glab in user path: {resolved}");
                    return resolved;
                }
            }
        }

        let common_paths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

        for path in &common_paths {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                let resolved = full_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in common path: {resolved}");
                return resolved;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(program_files) = env::var("ProgramFiles") {
            let glab_path = PathBuf::from(&program_files).join("glab").join("glab.exe");
            if glab_path.exists() {
                let resolved = glab_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in Program Files: {resolved}");
                return resolved;
            }
        }

        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let winget_path = PathBuf::from(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("glab.exe");
            if winget_path.exists() {
                let resolved = winget_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in WinGet Links: {resolved}");
                return resolved;
            }

            let scoop_shims = PathBuf::from(&local_app_data)
                .join("scoop")
                .join("shims")
                .join("glab.exe");
            if scoop_shims.exists() {
                let resolved = scoop_shims.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in Scoop shims: {resolved}");
                return resolved;
            }
        }

        if let Ok(userprofile) = env::var("USERPROFILE") {
            let scoop_path = PathBuf::from(&userprofile)
                .join("scoop")
                .join("shims")
                .join("glab.exe");
            if scoop_path.exists() {
                let resolved = scoop_path.to_string_lossy().to_string();
                log::info!("[GitlabCli] Found glab in user Scoop shims: {resolved}");
                return resolved;
            }
        }
    }

    if let Ok(path) = which::which(command) {
        let path_str = path.to_string_lossy().to_string();
        log::info!("[GitlabCli] Found glab via which crate: {path_str}");

        #[cfg(windows)]
        {
            let resolved = crate::shared::resolve_windows_executable(&path_str);
            log::info!("[GitlabCli] Windows executable resolution: {path_str} -> {resolved}");
            return resolved;
        }

        #[cfg(not(windows))]
        return path_str;
    }

    warn!("[GitlabCli] Falling back to plain 'glab' - binary may not be found");
    command.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::github_cli::CommandOutput;
    use std::collections::VecDeque;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    #[derive(Default, Clone)]
    struct MockRunner {
        responses: Arc<Mutex<VecDeque<io::Result<CommandOutput>>>>,
    }

    impl MockRunner {
        fn push_response(&self, response: io::Result<CommandOutput>) {
            self.responses.lock().unwrap().push_back(response);
        }
    }

    impl CommandRunner for MockRunner {
        fn run(
            &self,
            _program: &str,
            _args: &[&str],
            _current_dir: Option<&Path>,
            _env: &[(&str, &str)],
        ) -> io::Result<CommandOutput> {
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| {
                    Err(io::Error::new(
                        io::ErrorKind::Other,
                        "no mock response queued",
                    ))
                })
        }
    }

    #[test]
    fn ensure_installed_succeeds_when_glab_found() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "glab version 1.46.0 (2024-10-01)".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);

        assert!(cli.ensure_installed().is_ok());
    }

    #[test]
    fn ensure_installed_fails_when_not_found() {
        let runner = MockRunner::default();
        runner.push_response(Err(io::Error::new(
            io::ErrorKind::NotFound,
            "glab missing",
        )));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn ensure_installed_fails_on_nonzero_exit() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: "unknown command".to_string(),
        }));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn ensure_installed_returns_io_error_for_non_notfound() {
        let runner = MockRunner::default();
        runner.push_response(Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "permission denied",
        )));
        let cli = GitlabCli::with_runner(runner);

        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::Io(_)));
    }

    #[test]
    fn format_cli_error_not_installed() {
        let msg = format_cli_error(GitlabCliError::NotInstalled);
        assert!(msg.contains("glab"));
        assert!(msg.contains("not installed"));
    }

    #[test]
    fn format_cli_error_command_failed_prefers_stderr() {
        let msg = format_cli_error(GitlabCliError::CommandFailed {
            program: "glab".to_string(),
            args: vec!["mr".to_string(), "list".to_string()],
            status: Some(1),
            stdout: "ignored stdout".to_string(),
            stderr: "something went wrong".to_string(),
        });
        assert!(msg.contains("something went wrong"));
        assert!(msg.contains("glab"));
    }

    #[test]
    fn format_cli_error_command_failed_falls_back_to_stdout() {
        let msg = format_cli_error(GitlabCliError::CommandFailed {
            program: "glab".to_string(),
            args: vec!["issue".to_string()],
            status: Some(1),
            stdout: "stdout fallback".to_string(),
            stderr: "   ".to_string(),
        });
        assert!(msg.contains("stdout fallback"));
    }

    #[test]
    fn format_cli_error_no_git_remote() {
        let msg = format_cli_error(GitlabCliError::NoGitRemote);
        assert!(msg.contains("No Git remotes"));
    }

    #[test]
    fn format_cli_error_io() {
        let msg = format_cli_error(GitlabCliError::Io(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "broken pipe",
        )));
        assert!(msg.contains("broken pipe"));
    }

    #[test]
    fn format_cli_error_json() {
        let json_err = serde_json::from_str::<String>("not json").unwrap_err();
        let msg = format_cli_error(GitlabCliError::Json(json_err));
        assert!(msg.contains("parse GitLab CLI response"));
    }

    #[test]
    fn format_cli_error_git() {
        let msg = format_cli_error(GitlabCliError::Git(anyhow::anyhow!("repo corrupt")));
        assert!(msg.contains("Git operation failed"));
    }

    #[test]
    fn format_cli_error_invalid_input() {
        let msg = format_cli_error(GitlabCliError::InvalidInput("bad query".to_string()));
        assert_eq!(msg, "bad query");
    }

    #[test]
    fn format_cli_error_invalid_output() {
        let msg = format_cli_error(GitlabCliError::InvalidOutput("garbled".to_string()));
        assert_eq!(msg, "garbled");
    }

    #[test]
    fn display_impl_covers_all_variants() {
        let variants: Vec<GitlabCliError> = vec![
            GitlabCliError::NotInstalled,
            GitlabCliError::NoGitRemote,
            GitlabCliError::CommandFailed {
                program: "glab".into(),
                args: vec![],
                status: Some(1),
                stdout: String::new(),
                stderr: "fail".into(),
            },
            GitlabCliError::Io(io::Error::new(io::ErrorKind::Other, "io")),
            GitlabCliError::Json(serde_json::from_str::<String>("x").unwrap_err()),
            GitlabCliError::Git(anyhow::anyhow!("git")),
            GitlabCliError::InvalidInput("input".into()),
            GitlabCliError::InvalidOutput("output".into()),
        ];
        for v in variants {
            let display = format!("{v}");
            assert!(!display.is_empty());
        }
    }

    #[test]
    fn map_runner_error_maps_not_found_to_not_installed() {
        let err = map_runner_error(io::Error::new(io::ErrorKind::NotFound, "not found"));
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }

    #[test]
    fn map_runner_error_maps_other_to_io() {
        let err = map_runner_error(io::Error::new(io::ErrorKind::BrokenPipe, "broken"));
        assert!(matches!(err, GitlabCliError::Io(_)));
    }

    #[test]
    fn command_failure_builds_error_from_output() {
        let output = CommandOutput {
            status: Some(2),
            stdout: "out".to_string(),
            stderr: "err".to_string(),
        };
        let err = command_failure("glab", &["mr".to_string(), "list".to_string()], output);
        match err {
            GitlabCliError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            } => {
                assert_eq!(program, "glab");
                assert_eq!(args, vec!["mr", "list"]);
                assert_eq!(status, Some(2));
                assert_eq!(stdout, "out");
                assert_eq!(stderr, "err");
            }
            _ => panic!("expected CommandFailed variant"),
        }
    }

    #[test]
    fn strip_ansi_codes_removes_escape_sequences() {
        assert_eq!(strip_ansi_codes("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi_codes("plain text"), "plain text");
        assert_eq!(strip_ansi_codes(""), "");
        assert_eq!(
            strip_ansi_codes("\x1b[1;32mbold green\x1b[0m normal"),
            "bold green normal"
        );
    }

    #[test]
    fn serde_json_error_converts_to_gitlab_cli_error() {
        let json_err = serde_json::from_str::<String>("invalid").unwrap_err();
        let cli_err: GitlabCliError = json_err.into();
        assert!(matches!(cli_err, GitlabCliError::Json(_)));
    }

    #[test]
    fn with_runner_uses_glab_program_name() {
        let runner = MockRunner::default();
        runner.push_response(Ok(CommandOutput {
            status: Some(0),
            stdout: "glab version 1.46.0".to_string(),
            stderr: String::new(),
        }));
        let cli = GitlabCli::with_runner(runner);
        assert_eq!(cli.program, "glab");
    }
}
