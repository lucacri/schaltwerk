use anyhow::{Result, anyhow};
use tokio::process::Command;

pub const DEFAULT_IMAGE_TAG: &str = "lucode-sandbox:latest";

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

    pub fn build_args(image_tag: &str, dockerfile_path: &str, context_dir: &str, no_cache: bool) -> Vec<String> {
        let mut args = vec!["build".to_string()];
        if no_cache {
            args.push("--no-cache".to_string());
        }
        args.extend([
            "-t".to_string(),
            image_tag.to_string(),
            "-f".to_string(),
            dockerfile_path.to_string(),
            context_dir.to_string(),
        ]);
        args
    }

    pub async fn build_image(&self, no_cache: bool) -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let dockerfile_path = temp_dir.path().join("Dockerfile");
        tokio::fs::write(&dockerfile_path, self.dockerfile_content).await?;

        let cache_label = if no_cache { " (no cache)" } else { "" };
        log::info!("Building Docker image {}{cache_label}...", self.image_tag);

        let args = Self::build_args(
            &self.image_tag,
            &dockerfile_path.to_string_lossy(),
            &temp_dir.path().to_string_lossy(),
            no_cache,
        );

        let output = Command::new("docker")
            .args(&args)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Docker image build failed: {stderr}"));
        }

        log::info!("Docker image {} built successfully", self.image_tag);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_image_tag() {
        let manager = DockerImageManager::new();
        assert_eq!(manager.image_tag(), "lucode-sandbox:latest");
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
    fn build_args_without_cache() {
        let args = DockerImageManager::build_args("img:latest", "/tmp/Dockerfile", "/tmp", true);
        assert!(args.contains(&"--no-cache".to_string()));
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"img:latest".to_string()));
    }

    #[test]
    fn build_args_with_cache() {
        let args = DockerImageManager::build_args("img:latest", "/tmp/Dockerfile", "/tmp", false);
        assert!(!args.contains(&"--no-cache".to_string()));
        assert!(args.contains(&"build".to_string()));
    }
}
