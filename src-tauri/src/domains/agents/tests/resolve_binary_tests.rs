#![cfg(unix)]

use crate::domains::agents::resolve_agent_binary;
use crate::shared::login_shell_env::testing as env_testing;
use serial_test::serial;
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::TempDir;

fn make_executable(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    fs::write(&path, "#!/bin/sh\necho ok\n").expect("write fake binary");
    let mut perms = fs::metadata(&path).expect("metadata").permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).expect("chmod");
    path
}

#[test]
#[serial]
fn resolve_agent_binary_finds_command_on_login_shell_path() {
    let _guard = env_testing::env_lock();

    let temp = TempDir::new().expect("temp dir");
    let unique_name = format!(
        "lucode-test-agent-{}",
        std::process::id()
    );
    let full_path = make_executable(temp.path(), &unique_name);

    let mut env = HashMap::new();
    env.insert(
        "PATH".to_string(),
        format!("{}:/tmp/nonexistent", temp.path().display()),
    );
    let prior = env_testing::install_env(Some(env));

    let resolved = resolve_agent_binary(&unique_name);
    env_testing::restore_env(prior);

    assert_eq!(
        resolved,
        full_path.to_string_lossy().to_string(),
        "resolver must consult login-shell PATH before giving up"
    );
}

#[test]
#[serial]
fn resolve_agent_binary_returns_bare_name_when_not_found_anywhere() {
    let _guard = env_testing::env_lock();

    let temp = TempDir::new().expect("temp dir");
    // intentionally do NOT create the binary
    let unique_name = format!(
        "lucode-missing-agent-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let mut env = HashMap::new();
    env.insert(
        "PATH".to_string(),
        format!("{}", temp.path().display()),
    );
    let prior = env_testing::install_env(Some(env));

    let resolved = resolve_agent_binary(&unique_name);
    env_testing::restore_env(prior);

    assert_eq!(resolved, unique_name, "falls back to bare name when nothing resolves");
}
