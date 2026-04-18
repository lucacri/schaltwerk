use std::fs::OpenOptions;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use lucode::services::sh_quote_string;

const LAUNCH_SCRIPT_PREFIX: &str = "lucode-launch-";
const LARGE_ARG_HEREDOC_THRESHOLD_BYTES: usize = 1024;
const PROMPT_SENTINEL_PREFIX: &str = "LUCODE_PROMPT_EOF_";

#[derive(Debug, Clone)]
pub(crate) struct PreparedTerminalLaunch {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub launch_script_path: Option<PathBuf>,
}

pub(crate) fn prepare_terminal_launch(
    command: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
) -> Result<PreparedTerminalLaunch, String> {
    let projected_tmux_argv = projected_tmux_argv(&command, &args, &env);
    lucode::domains::terminal::tmux_cmd::check_argv_size(&projected_tmux_argv)?;

    if !should_route_through_launch_script(&command, &args, &env) {
        return Ok(PreparedTerminalLaunch {
            command,
            args,
            env,
            launch_script_path: None,
        });
    }

    let script_path = write_launch_script(&command, &args, &env)?;
    Ok(PreparedTerminalLaunch {
        command: "sh".to_string(),
        args: vec![script_path.to_string_lossy().to_string()],
        env: Vec::new(),
        launch_script_path: Some(script_path),
    })
}

pub(crate) fn should_route_through_launch_script(
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> bool {
    lucode::domains::terminal::tmux_cmd::argv_exceeds_tmux_ipc(&projected_tmux_argv(
        command, args, env,
    ))
}

pub(crate) fn projected_tmux_argv(
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> Vec<String> {
    let mut projected = Vec::with_capacity(args.len() + (env.len() * 2) + 2);
    for (key, value) in env {
        projected.push("-e".to_string());
        projected.push(format!("{key}={value}"));
    }
    projected.push("--".to_string());
    projected.push(command.to_string());
    projected.extend(args.iter().cloned());
    projected
}

pub(crate) fn render_launch_script(
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> Result<String, String> {
    let mut script = String::from("#!/bin/sh\n");

    for (key, value) in env {
        validate_env_key(key)?;
        script.push_str("export ");
        script.push_str(key);
        script.push('=');
        script.push_str(&sh_quote_string(value));
        script.push('\n');
    }

    if args
        .iter()
        .any(|arg| arg.len() > LARGE_ARG_HEREDOC_THRESHOLD_BYTES)
    {
        script.push_str("LUCODE_ARG_SENTINEL=$(printf '\\001')\n");
    }

    let mut rendered_args = Vec::with_capacity(args.len());
    for (idx, arg) in args.iter().enumerate() {
        if arg.len() > LARGE_ARG_HEREDOC_THRESHOLD_BYTES {
            let var_name = format!("LUCODE_ARG_{idx}");
            let sentinel = unique_sentinel_for(arg)?;
            script.push_str(&var_name);
            script.push_str("=$(cat <<'");
            script.push_str(&sentinel);
            script.push_str("'\n");
            script.push_str(arg);
            let strips_artificial_newline = !arg.ends_with('\n');
            if strips_artificial_newline {
                script.push('\n');
            }
            script.push_str(&sentinel);
            script.push_str("\nprintf '\\001'\n)\n");
            script.push_str(&var_name);
            script.push_str("=${");
            script.push_str(&var_name);
            script.push_str("%\"$LUCODE_ARG_SENTINEL\"}\n");
            if strips_artificial_newline {
                script.push_str(&var_name);
                script.push_str("=${");
                script.push_str(&var_name);
                script.push_str("%?}\n");
            }
            rendered_args.push(format!("\"${var_name}\""));
        } else {
            rendered_args.push(sh_quote_string(arg));
        }
    }

    script.push_str("rm -- \"$0\"\n");
    script.push_str("exec ");
    script.push_str(&sh_quote_string(command));
    for arg in rendered_args {
        script.push(' ');
        script.push_str(&arg);
    }
    script.push('\n');

    Ok(script)
}

pub(crate) fn write_launch_script(
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> Result<PathBuf, String> {
    write_launch_script_in_dir(&std::env::temp_dir(), command, args, env)
}

pub(crate) fn write_launch_script_in_dir(
    dir: &Path,
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> Result<PathBuf, String> {
    let script = render_launch_script(command, args, env)?;

    for _ in 0..16 {
        let nonce = random_hex_16()?;
        let path = dir.join(format!("{LAUNCH_SCRIPT_PREFIX}{nonce}.sh"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);

        match options.open(&path) {
            Ok(mut file) => {
                file.write_all(script.as_bytes())
                    .map_err(|err| format!("Failed to write launch script: {err}"))?;
                return Ok(path);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("Failed to create launch script: {err}")),
        }
    }

    Err("Failed to create unique launch script path".to_string())
}

fn validate_env_key(key: &str) -> Result<(), String> {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return Err("Launch script env key cannot be empty".to_string());
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return Err(format!("Launch script env key is not shell-safe: {key}"));
    }
    if chars.any(|ch| !(ch == '_' || ch.is_ascii_alphanumeric())) {
        return Err(format!("Launch script env key is not shell-safe: {key}"));
    }
    Ok(())
}

fn unique_sentinel_for(arg: &str) -> Result<String, String> {
    for attempt in 0..16 {
        let sentinel = format!("{PROMPT_SENTINEL_PREFIX}{}", random_hex_16()?);
        if !arg.lines().any(|line| line == sentinel) {
            if attempt > 0 {
                log::warn!("Regenerated launch script heredoc sentinel after collision");
            }
            return Ok(sentinel);
        }
    }
    Err("Failed to generate non-conflicting heredoc sentinel".to_string())
}

fn random_hex_16() -> Result<String, String> {
    let mut bytes = [0_u8; 8];
    getrandom::fill(&mut bytes).map_err(|err| format!("Failed to generate random nonce: {err}"))?;
    let mut hex = String::with_capacity(16);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut hex, "{byte:02x}").map_err(|err| format!("Failed to format nonce: {err}"))?;
    }
    Ok(hex)
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn env_before_exec(script: &str, env_key: &str) -> bool {
        let export_idx = script
            .find(&format!("export {env_key}="))
            .expect("missing export");
        let exec_idx = script.find("\nexec ").expect("missing exec");
        export_idx < exec_idx
    }

    #[test]
    fn launch_script_quotes_heredoc_sentinel_uniquely() {
        let prompt = format!("prompt with LUCODE_PROMPT_EOF_ prefix {}", "x".repeat(2048));
        let script = render_launch_script("agent", &[prompt], &[]).expect("script should render");

        let sentinel = script
            .lines()
            .find_map(|line| line.strip_prefix("LUCODE_ARG_0=$(cat <<'"))
            .and_then(|tail| tail.strip_suffix("'"))
            .expect("missing quoted heredoc sentinel");

        assert!(sentinel.starts_with("LUCODE_PROMPT_EOF_"));
        assert_eq!(sentinel.len(), "LUCODE_PROMPT_EOF_".len() + 16);
        assert!(sentinel["LUCODE_PROMPT_EOF_".len()..]
            .chars()
            .all(|c| c.is_ascii_hexdigit()));
        assert_eq!(script.matches(sentinel).count(), 2);
    }

    #[test]
    fn launch_script_self_deletes_before_exec() {
        let script = render_launch_script("agent", &["prompt".to_string()], &[])
            .expect("script should render");

        let rm_idx = script
            .find("\nrm -- \"$0\"\n")
            .expect("missing self-delete");
        let exec_idx = script.find("\nexec ").expect("missing exec");

        assert!(rm_idx < exec_idx);
    }

    #[test]
    fn launch_script_env_vars_exported_before_exec() {
        let env = vec![
            ("LUCODE_SESSION".to_string(), "session 'one'".to_string()),
            ("WORKTREE_PATH".to_string(), "/tmp/work tree".to_string()),
        ];
        let script = render_launch_script("agent", &["prompt".to_string()], &env).expect("script");

        assert!(env_before_exec(&script, "LUCODE_SESSION"));
        assert!(env_before_exec(&script, "WORKTREE_PATH"));
        assert!(script.contains("export LUCODE_SESSION='session '\\''one'\\'''"));
        assert!(script.contains("export WORKTREE_PATH='/tmp/work tree'"));
    }

    #[test]
    fn launch_script_prompt_with_shell_metacharacters_survives_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let prompt = format!(
            "$PATH `echo nope` 'single' \"double\" \\\\ LUCODE_PROMPT_EOF_{}",
            "x".repeat(2048)
        );
        let path = write_launch_script_in_dir(
            dir.path(),
            "printf",
            &["%s".to_string(), prompt.clone()],
            &[],
        )
        .expect("script should write");

        let output = Command::new("sh")
            .arg(&path)
            .output()
            .expect("script should execute");

        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).expect("utf8"), prompt);
        assert!(!path.exists(), "script should self-delete");
    }

    #[test]
    fn launch_script_prompt_with_trailing_newlines_survives_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let prompt = format!("{}trailing\n\n", "x".repeat(2048));
        let path = write_launch_script_in_dir(
            dir.path(),
            "printf",
            &["%s".to_string(), prompt.clone()],
            &[],
        )
        .expect("script should write");

        let output = Command::new("sh")
            .arg(&path)
            .output()
            .expect("script should execute");

        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).expect("utf8"), prompt);
        assert!(!path.exists(), "script should self-delete");
    }

    #[cfg(unix)]
    #[test]
    fn launch_script_written_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_launch_script_in_dir(dir.path(), "agent", &["prompt".to_string()], &[])
            .expect("script should write");
        let mode = std::fs::metadata(path)
            .expect("script metadata")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o600);
    }

    #[test]
    fn oversize_prompt_routes_through_launch_script() {
        let env = vec![("LUCODE_SESSION".to_string(), "oversize".to_string())];
        let launch = prepare_terminal_launch(
            "agent".to_string(),
            vec!["--prompt".to_string(), "p".repeat(20 * 1024)],
            env,
        )
        .expect("launch should prepare");

        assert_eq!(launch.command, "sh");
        assert_eq!(launch.args.len(), 1);
        assert!(launch.env.is_empty());
        let script_path = launch
            .launch_script_path
            .as_ref()
            .expect("launch script path");
        assert!(script_path.exists());

        let tmux_argv = projected_tmux_argv(&launch.command, &launch.args, &launch.env);
        let tmux_bytes: usize = tmux_argv.iter().map(|arg| arg.len() + 1).sum();
        assert!(tmux_bytes < 1024, "tmux argv was {tmux_bytes} bytes");

        let script = std::fs::read_to_string(script_path).expect("script should be readable");
        assert!(script.contains("LUCODE_ARG_1=$(cat <<'LUCODE_PROMPT_EOF_"));
        assert!(script.contains("rm -- \"$0\"\nexec 'agent' '--prompt' \"$LUCODE_ARG_1\""));

        std::fs::remove_file(script_path).expect("cleanup launch script");
    }

    #[test]
    fn oversize_shell_chain_routes_through_launch_script() {
        let chained_command = format!(
            "printf %s {}",
            lucode::services::sh_quote_string(&"c".repeat(20 * 1024))
        );
        let env = vec![("LUCODE_SESSION".to_string(), "shell-chain".to_string())];
        let launch = prepare_terminal_launch(
            "sh".to_string(),
            vec!["-lc".to_string(), chained_command],
            env,
        )
        .expect("launch should prepare");

        assert_eq!(launch.command, "sh");
        assert_eq!(launch.args.len(), 1);
        assert!(launch.env.is_empty());

        let tmux_argv = projected_tmux_argv(&launch.command, &launch.args, &launch.env);
        assert!(!tmux_argv.iter().any(|arg| arg == "-e"));
        let tmux_bytes: usize = tmux_argv.iter().map(|arg| arg.len() + 1).sum();
        assert!(tmux_bytes < 1024, "tmux argv was {tmux_bytes} bytes");

        let script_path = launch
            .launch_script_path
            .as_ref()
            .expect("launch script path");
        let script = std::fs::read_to_string(script_path).expect("script should be readable");
        assert!(script.contains("exec 'sh' '-lc' \"$LUCODE_ARG_1\""));

        std::fs::remove_file(script_path).expect("cleanup launch script");
    }

    #[test]
    fn launch_script_path_retains_exec_scale_hard_guard() {
        let err = prepare_terminal_launch(
            "agent".to_string(),
            vec!["p".repeat(lucode::domains::terminal::tmux_cmd::TMUX_ARGV_SOFT_LIMIT_BYTES)],
            Vec::new(),
        )
        .expect_err("exec-scale argv should be rejected before writing a script");

        assert!(err.contains("Lucode preflight"));
        assert!(err.contains("safety limit"));
    }
}
