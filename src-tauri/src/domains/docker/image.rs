use anyhow::{Result, anyhow};
use std::path::PathBuf;
use tokio::process::Command;

const DEFAULT_IMAGE_TAG: &str = "schaltwerk-sandbox:latest";

pub struct DockerImageManager {
    image_tag: String,
    dockerfile_content: &'static str,
}

impl Default for DockerImageManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerImageManager {
    pub fn new() -> Self {
        Self {
            image_tag: DEFAULT_IMAGE_TAG.to_string(),
            dockerfile_content: include_str!("../../../resources/docker/Dockerfile"),
        }
    }

    pub fn image_tag(&self) -> &str {
        &self.image_tag
    }

    pub async fn docker_available() -> Result<()> {
        let output = Command::new("docker")
            .arg("version")
            .arg("--format")
            .arg("{{.Server.Version}}")
            .output()
            .await
            .map_err(|e| anyhow!("Docker is not installed or not in PATH: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "Docker daemon is not running or not accessible: {stderr}"
            ));
        }

        Ok(())
    }

    pub async fn image_exists(&self) -> bool {
        let output = Command::new("docker")
            .args(["image", "inspect", &self.image_tag])
            .output()
            .await;

        matches!(output, Ok(o) if o.status.success())
    }

    pub async fn build_image(&self) -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let dockerfile_path = temp_dir.path().join("Dockerfile");
        tokio::fs::write(&dockerfile_path, self.dockerfile_content).await?;

        log::info!("Building Docker image {} ...", self.image_tag);

        let output = Command::new("docker")
            .args([
                "build",
                "-t",
                &self.image_tag,
                "-f",
                &dockerfile_path.to_string_lossy(),
                &temp_dir.path().to_string_lossy(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Docker image build failed: {stderr}"));
        }

        log::info!("Docker image {} built successfully", self.image_tag);
        Ok(())
    }

    pub async fn ensure_image(&self) -> Result<()> {
        if self.image_exists().await {
            return Ok(());
        }
        self.build_image().await
    }

    pub fn dockerfile_path() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("schaltwerk").join("docker").join("Dockerfile"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_image_tag() {
        let manager = DockerImageManager::new();
        assert_eq!(manager.image_tag(), "schaltwerk-sandbox:latest");
    }

    #[test]
    fn dockerfile_content_is_embedded() {
        let manager = DockerImageManager::new();
        assert!(
            manager.dockerfile_content.contains("FROM"),
            "embedded Dockerfile should contain FROM directive"
        );
    }

    #[test]
    fn dockerfile_path_returns_some() {
        let path = DockerImageManager::dockerfile_path();
        assert!(path.is_some());
    }
}
