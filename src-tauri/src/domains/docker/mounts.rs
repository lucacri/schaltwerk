use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct VolumeMount {
    pub host_path: PathBuf,
    pub container_path: PathBuf,
    pub read_only: bool,
}

impl VolumeMount {
    pub fn to_docker_arg(&self) -> String {
        let ro = if self.read_only { ":ro" } else { "" };
        format!(
            "{}:{}{}",
            self.host_path.display(),
            self.container_path.display(),
            ro
        )
    }
}

#[derive(Debug, Clone)]
pub struct MountConfig {
    pub volumes: Vec<VolumeMount>,
}

impl MountConfig {
    pub fn to_docker_args(&self) -> Vec<String> {
        self.volumes
            .iter()
            .flat_map(|v| vec!["-v".to_string(), v.to_docker_arg()])
            .collect()
    }
}

struct CredentialMapping {
    staging_subdir: &'static str,
    container_path: &'static str,
}

const CREDENTIAL_MAPPINGS: &[CredentialMapping] = &[
    CredentialMapping {
        staging_subdir: "claude",
        container_path: "/home/agent/.claude",
    },
    CredentialMapping {
        staging_subdir: "codex",
        container_path: "/home/agent/.codex",
    },
    CredentialMapping {
        staging_subdir: "gemini",
        container_path: "/home/agent/.config/gemini-cli",
    },
];

pub fn staging_base_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("schaltwerk").join("docker-mounts"))
}

pub fn build_mount_config(project_path: &Path) -> MountConfig {
    let mut volumes = vec![VolumeMount {
        host_path: project_path.to_path_buf(),
        container_path: project_path.to_path_buf(),
        read_only: false,
    }];

    if let Some(staging_base) = staging_base_dir() {
        for mapping in CREDENTIAL_MAPPINGS {
            let host_dir = staging_base.join(mapping.staging_subdir);
            if host_dir.is_dir() {
                volumes.push(VolumeMount {
                    host_path: host_dir,
                    container_path: PathBuf::from(mapping.container_path),
                    read_only: true,
                });
            }
        }
    }

    MountConfig { volumes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_mount_to_docker_arg_read_write() {
        let mount = VolumeMount {
            host_path: PathBuf::from("/Users/dev/project"),
            container_path: PathBuf::from("/Users/dev/project"),
            read_only: false,
        };
        assert_eq!(
            mount.to_docker_arg(),
            "/Users/dev/project:/Users/dev/project"
        );
    }

    #[test]
    fn volume_mount_to_docker_arg_read_only() {
        let mount = VolumeMount {
            host_path: PathBuf::from("/home/.claude"),
            container_path: PathBuf::from("/home/agent/.claude"),
            read_only: true,
        };
        assert_eq!(
            mount.to_docker_arg(),
            "/home/.claude:/home/agent/.claude:ro"
        );
    }

    #[test]
    fn mount_config_to_docker_args() {
        let config = MountConfig {
            volumes: vec![
                VolumeMount {
                    host_path: PathBuf::from("/project"),
                    container_path: PathBuf::from("/project"),
                    read_only: false,
                },
                VolumeMount {
                    host_path: PathBuf::from("/creds"),
                    container_path: PathBuf::from("/home/agent/.claude"),
                    read_only: true,
                },
            ],
        };

        let args = config.to_docker_args();
        assert_eq!(
            args,
            vec![
                "-v",
                "/project:/project",
                "-v",
                "/creds:/home/agent/.claude:ro",
            ]
        );
    }

    #[test]
    fn build_mount_config_includes_project_identity_mount() {
        let project = PathBuf::from("/Users/dev/my-project");
        let config = build_mount_config(&project);

        assert!(!config.volumes.is_empty());
        let project_mount = &config.volumes[0];
        assert_eq!(project_mount.host_path, project);
        assert_eq!(project_mount.container_path, project);
        assert!(!project_mount.read_only);
    }

    #[test]
    fn build_mount_config_skips_missing_credential_dirs() {
        let project = PathBuf::from("/tmp/nonexistent-project");
        let config = build_mount_config(&project);

        assert_eq!(
            config.volumes.len(),
            1,
            "should only have project mount when no credential dirs exist"
        );
    }

    #[test]
    fn staging_base_dir_returns_some() {
        let base = staging_base_dir();
        assert!(base.is_some());
        let path = base.unwrap();
        assert!(path.ends_with("schaltwerk/docker-mounts"));
    }
}
