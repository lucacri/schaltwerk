const FILTERED_ENV_VARS: &[&str] = &["CLAUDECODE", "CLAUDE_CODE", "TERM_PROGRAM"];

pub struct DockerCommandTransformer {
    container_name: String,
}

impl DockerCommandTransformer {
    pub fn new(container_name: String) -> Self {
        Self { container_name }
    }

    pub fn transform(
        &self,
        program: &str,
        args: &[String],
        host_cwd: &str,
        env_vars: &[(String, String)],
    ) -> (String, Vec<String>) {
        let binary_name = std::path::Path::new(program)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(program);

        let mut docker_args = vec![
            "exec".to_string(),
            "-it".to_string(),
            "-w".to_string(),
            host_cwd.to_string(),
        ];
        for (key, value) in env_vars {
            if FILTERED_ENV_VARS.contains(&key.as_str()) {
                continue;
            }
            docker_args.push("-e".to_string());
            docker_args.push(format!("{key}={value}"));
        }
        docker_args.push(self.container_name.clone());
        docker_args.push(binary_name.to_string());
        docker_args.extend(args.iter().cloned());
        ("docker".to_string(), docker_args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_wraps_command_in_docker_exec() {
        let transformer = DockerCommandTransformer::new("lucode-abc123".to_string());
        let (program, args) = transformer.transform(
            "claude",
            &["--dangerously-skip-permissions".to_string()],
            "/Users/dev/project",
            &[],
        );

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/Users/dev/project",
                "lucode-abc123",
                "claude",
                "--dangerously-skip-permissions",
            ]
        );
    }

    #[test]
    fn transform_strips_host_path_from_binary() {
        let transformer = DockerCommandTransformer::new("lucode-abc123".to_string());
        let (program, args) = transformer.transform(
            "/Users/lucacri/.local/bin/claude",
            &["--dangerously-skip-permissions".to_string()],
            "/workspace",
            &[],
        );

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/workspace",
                "lucode-abc123",
                "claude",
                "--dangerously-skip-permissions",
            ]
        );
    }

    #[test]
    fn transform_with_no_args() {
        let transformer = DockerCommandTransformer::new("lucode-test".to_string());
        let (program, args) = transformer.transform("claude", &[], "/workspace", &[]);

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec!["exec", "-it", "-w", "/workspace", "lucode-test", "claude"]
        );
    }

    #[test]
    fn transform_preserves_multiple_args() {
        let transformer = DockerCommandTransformer::new("container-1".to_string());
        let (program, args) = transformer.transform(
            "codex",
            &[
                "--flag1".to_string(),
                "--flag2".to_string(),
                "value".to_string(),
            ],
            "/home/user/project",
            &[],
        );

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/home/user/project",
                "container-1",
                "codex",
                "--flag1",
                "--flag2",
                "value",
            ]
        );
    }

    #[test]
    fn transform_forwards_env_vars() {
        let transformer = DockerCommandTransformer::new("lucode-abc".to_string());
        let env = vec![
            ("API_KEY".to_string(), "secret123".to_string()),
            ("NODE_ENV".to_string(), "production".to_string()),
        ];
        let (program, args) = transformer.transform(
            "claude",
            &["--flag".to_string()],
            "/workspace",
            &env,
        );

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/workspace",
                "-e",
                "API_KEY=secret123",
                "-e",
                "NODE_ENV=production",
                "lucode-abc",
                "claude",
                "--flag",
            ]
        );
    }

    #[test]
    fn transform_filters_claudecode_env_var() {
        let transformer = DockerCommandTransformer::new("lucode-abc".to_string());
        let env = vec![
            ("API_KEY".to_string(), "secret123".to_string()),
            ("CLAUDECODE".to_string(), "1".to_string()),
            ("CLAUDE_CODE".to_string(), "true".to_string()),
            ("TERM_PROGRAM".to_string(), "lucode".to_string()),
        ];
        let (_program, args) = transformer.transform(
            "claude",
            &[],
            "/workspace",
            &env,
        );

        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/workspace",
                "-e",
                "API_KEY=secret123",
                "lucode-abc",
                "claude",
            ]
        );
    }
}
