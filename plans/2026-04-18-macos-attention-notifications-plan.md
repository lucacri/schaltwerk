# macOS Attention Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver dock bounce and Lucode-branded macOS system notifications when a backgrounded session enters `attention_required`.

**Architecture:** Keep attention transition detection in `useAttentionNotifications`; move platform notification delivery and permission handling behind `attentionBridge`. Expose all existing modes in Settings and make install signing deterministic when a local identity is available.

**Tech Stack:** React, Vitest, Tauri notification plugin, Tauri capabilities, Justfile macOS install recipes.

---

### Task 1: Notification Bridge Tests

**Files:**
- Modify: `src/utils/attentionBridge.ts`
- Create or modify: `src/utils/attentionBridge.test.ts`
- Modify: `src/types/tauri-plugin-notification.d.ts`
- Modify: `src/test/mocks/tauri-plugin-notification.ts`

**Step 1: Write failing tests**

Add tests that prove `sendAttentionSystemNotification()`:
- sends immediately when permission is already granted;
- requests permission and sends when permission is granted after prompt;
- logs and does not send when permission is denied.

**Step 2: Run test to verify it fails**

Run: `bun run test:frontend -- src/utils/attentionBridge.test.ts`

Expected: FAIL because `sendAttentionSystemNotification` does not exist.

**Step 3: Implement minimal bridge**

Import `isPermissionGranted`, `requestPermission`, and `sendNotification` from `@tauri-apps/plugin-notification`. Add `sendAttentionSystemNotification(sessionName: string): Promise<void>`.

**Step 4: Run test to verify it passes**

Run: `bun run test:frontend -- src/utils/attentionBridge.test.ts`

Expected: PASS.

### Task 2: Attention Hook Mode Branching

**Files:**
- Modify: `src/hooks/useAttentionNotifications.ts`
- Modify: `src/hooks/useAttentionNotifications.test.ts`

**Step 1: Write failing hook tests**

Add render-hook tests that simulate a background window and a session transitioning from not-attention to `attention_required`. Cover `dock`, `system`, `both`, and `off`.

**Step 2: Run test to verify it fails**

Run: `bun run test:frontend -- src/hooks/useAttentionNotifications.test.ts`

Expected: FAIL because only dock bounce is called for every non-off mode.

**Step 3: Implement minimal branching**

Call `requestDockBounce` for `dock`/`both`, and `sendAttentionSystemNotification` for `system`/`both`.

**Step 4: Run test to verify it passes**

Run: `bun run test:frontend -- src/hooks/useAttentionNotifications.test.ts`

Expected: PASS.

### Task 3: Settings UI Modes

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`
- Modify: `src/components/modals/SettingsModal.test.tsx`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`

**Step 1: Write failing tests**

Add tests proving Settings exposes Off, Dock, System, and Both, persists the selected value, and uses the selected mode for the test button.

**Step 2: Run test to verify it fails**

Run: `bun run test:frontend -- src/components/modals/SettingsModal.test.tsx`

Expected: FAIL because only an on/off toggle exists.

**Step 3: Implement minimal UI**

Replace the notification toggle with the shared `Select` component. Keep the baseline checkbox disabled only when mode is `off`. Use `requestDockBounce` and/or `sendAttentionSystemNotification` for the test button based on selected mode.

**Step 4: Run test to verify it passes**

Run: `bun run test:frontend -- src/components/modals/SettingsModal.test.tsx`

Expected: PASS.

### Task 4: Capability and Signing Guards

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `justfile`
- Create: `scripts/ensure-local-macos-signing-identity.sh`
- Create or modify: `src/test/architecture.test.ts`

**Step 1: Write failing tests**

Add repository guard tests that assert `notification:allow-notify` is present in the capability, `notification:default` is absent, and both install recipes run the local signing helper before copying the app.

**Step 2: Run test to verify it fails**

Run: `bun run test:frontend -- src/test/architecture.test.ts`

Expected: FAIL because notify permission and signing helper are missing.

**Step 3: Implement minimal config**

Add `notification:allow-notify`. Add a script that creates or reuses a self-signed `Lucode Local Development` codesigning identity on macOS, then signs the built app bundle before `/Applications` copy in both install recipes.

**Step 4: Run test to verify it passes**

Run: `bun run test:frontend -- src/test/architecture.test.ts`

Expected: PASS.

### Task 5: Verification and Review

**Files:**
- All modified files

**Step 1: Run focused tests**

Run the four focused test commands from prior tasks.

**Step 2: Run full validation**

Run: `just test`

Expected: exit 0.

**Step 3: Request review**

Use the requesting-code-review workflow against the final diff.

**Step 4: Create squashed commit**

Stage all changes and create one commit after review issues are addressed.
