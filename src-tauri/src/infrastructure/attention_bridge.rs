use crate::domains::attention::{SessionAttentionKind, get_session_attention_state};
use log::{debug, warn};

/// Forward terminal attention events to the session attention state registry
/// for exposure via the MCP API.
pub fn update_session_attention_state(
    session_id: String,
    needs_attention: bool,
    attention_kind: Option<String>,
) {
    if let Some(registry) = get_session_attention_state() {
        debug!(
            "Updating attention state: session={session_id}, needs_attention={needs_attention}, attention_kind={attention_kind:?}"
        );
        tauri::async_runtime::spawn(async move {
            let mapped_kind = attention_kind.as_deref().and_then(|kind| match kind {
                "idle" => Some(SessionAttentionKind::Idle),
                "waiting_for_input" => Some(SessionAttentionKind::WaitingForInput),
                _ => None,
            });
            let mut guard = registry.lock().await;
            guard.update(&session_id, needs_attention, mapped_kind);
            debug!(
                "Attention state updated: session={session_id}, registry_size={}",
                guard.get_all().len()
            );
        });
    } else {
        warn!("SESSION_ATTENTION_STATE not initialized, cannot update attention for {session_id}");
    }
}

/// Clear attention state for a session when it is removed.
pub fn clear_session_attention_state(session_id: String) {
    if let Some(registry) = get_session_attention_state() {
        tauri::async_runtime::spawn(async move {
            let mut guard = registry.lock().await;
            guard.clear_session(&session_id);
        });
    }
}
