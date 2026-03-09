use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub session_percent: u8,
    pub session_reset_time: Option<String>,
    pub weekly_percent: u8,
    pub weekly_reset_time: Option<String>,
    pub provider: String,
    pub fetched_at: DateTime<Utc>,
}
