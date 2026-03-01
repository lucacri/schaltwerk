use crate::{DOCKER_MANAGER, PROJECT_MANAGER};
use lucode::domains::docker::service::DockerImageManager;
use lucode::infrastructure::database::db_project_config::ProjectConfigMethods;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub available: bool,
    pub image_exists: bool,
    pub sandbox_enabled: bool,
}

#[tauri::command]
pub async fn get_docker_status() -> Result<DockerStatus, String> {
    let available = DockerImageManager::docker_available().await.is_ok();

    let image_exists = if available {
        DockerImageManager::new().image_exists().await
    } else {
        false
    };

    let sandbox_enabled: bool = get_current_project_docker_enabled()
        .await
        .unwrap_or_default();

    Ok(DockerStatus {
        available,
        image_exists,
        sandbox_enabled,
    })
}

#[tauri::command]
pub async fn set_docker_sandbox_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use crate::events::{DockerStatusChangedPayload, SchaltEvent, emit_event};

    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.write().await;
    let db = core.database();

    db.set_docker_sandbox_enabled(&project.path, enabled)
        .map_err(|e| format!("Failed to set Docker sandbox setting: {e}"))?;

    if !enabled
        && let Some(docker_manager) = DOCKER_MANAGER.get()
        && let Err(e) = docker_manager.stop_container_for_project(&project.path).await
    {
        log::warn!("Failed to stop Docker container after disabling: {e}");
    }

    let available = DockerImageManager::docker_available().await.is_ok();
    let image_exists = if available {
        DockerImageManager::new().image_exists().await
    } else {
        false
    };

    let _ = emit_event(
        &app,
        SchaltEvent::DockerStatusChanged,
        &DockerStatusChangedPayload {
            available,
            image_exists,
            sandbox_enabled: enabled,
        },
    );

    Ok(())
}

async fn run_docker_build(app: &tauri::AppHandle, no_cache: bool) -> Result<(), String> {
    use crate::events::{DockerBuildProgressPayload, SchaltEvent, emit_event};

    let image_manager = DockerImageManager::new();
    let label = if no_cache { "Rebuilding" } else { "Building" };

    let _ = emit_event(
        app,
        SchaltEvent::DockerImageBuildProgress,
        &DockerBuildProgressPayload {
            message: format!("{label} Docker image..."),
            complete: false,
            success: false,
        },
    );

    match image_manager.build_image(no_cache).await {
        Ok(()) => {
            let _ = emit_event(
                app,
                SchaltEvent::DockerImageBuildProgress,
                &DockerBuildProgressPayload {
                    message: "Docker image built successfully".to_string(),
                    complete: true,
                    success: true,
                },
            );
            Ok(())
        }
        Err(e) => {
            let msg = format!("Docker image build failed: {e}");
            let _ = emit_event(
                app,
                SchaltEvent::DockerImageBuildProgress,
                &DockerBuildProgressPayload {
                    message: msg.clone(),
                    complete: true,
                    success: false,
                },
            );
            Err(msg)
        }
    }
}

#[tauri::command]
pub async fn build_docker_image(app: tauri::AppHandle) -> Result<(), String> {
    run_docker_build(&app, false).await
}

#[tauri::command]
pub async fn rebuild_docker_image(app: tauri::AppHandle) -> Result<(), String> {
    run_docker_build(&app, true).await
}

async fn get_current_project_docker_enabled() -> Result<bool, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.read().await;
    let db = core.database();

    db.get_docker_sandbox_enabled(&project.path)
        .map_err(|e| format!("Failed to get Docker sandbox setting: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_docker_status_uninitialized_manager() {
        let result = get_docker_status().await;
        assert!(result.is_ok());
        let status = result.unwrap();
        assert!(!status.sandbox_enabled);
    }
}
