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

        {
            let cache = self.containers.read().await;
            if matches!(cache.get(project_path), Some(ContainerState::Running(_)))
                && self.is_container_running(&container_name).await
            {
                return Ok(container_name);
            }
        }

        let mut cache = self.containers.write().await;

        if matches!(cache.get(project_path), Some(ContainerState::Running(_)))
            && self.is_container_running(&container_name).await
        {
            return Ok(container_name);
        }

        if self.container_exists(&container_name).await {
            if !self.is_container_running(&container_name).await {
                self.start_container(&container_name).await?;
            }
        } else {
            self.create_container(&container_name, mount_config).await?;
        }

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

        if self.container_exists(&container_name).await {
            let output = Command::new("docker")
                .args(["rm", "-f", &container_name])
                .output()
                .await?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!("Failed to remove container {container_name}: {stderr}");
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

    pub fn orphan_cleanup_args() -> Vec<String> {
        vec![
            "ps".to_string(),
            "-a".to_string(),
            "--filter".to_string(),
            "name=lucode-".to_string(),
            "-q".to_string(),
        ]
    }

    pub async fn cleanup_orphaned_containers(&self) {
        let args = Self::orphan_cleanup_args();
        let output = match Command::new("docker").args(&args).output().await {
            Ok(o) if o.status.success() => o,
            _ => return,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let container_ids: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
        if container_ids.is_empty() {
            return;
        }

        log::info!(
            "Found {} orphaned lucode container(s), cleaning up",
            container_ids.len()
        );

        let mut rm_args = vec!["rm".to_string(), "-f".to_string()];
        rm_args.extend(container_ids.iter().map(|id| id.to_string()));

        if let Err(e) = Command::new("docker").args(&rm_args).output().await {
            log::warn!("Failed to remove orphaned containers: {e}");
        }
    }

    pub fn container_name_for(project_path: &Path) -> String {
        let mut hasher = Sha256::new();
        hasher.update(project_path.to_string_lossy().as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        format!("lucode-{}", &hash[..12])
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

    pub fn build_create_args(name: &str, mount_config: &MountConfig, image_tag: &str) -> Vec<String> {
        let mut args = vec![
            "run".to_string(),
            "-d".to_string(),
            "--name".to_string(),
            name.to_string(),
            "--security-opt".to_string(),
            "no-new-privileges".to_string(),
            "--cap-drop".to_string(),
            "ALL".to_string(),
        ];

        args.extend(mount_config.to_docker_args());

        args.push(image_tag.to_string());
        args.push("sleep".to_string());
        args.push("infinity".to_string());

        args
    }

    async fn create_container(
        &self,
        name: &str,
        mount_config: &MountConfig,
    ) -> Result<()> {
        let args = Self::build_create_args(name, mount_config, &self.image_tag);

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
        assert!(name.starts_with("lucode-"));
    }

    #[test]
    fn container_name_has_correct_length() {
        let name = DockerManager::container_name_for(Path::new("/some/path"));
        assert_eq!(name.len(), "lucode-".len() + 12);
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

    #[test]
    fn create_args_include_security_constraints() {
        let mount_config = MountConfig { volumes: vec![] };
        let args = DockerManager::build_create_args("test-container", &mount_config, "test:latest");
        assert!(
            args.contains(&"--security-opt".to_string()),
            "args should include --security-opt"
        );
        assert!(
            args.contains(&"no-new-privileges".to_string()),
            "args should include no-new-privileges"
        );
        assert!(
            args.contains(&"--cap-drop".to_string()),
            "args should include --cap-drop"
        );
        assert!(
            args.contains(&"ALL".to_string()),
            "args should include ALL (for cap-drop)"
        );
    }

    #[tokio::test]
    async fn ensure_container_caches_after_mutation() {
        let manager = DockerManager::new("test:latest".to_string());
        let path = PathBuf::from("/test/project");
        {
            let cache = manager.containers.read().await;
            assert!(cache.get(&path).is_none());
        }
        {
            let mut cache = manager.containers.write().await;
            cache.insert(path.clone(), ContainerState::Running("test-container".to_string()));
        }
        {
            let cache = manager.containers.read().await;
            assert!(matches!(cache.get(&path), Some(ContainerState::Running(_))));
        }
    }

    #[test]
    fn cleanup_orphans_command_uses_correct_filter() {
        let args = DockerManager::orphan_cleanup_args();
        assert_eq!(args[0], "ps");
        assert!(args.contains(&"--filter".to_string()));
        assert!(args.contains(&"name=lucode-".to_string()));
        assert!(args.contains(&"-q".to_string()));
    }

    #[test]
    fn create_args_include_basic_structure() {
        let mount_config = MountConfig { volumes: vec![] };
        let args = DockerManager::build_create_args("my-container", &mount_config, "img:latest");
        assert_eq!(args[0], "run");
        assert_eq!(args[1], "-d");
        assert!(args.contains(&"--name".to_string()));
        assert!(args.contains(&"my-container".to_string()));
        assert!(args.contains(&"img:latest".to_string()));
        assert!(args.contains(&"sleep".to_string()));
        assert!(args.contains(&"infinity".to_string()));
    }
}
