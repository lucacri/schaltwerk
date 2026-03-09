use async_trait::async_trait;
use chrono::Utc;

use super::provider::UsageProvider;
use super::types::UsageSnapshot;

pub struct AnthropicUsageProvider;

impl AnthropicUsageProvider {
    pub fn new() -> Self {
        Self
    }
}

fn read_oauth_token() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
            .map_err(|e| format!("Failed to run security command: {e}"))?;

        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(token) = parsed
                    .get("claudeAiOauth")
                    .and_then(|v| v.get("accessToken"))
                    .and_then(|v| v.as_str())
                {
                    return Ok(token.to_string());
                }
                return Err("Keychain entry missing claudeAiOauth.accessToken field".to_string());
            }
            return Ok(raw);
        }

        Err(format!(
            "security command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
        let cred_path = home.join(".claude").join(".credentials.json");
        let content = std::fs::read_to_string(&cred_path)
            .map_err(|e| format!("Failed to read {}: {e}", cred_path.display()))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse credentials JSON: {e}"))?;
        parsed
            .get("claudeAiOauth")
            .and_then(|v| v.get("accessToken"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "Missing claudeAiOauth.accessToken in credentials file".to_string())
    }
}

pub fn parse_usage_response(json: &serde_json::Value) -> Result<UsageSnapshot, String> {
    let session = json
        .get("session")
        .ok_or("Missing 'session' field in response")?;
    let weekly = json
        .get("weekly")
        .ok_or("Missing 'weekly' field in response")?;

    let session_percent = session
        .get("usage_percent")
        .and_then(|v| v.as_u64())
        .ok_or("Missing session.usage_percent")? as u8;

    let weekly_percent = weekly
        .get("usage_percent")
        .and_then(|v| v.as_u64())
        .ok_or("Missing weekly.usage_percent")? as u8;

    let session_reset_time = session
        .get("reset_time")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let weekly_reset_time = weekly
        .get("reset_time")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(UsageSnapshot {
        session_percent,
        session_reset_time,
        weekly_percent,
        weekly_reset_time,
        provider: "anthropic".to_string(),
        fetched_at: Utc::now(),
    })
}

#[async_trait]
impl UsageProvider for AnthropicUsageProvider {
    fn provider_name(&self) -> &str {
        "anthropic"
    }

    async fn fetch_usage(&self) -> Result<UsageSnapshot, String> {
        let token =
            tokio::task::spawn_blocking(read_oauth_token)
                .await
                .map_err(|e| format!("Token read task failed: {e}"))??;

        let client = reqwest::Client::new();
        let response = client
            .get("https://api.anthropic.com/api/oauth/usage")
            .bearer_auth(&token)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| format!("Usage API request failed: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Usage API returned status {}", response.status()));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse usage response: {e}"))?;

        parse_usage_response(&json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_usage_response_full() {
        let json = serde_json::json!({
            "session": { "usage_percent": 12, "reset_time": "11:59pm" },
            "weekly": { "usage_percent": 73, "reset_time": "Mar 15, 10:59am" }
        });
        let snapshot = parse_usage_response(&json).unwrap();
        assert_eq!(snapshot.session_percent, 12);
        assert_eq!(
            snapshot.session_reset_time,
            Some("11:59pm".to_string())
        );
        assert_eq!(snapshot.weekly_percent, 73);
        assert_eq!(
            snapshot.weekly_reset_time,
            Some("Mar 15, 10:59am".to_string())
        );
        assert_eq!(snapshot.provider, "anthropic");
    }

    #[test]
    fn test_parse_usage_response_missing_reset() {
        let json = serde_json::json!({
            "session": { "usage_percent": 0 },
            "weekly": { "usage_percent": 50 }
        });
        let snapshot = parse_usage_response(&json).unwrap();
        assert_eq!(snapshot.session_percent, 0);
        assert_eq!(snapshot.session_reset_time, None);
        assert_eq!(snapshot.weekly_percent, 50);
        assert_eq!(snapshot.weekly_reset_time, None);
    }

    #[test]
    fn test_parse_usage_response_missing_session() {
        let json = serde_json::json!({
            "weekly": { "usage_percent": 50 }
        });
        let result = parse_usage_response(&json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("session"));
    }

    #[test]
    fn test_parse_usage_response_missing_weekly() {
        let json = serde_json::json!({
            "session": { "usage_percent": 10 }
        });
        let result = parse_usage_response(&json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("weekly"));
    }
}
