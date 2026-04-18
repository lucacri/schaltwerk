# macOS Attention Notifications Design

## Goal

When a session transitions into `attention_required` while the Lucode window is backgrounded on macOS, Lucode should request dock attention and send a system notification under bundle id `com.lucacri.lucode`.

## Recommended approach

Use the existing `AttentionNotificationMode` model as the single preference source. The hook that detects new attention sessions should branch on `off`, `dock`, `system`, and `both`, and delegate platform notification details to `src/utils/attentionBridge.ts`. This keeps transition detection in one place and keeps Tauri/plugin error handling at the bridge boundary.

Alternatives considered:

- Backend-only notification dispatch: avoids frontend plugin calls, but duplicates transition detection and preference wiring.
- Keep dock-only behavior and document re-prompts: smallest change, but fails the user requirement for banners.
- Add all notification channels in the existing hook: direct, but mixes plugin permission flow, dock bounce, and session transition logic.

## Components

- `useAttentionNotifications` detects new `attention_required` sessions and invokes the channels requested by the saved mode.
- `attentionBridge` exposes dock and system notification helpers. System notifications request permission on first use and log failures with context.
- Settings exposes the four existing modes instead of an on/off toggle.
- Tauri capabilities grant the notification plugin permission needed to send notifications.
- `just install` and `just install-fast` sign `/Applications/Lucode.app` with a stable local identity when available, so macOS notification permission survives rebuilds.

## Behavior

- `off`: no dock bounce and no banner.
- `dock`: dock bounce only.
- `system`: system notification only.
- `both`: dock bounce and system notification.
- Notifications still fire only for new attention transitions while the window is backgrounded.
- Permission is requested on first system notification attempt. If denied or unavailable, Lucode logs and skips the banner without blocking the dock path.

## Testing

- Unit tests cover mode-to-channel branching in `useAttentionNotifications`.
- Unit tests cover permission request and failure handling in `attentionBridge`.
- Settings tests cover all four mode options and the test button.
- A repository test guards the notification capability and install signing recipe.
