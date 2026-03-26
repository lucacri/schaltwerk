use crate::get_project_manager;
use std::path::Path;
use std::process::ExitStatus;

use url::Url;

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn get_current_directory() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        Ok(project.path.to_string_lossy().to_string())
    } else {
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;

        if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            current_dir
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get parent directory".to_string())
        } else {
            Ok(current_dir.to_string_lossy().to_string())
        }
    }
}

#[tauri::command]
pub async fn open_in_vscode(worktree_path: String) -> Result<(), String> {
    log::info!("Opening VSCode for worktree: {worktree_path}");

    let output = std::process::Command::new("code")
        .arg(&worktree_path)
        .output()
        .map_err(|e| {
            log::error!("Failed to execute VSCode command: {e}");
            format!("Failed to open VSCode: {e}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("VSCode command failed: {stderr}");
        return Err(format!("VSCode command failed: {stderr}"));
    }

    log::info!("Successfully opened VSCode for: {worktree_path}");
    Ok(())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod current_directory_tests {
    use super::*;
    use lucode::utils::env_adapter::EnvAdapter;
    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn get_current_directory_ignores_env_override() {
        EnvAdapter::remove_var("LUCODE_START_DIR");
        let baseline = get_current_directory()
            .await
            .expect("baseline current directory");
        EnvAdapter::set_var("LUCODE_START_DIR", "/tmp/lucode_should_ignore");

        let actual = get_current_directory().await.expect("current directory");

        EnvAdapter::remove_var("LUCODE_START_DIR");
        assert_eq!(
            actual, baseline,
            "should ignore LUCODE_START_DIR override"
        );
    }
}

#[tauri::command]
pub async fn clipboard_write_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|err| format!("Failed to access system clipboard: {err}"))?;
        clipboard
            .set_text(text)
            .map_err(|err| format!("Failed to write text to clipboard: {err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Clipboard write task failed: {err}"))?
}

#[tauri::command]
pub fn schaltwerk_core_log_frontend_message(level: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "error" => log::error!("{message}"),
        "warn" => log::warn!("{message}"),
        "info" => log::info!("{message}"),
        "debug" => log::debug!("{message}"),
        _ => log::info!("{message}"),
    }
    Ok(())
}

const ALLOWED_ENV_VARS: &[&str] = &["LUCODE_TERMINAL_TRANSPORT"];

#[tauri::command]
pub fn get_environment_variable(name: String) -> Result<Option<String>, String> {
    if !ALLOWED_ENV_VARS.contains(&name.as_str()) {
        return Err(format!("Environment variable '{name}' is not accessible"));
    }

    Ok(std::env::var(&name).ok())
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid URL '{url}': {error}"))?;
    let target: String = parsed_url.into();
    let log_target = target.clone();
    let join_error_target = target.clone();

    tokio::task::spawn_blocking(move || {
        log::info!("Opening external URL: {log_target}");
        let runner = SystemCommandRunner;

        launch_url_with_runner(&target, &runner).map_err(|error| {
            log::error!("Failed to launch external URL {log_target}: {error}");
            error.to_string()
        })
    })
    .await
    .map_err(|error| {
        log::error!("Failed to join external URL launcher task for {join_error_target}: {error}");
        format!("Failed to launch URL '{join_error_target}': task join error")
    })?
}

trait CommandRunner {
    fn run(&self, program: &str, args: &[&str]) -> Result<ExitStatus, std::io::Error>;
}

struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(&self, program: &str, args: &[&str]) -> Result<ExitStatus, std::io::Error> {
        std::process::Command::new(program).args(args).status()
    }
}

#[derive(Debug)]
enum LaunchError {
    CommandSpawn {
        program: &'static str,
        source: std::io::Error,
    },
    CommandFailed {
        program: &'static str,
        status: ExitStatus,
    },
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaunchError::CommandSpawn { program, source } => {
                write!(
                    f,
                    "Failed to launch default handler for URL: unable to execute '{program}': {source}"
                )
            }
            LaunchError::CommandFailed { program, status } => {
                write!(
                    f,
                    "Failed to launch default handler for URL: '{program}' exited with status {status}"
                )
            }
        }
    }
}

impl std::error::Error for LaunchError {}

fn launch_url_with_runner<R: CommandRunner>(url: &str, runner: &R) -> Result<(), LaunchError> {
    let (program, args) = build_launch_command(url);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    let status = runner
        .run(program, &arg_refs)
        .map_err(|source| LaunchError::CommandSpawn { program, source })?;

    if status.success() {
        Ok(())
    } else {
        Err(LaunchError::CommandFailed { program, status })
    }
}

fn build_launch_command(url: &str) -> (&'static str, Vec<String>) {
    if cfg!(target_os = "linux") {
        ("xdg-open", vec![url.to_string()])
    } else {
        ("open", vec![url.to_string()])
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::io;
    use std::sync::Mutex;

    struct MockCommandRunner {
        invocations: Mutex<Vec<(String, Vec<String>)>>,
        response: Mutex<Option<Result<ExitStatus, io::Error>>>,
    }

    impl MockCommandRunner {
        fn new(response: Result<ExitStatus, io::Error>) -> Self {
            Self {
                invocations: Mutex::new(Vec::new()),
                response: Mutex::new(Some(response)),
            }
        }

        fn invocations(&self) -> Vec<(String, Vec<String>)> {
            self.invocations.lock().unwrap().clone()
        }
    }

    impl CommandRunner for MockCommandRunner {
        fn run(&self, program: &str, args: &[&str]) -> Result<ExitStatus, io::Error> {
            self.invocations.lock().unwrap().push((
                program.to_string(),
                args.iter().map(|arg| arg.to_string()).collect(),
            ));

            self.response
                .lock()
                .unwrap()
                .take()
                .expect("MockCommandRunner run called more times than expected")
        }
    }

    fn success_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(0)
    }

    fn failure_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(1)
    }

    #[test]
    fn launch_url_invokes_expected_command() {
        let runner = MockCommandRunner::new(Ok(success_status()));
        let url = "https://example.com";

        let result = launch_url_with_runner(url, &runner);

        assert!(result.is_ok());

        let invocations = runner.invocations();
        assert_eq!(invocations.len(), 1);

        let (program, args) = &invocations[0];

        if cfg!(target_os = "linux") {
            assert_eq!(program, "xdg-open");
            assert_eq!(args, &vec![url.to_string()]);
        } else {
            assert_eq!(program, "open");
            assert_eq!(args, &vec![url.to_string()]);
        }
    }

    #[test]
    fn launch_url_propagates_non_zero_status() {
        let runner = MockCommandRunner::new(Ok(failure_status()));

        let error = launch_url_with_runner("https://example.com", &runner)
            .expect_err("launch should have failed");

        match error {
            LaunchError::CommandFailed { program, .. } => {
                if cfg!(target_os = "linux") {
                    assert_eq!(program, "xdg-open");
                } else {
                    assert_eq!(program, "open");
                }
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn launch_url_propagates_spawn_errors() {
        let runner =
            MockCommandRunner::new(Err(io::Error::new(io::ErrorKind::NotFound, "missing")));

        let error = launch_url_with_runner("https://example.com", &runner)
            .expect_err("launch should have failed");

        match error {
            LaunchError::CommandSpawn { program, source } => {
                if cfg!(target_os = "linux") {
                    assert_eq!(program, "xdg-open");
                } else {
                    assert_eq!(program, "open");
                }
                assert_eq!(source.kind(), io::ErrorKind::NotFound);
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn build_launch_command_returns_url_as_argument() {
        let url = "https://example.com/path?q=1";
        let (_, args) = build_launch_command(url);
        assert_eq!(args.len(), 1);
        assert_eq!(args[0], url);
    }

    #[test]
    fn build_launch_command_platform_specific_program() {
        let (program, _) = build_launch_command("https://example.com");
        if cfg!(target_os = "linux") {
            assert_eq!(program, "xdg-open");
        } else {
            assert_eq!(program, "open");
        }
    }

    #[test]
    fn launch_error_display_spawn() {
        let error = LaunchError::CommandSpawn {
            program: "test-program",
            source: io::Error::new(io::ErrorKind::NotFound, "not found"),
        };
        let display = format!("{error}");
        assert!(display.contains("test-program"));
        assert!(display.contains("not found"));
    }

    #[test]
    fn launch_error_display_failed() {
        let error = LaunchError::CommandFailed {
            program: "test-program",
            status: failure_status(),
        };
        let display = format!("{error}");
        assert!(display.contains("test-program"));
        assert!(display.contains("exited with status"));
    }

    #[test]
    fn launch_error_implements_std_error() {
        let error = LaunchError::CommandSpawn {
            program: "test",
            source: io::Error::new(io::ErrorKind::Other, "test"),
        };
        let _: &dyn std::error::Error = &error;
    }
}

#[cfg(test)]
mod utility_pure_tests {
    use super::*;

    #[test]
    fn path_exists_returns_true_for_existing_path() {
        let result = path_exists("/tmp".to_string()).unwrap();
        assert!(result);
    }

    #[test]
    fn path_exists_returns_false_for_nonexistent_path() {
        let result = path_exists("/nonexistent/path/12345".to_string()).unwrap();
        assert!(!result);
    }

    #[test]
    fn get_app_version_returns_nonempty_string() {
        let version = get_app_version();
        assert!(!version.is_empty());
        assert!(version.contains('.'));
    }

    #[test]
    fn log_frontend_message_accepts_all_levels() {
        for level in &["error", "warn", "info", "debug", "unknown"] {
            let result =
                schaltwerk_core_log_frontend_message(level.to_string(), "test message".to_string());
            assert!(result.is_ok());
        }
    }

    #[test]
    fn get_environment_variable_blocks_disallowed_vars() {
        let result = get_environment_variable("HOME".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not accessible"));
    }

    #[test]
    fn get_environment_variable_allows_terminal_transport() {
        let result = get_environment_variable("LUCODE_TERMINAL_TRANSPORT".to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn get_environment_variable_blocks_empty_string() {
        let result = get_environment_variable("".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn get_environment_variable_blocks_path() {
        let result = get_environment_variable("PATH".to_string());
        assert!(result.is_err());
    }
}
