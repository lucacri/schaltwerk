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
    ) -> (String, Vec<String>) {
        let mut docker_args = vec![
            "exec".to_string(),
            "-it".to_string(),
            "-w".to_string(),
            host_cwd.to_string(),
            self.container_name.clone(),
            program.to_string(),
        ];
        docker_args.extend(args.iter().cloned());
        ("docker".to_string(), docker_args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_wraps_command_in_docker_exec() {
        let transformer = DockerCommandTransformer::new("schaltwerk-abc123".to_string());
        let (program, args) = transformer.transform(
            "claude",
            &["--dangerously-skip-permissions".to_string()],
            "/Users/dev/project",
        );

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec![
                "exec",
                "-it",
                "-w",
                "/Users/dev/project",
                "schaltwerk-abc123",
                "claude",
                "--dangerously-skip-permissions",
            ]
        );
    }

    #[test]
    fn transform_with_no_args() {
        let transformer = DockerCommandTransformer::new("schaltwerk-test".to_string());
        let (program, args) = transformer.transform("claude", &[], "/workspace");

        assert_eq!(program, "docker");
        assert_eq!(
            args,
            vec!["exec", "-it", "-w", "/workspace", "schaltwerk-test", "claude"]
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
}
