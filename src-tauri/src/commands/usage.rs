use lucode::services::usage::{UsageSnapshot, fetch_usage as fetch_usage_service};

#[tauri::command]
pub async fn fetch_usage() -> Result<UsageSnapshot, String> {
    fetch_usage_service().await
}
