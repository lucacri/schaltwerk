use std::fs::OpenOptions;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use lucode::services::sh_quote_string;

const LAUNCH_SCRIPT_PREFIX: &str = "lucode-launch-";
const LARGE_ARG_SIDECAR_THRESHOLD_BYTES: usize = 1024;

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
    sidecars: &[(usize, PathBuf)],
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

    if !sidecars.is_empty() {
        script.push_str("LUCODE_ARG_SENTINEL=$(printf '\\001')\n");
    }

    let sidecar_for_idx: std::collections::HashMap<usize, &Path> = sidecars
        .iter()
        .map(|(idx, path)| (*idx, path.as_path()))
        .collect();

    let mut rendered_args = Vec::with_capacity(args.len());
    let mut quoted_sidecar_paths = Vec::with_capacity(sidecars.len());
    for (idx, arg) in args.iter().enumerate() {
        if let Some(sidecar_path) = sidecar_for_idx.get(&idx) {
            let var_name = format!("LUCODE_ARG_{idx}");
            let quoted_path = sh_quote_string(&sidecar_path.to_string_lossy());
            script.push_str(&var_name);
            script.push_str("=$(cat ");
            script.push_str(&quoted_path);
            script.push_str("; printf '\\001')\n");
            script.push_str(&var_name);
            script.push_str("=${");
            script.push_str(&var_name);
            script.push_str("%\"$LUCODE_ARG_SENTINEL\"}\n");
            quoted_sidecar_paths.push(quoted_path);
            rendered_args.push(format!("\"${var_name}\""));
        } else {
            rendered_args.push(sh_quote_string(arg));
        }
    }

    script.push_str("rm --");
    for path in &quoted_sidecar_paths {
        script.push(' ');
        script.push_str(path);
    }
    script.push_str(" \"$0\"\n");

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
    for _ in 0..16 {
        let nonce = random_hex_16()?;
        let script_path = dir.join(format!("{LAUNCH_SCRIPT_PREFIX}{nonce}.sh"));

        let mut script_options = OpenOptions::new();
        script_options.write(true).create_new(true);
        #[cfg(unix)]
        script_options.mode(0o600);

        let mut script_file = match script_options.open(&script_path) {
            Ok(file) => file,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("Failed to create launch script: {err}")),
        };

        let mut sidecars: Vec<(usize, PathBuf)> = Vec::new();
        for (idx, arg) in args.iter().enumerate() {
            if arg.len() <= LARGE_ARG_SIDECAR_THRESHOLD_BYTES {
                continue;
            }
            let sidecar_path =
                dir.join(format!("{LAUNCH_SCRIPT_PREFIX}{nonce}-arg{idx}"));
            let mut sidecar_options = OpenOptions::new();
            sidecar_options.write(true).create_new(true);
            #[cfg(unix)]
            sidecar_options.mode(0o600);
            match sidecar_options.open(&sidecar_path) {
                Ok(mut file) => {
                    if let Err(err) = file.write_all(arg.as_bytes()) {
                        cleanup_partial_launch(&script_path, &sidecars, Some(&sidecar_path));
                        return Err(format!("Failed to write launch sidecar: {err}"));
                    }
                }
                Err(err) => {
                    cleanup_partial_launch(&script_path, &sidecars, None);
                    return Err(format!("Failed to create launch sidecar: {err}"));
                }
            }
            sidecars.push((idx, sidecar_path));
        }

        let script = match render_launch_script(command, args, env, &sidecars) {
            Ok(script) => script,
            Err(err) => {
                cleanup_partial_launch(&script_path, &sidecars, None);
                return Err(err);
            }
        };

        if let Err(err) = script_file.write_all(script.as_bytes()) {
            cleanup_partial_launch(&script_path, &sidecars, None);
            return Err(format!("Failed to write launch script: {err}"));
        }

        return Ok(script_path);
    }

    Err("Failed to create unique launch script path".to_string())
}

fn cleanup_partial_launch(
    script_path: &Path,
    sidecars: &[(usize, PathBuf)],
    extra: Option<&Path>,
) {
    let _ = std::fs::remove_file(script_path);
    for (_, path) in sidecars {
        let _ = std::fs::remove_file(path);
    }
    if let Some(path) = extra {
        let _ = std::fs::remove_file(path);
    }
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
    fn launch_script_reads_oversize_args_from_sidecar_path() {
        let sidecar = PathBuf::from("/tmp/lucode-launch-abc-arg0");
        let prompt = "p".repeat(2048);
        let script = render_launch_script(
            "agent",
            &[prompt],
            &[],
            &[(0, sidecar.clone())],
        )
        .expect("script should render");

        assert!(script.contains("LUCODE_ARG_SENTINEL=$(printf '\\001')"));
        assert!(script.contains(
            "LUCODE_ARG_0=$(cat '/tmp/lucode-launch-abc-arg0'; printf '\\001')"
        ));
        assert!(script
            .contains("LUCODE_ARG_0=${LUCODE_ARG_0%\"$LUCODE_ARG_SENTINEL\"}"));
        assert!(!script.contains("<<'"));
    }

    #[test]
    fn launch_script_self_deletes_before_exec() {
        let script = render_launch_script("agent", &["prompt".to_string()], &[], &[])
            .expect("script should render");

        let rm_idx = script
            .find("\nrm -- \"$0\"\n")
            .expect("missing self-delete");
        let exec_idx = script.find("\nexec ").expect("missing exec");

        assert!(rm_idx < exec_idx);
    }

    #[test]
    fn launch_script_rm_line_removes_sidecars_with_self() {
        let sidecar = PathBuf::from("/tmp/lucode-launch-xyz-arg1");
        let script = render_launch_script(
            "agent",
            &["short".to_string(), "x".repeat(2048)],
            &[],
            &[(1, sidecar)],
        )
        .expect("script should render");

        assert!(script.contains(
            "\nrm -- '/tmp/lucode-launch-xyz-arg1' \"$0\"\n"
        ));
    }

    #[test]
    fn launch_script_env_vars_exported_before_exec() {
        let env = vec![
            ("LUCODE_SESSION".to_string(), "session 'one'".to_string()),
            ("WORKTREE_PATH".to_string(), "/tmp/work tree".to_string()),
        ];
        let script =
            render_launch_script("agent", &["prompt".to_string()], &env, &[]).expect("script");

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
    fn launch_script_prompt_with_unbalanced_apostrophe_survives_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let prompt = format!(
            "multiple agents' plans can be compared {}",
            "x".repeat(2048)
        );
        let path = write_launch_script_in_dir(
            dir.path(),
            "printf",
            &["%s".to_string(), prompt.clone()],
            &[],
        )
        .expect("script should write");

        let output = std::process::Command::new("/bin/sh")
            .arg(&path)
            .output()
            .expect("script should execute");

        assert!(
            output.status.success(),
            "script failed under /bin/sh: stderr={}",
            String::from_utf8_lossy(&output.stderr)
        );
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
        assert!(script.contains("LUCODE_ARG_1=$(cat '"));
        assert!(script.contains("-arg1'; printf '\\001')"));
        assert!(script.contains("exec 'agent' '--prompt' \"$LUCODE_ARG_1\""));

        let sidecar_name = script_path
            .file_stem()
            .expect("stem")
            .to_string_lossy()
            .to_string();
        let sidecar_path = script_path
            .parent()
            .expect("parent")
            .join(format!("{sidecar_name}-arg1"));
        assert!(sidecar_path.exists(), "sidecar should exist before exec");
        let sidecar_contents =
            std::fs::read(&sidecar_path).expect("sidecar should be readable");
        assert_eq!(sidecar_contents, vec![b'p'; 20 * 1024]);

        std::fs::remove_file(script_path).expect("cleanup launch script");
        std::fs::remove_file(sidecar_path).expect("cleanup sidecar");
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

        let sidecar_name = script_path
            .file_stem()
            .expect("stem")
            .to_string_lossy()
            .to_string();
        let sidecar_path = script_path
            .parent()
            .expect("parent")
            .join(format!("{sidecar_name}-arg1"));
        std::fs::remove_file(script_path).expect("cleanup launch script");
        std::fs::remove_file(sidecar_path).expect("cleanup sidecar");
    }

    #[test]
    fn launch_script_removes_sidecars_after_successful_exec() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_launch_script_in_dir(
            dir.path(),
            "true",
            &["x".repeat(2048)],
            &[],
        )
        .expect("script should write");

        let output = Command::new("/bin/sh")
            .arg(&path)
            .output()
            .expect("script should execute");
        assert!(
            output.status.success(),
            "script failed: stderr={}",
            String::from_utf8_lossy(&output.stderr)
        );

        let leftover: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(LAUNCH_SCRIPT_PREFIX)
            })
            .map(|e| e.file_name())
            .collect();
        assert!(
            leftover.is_empty(),
            "launch artifacts should be removed: {leftover:?}"
        );
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
