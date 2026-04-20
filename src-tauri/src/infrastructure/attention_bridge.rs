use crate::domains::attention::{SessionAttentionKind, get_session_attention_state};
use log::{debug, warn};

fn map_attention_kind(attention_kind: Option<&str>) -> Option<SessionAttentionKind> {
    attention_kind.and_then(|kind| match kind {
        "idle" => Some(SessionAttentionKind::Idle),
        "waiting_for_input" => Some(SessionAttentionKind::WaitingForInput),
        _ => None,
    })
}

pub async fn update_session_attention_state_immediate(
    session_id: &str,
    needs_attention: bool,
    attention_kind: Option<&str>,
) {
    if let Some(registry) = get_session_attention_state() {
        let mapped_kind = map_attention_kind(attention_kind);
        let mut guard = registry.lock().await;
        guard.update(session_id, needs_attention, mapped_kind);
        debug!(
            "Attention state updated immediately: session={session_id}, registry_size={}",
            guard.get_all().len()
        );
    } else {
        warn!("SESSION_ATTENTION_STATE not initialized, cannot update attention for {session_id}");
    }
}

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
            let mapped_kind = map_attention_kind(attention_kind.as_deref());
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
pub async fn clear_session_attention_state_immediate(session_id: &str) {
    if let Some(registry) = get_session_attention_state() {
        let mut guard = registry.lock().await;
        guard.clear_session(session_id);
    }
}

pub fn clear_session_attention_state(session_id: String) {
    if let Some(registry) = get_session_attention_state() {
        tauri::async_runtime::spawn(async move {
            let mut guard = registry.lock().await;
            guard.clear_session(&session_id);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clear_session_attention_state_immediate, update_session_attention_state_immediate,
    };
    use crate::domains::attention::{
        SessionAttentionKind, SessionAttentionState, SessionAttentionStatus,
        get_session_attention_state, set_session_attention_state,
    };
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn registry() -> Arc<Mutex<SessionAttentionState>> {
        get_session_attention_state().unwrap_or_else(|| {
            let registry = Arc::new(Mutex::new(SessionAttentionState::default()));
            set_session_attention_state(Arc::clone(&registry));
            get_session_attention_state().unwrap_or(registry)
        })
    }

    #[tokio::test]
    async fn update_session_attention_state_immediate_writes_before_returning() {
        let registry = registry();
        let session_id = "attention-bridge-immediate-update";

        update_session_attention_state_immediate(session_id, true, Some("waiting_for_input")).await;

        let state = registry.lock().await;
        assert_eq!(
            state.get(session_id),
            Some(SessionAttentionStatus {
                needs_attention: true,
                kind: Some(SessionAttentionKind::WaitingForInput),
            })
        );
    }

    #[tokio::test]
    async fn clear_session_attention_state_immediate_clears_before_returning() {
        let registry = registry();
        let session_id = "attention-bridge-immediate-clear";
        {
            let mut state = registry.lock().await;
            state.update(
                session_id,
                true,
                Some(SessionAttentionKind::WaitingForInput),
            );
        }

        clear_session_attention_state_immediate(session_id).await;

        let state = registry.lock().await;
        assert_eq!(state.get(session_id), None);
    }
}
