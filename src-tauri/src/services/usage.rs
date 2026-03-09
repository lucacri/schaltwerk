use crate::domains::usage::anthropic::AnthropicUsageProvider;
use crate::domains::usage::provider::UsageProvider;

pub use crate::domains::usage::types::UsageSnapshot;

pub async fn fetch_usage() -> Result<UsageSnapshot, String> {
    let provider = AnthropicUsageProvider::new();
    provider.fetch_usage().await
}
