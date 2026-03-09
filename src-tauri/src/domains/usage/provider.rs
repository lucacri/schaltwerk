use async_trait::async_trait;

use super::types::UsageSnapshot;

#[async_trait]
pub trait UsageProvider: Send + Sync {
    fn provider_name(&self) -> &str;
    async fn fetch_usage(&self) -> Result<UsageSnapshot, String>;
}
