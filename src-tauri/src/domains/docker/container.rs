use super::mounts::MountConfig;
use anyhow::{Result, anyhow};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub enum ContainerState {
    Running(String),
    Stopped(String),
}

pub struct DockerManager {
    containers: Arc<RwLock<HashMap<PathBuf, ContainerState>>>,
    image_tag: String,
}

impl DockerManager {
    pub fn new(image_tag: String) -> Self {
        Self {
            containers: Arc::new(RwLock::new(HashMap::new())),
            image_tag,
        }
    }

    pub async fn ensure_container_for_project(
        &self,
        project_path: &Path,
        mount_config: &MountConfig,
    ) -> Result<String> {
        let container_name = Self::container_name_for(project_path);

        let is_cached = {
            let cache = self.containers.read().await;
            matches!(cache.get(project_path), Some(ContainerState::Running(_)))
        };

        if is_cached && self.is_container_running(&container_name).await {
            return Ok(container_name.clone());
        }

        if self.container_exists(&container_name).await {
            if !self.is_container_running(&container_name).await {
                self.start_container(&container_name).await?;
            }
            let mut cache = self.containers.write().await;
            cache.insert(
                project_path.to_path_buf(),
                ContainerState::Running(container_name.clone()),
            );
            return Ok(container_name);
        }

        self.create_container(&container_name, mount_config).await?;
        let mut cache = self.containers.write().await;
        cache.insert(
            project_path.to_path_buf(),
            ContainerState::Running(container_name.clone()),
        );
        Ok(container_name)
    }

    pub async fn stop_container_for_project(&self, project_path: &Path) -> Result<()> {
        let container_name = Self::container_name_for(project_path);

        if self.is_container_running(&container_name).await {
            let output = Command::new("docker")
                .args(["stop", &container_name])
                .output()
                .await?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!("Failed to stop container {container_name}: {stderr}");
            }
        }

        let mut cache = self.containers.write().await;
        cache.remove(project_path);
        Ok(())
    }

    pub async fn stop_all(&self) -> Result<()> {
        let paths: Vec<PathBuf> = {
            let cache = self.containers.read().await;
            cache.keys().cloned().collect()
        };

        for path in paths {
            if let Err(e) = self.stop_container_for_project(&path).await {
                log::warn!("Failed to stop container for {}: {e}", path.display());
            }
        }

        Ok(())
    }

    pub fn container_name_for(project_path: &Path) -> String {
        let mut hasher = Sha256::new();
        hasher.update(project_path.to_string_lossy().as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        format!("schaltwerk-{}", &hash[..12])
    }

    async fn is_container_running(&self, name: &str) -> bool {
        let output = Command::new("docker")
            .args([
                "inspect",
                "--format",
                "{{.State.Running}}",
                name,
            ])
            .output()
            .await;

        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.trim() == "true"
            }
            _ => false,
        }
    }

    async fn container_exists(&self, name: &str) -> bool {
        let output = Command::new("docker")
            .args(["container", "inspect", name])
            .output()
            .await;

        matches!(output, Ok(o) if o.status.success())
    }

    async fn start_container(&self, name: &str) -> Result<()> {
        let output = Command::new("docker")
            .args(["start", name])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Failed to start container {name}: {stderr}"));
        }

        Ok(())
    }

    async fn create_container(
        &self,
        name: &str,
        mount_config: &MountConfig,
    ) -> Result<()> {
        let mut args = vec![
            "run".to_string(),
            "-d".to_string(),
            "--name".to_string(),
            name.to_string(),
        ];

        args.extend(mount_config.to_docker_args());

        args.push(self.image_tag.clone());
        args.push("sleep".to_string());
        args.push("infinity".to_string());

        let output = Command::new("docker")
            .args(&args)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Failed to create container {name}: {stderr}"));
        }

        log::info!("Created Docker container {name}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_name_is_deterministic() {
        let path = Path::new("/Users/dev/my-project");
        let name1 = DockerManager::container_name_for(path);
        let name2 = DockerManager::container_name_for(path);
        assert_eq!(name1, name2);
    }

    #[test]
    fn container_name_starts_with_prefix() {
        let name = DockerManager::container_name_for(Path::new("/some/path"));
        assert!(name.starts_with("schaltwerk-"));
    }

    #[test]
    fn container_name_has_correct_length() {
        let name = DockerManager::container_name_for(Path::new("/some/path"));
        assert_eq!(name.len(), "schaltwerk-".len() + 12);
    }

    #[test]
    fn different_paths_produce_different_names() {
        let name1 = DockerManager::container_name_for(Path::new("/project/a"));
        let name2 = DockerManager::container_name_for(Path::new("/project/b"));
        assert_ne!(name1, name2);
    }

    #[tokio::test]
    async fn new_manager_has_empty_cache() {
        let manager = DockerManager::new("test:latest".to_string());
        let cache = manager.containers.read().await;
        assert!(cache.is_empty());
    }
}
