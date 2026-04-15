# Mac Whisper Voice Input — Design

## Problem

Mac Whisper (third-party voice-to-text tool) cannot inject text into Lucode's input surfaces:

1. The `MarkdownEditor` "Prompt / Content" field in `NewSessionModal` (CodeMirror 6 `contenteditable` div).
2. The xterm.js terminal hosting the spec clarification agent (xterm's hidden helper `<textarea>`).

Mac Whisper works in every other macOS app the user has tried, including other WebKit-based and native apps. The same failure across two structurally unrelated input surfaces inside the same Tauri/WKWebView host points to an **app-level** root cause, not per-element ARIA semantics. The April 14 ARIA fix (commit `c533f8f5`) targeted built-in macOS Dictation/VoiceOver and is correct for that target, but it cannot help here — Mac Whisper does not consume those ARIA semantics directly.

## Root Cause

Mac Whisper uses the **macOS Accessibility API** (`AXUIElement`) to inject text into the focused input field of the frontmost app. This is the same mechanism documented for VibeWhisper, OpenWhispr, and similar tools, and it requires the target app to expose a populated accessibility tree.

WKWebView (and Chromium under Electron) **do not build their full accessibility tree by default** — accessibility is lazily activated. The convention for third-party assistive technology is to set the **`AXManualAccessibility`** attribute on the running application via `AXUIElementSetAttributeValue`. Once set, WebKit/Chromium populate the AX tree and individual HTML inputs (native `<input>`, `<textarea>`, `contenteditable`, ARIA `role="textbox"`) become discoverable.

Tauri (via `wry`) wraps a stock `WKWebView` inside a stock `NSApplication` from `tao`. Neither layer takes any action to enable accessibility. Built-in macOS Dictation/VoiceOver activate WebKit accessibility through their own private channel — which is why the April 14 ARIA work succeeded for those tools — but Mac Whisper relies on the public `AXManualAccessibility` mechanism, and that mechanism is never triggered for our app.

Sources:
- Electron issue [electron/electron#37465](https://github.com/electron/electron/issues/37465) and fix [PR #38102](https://github.com/electron/electron/pull/38102) describe the exact same root-cause pattern in Electron, including the `AXUIElementSetAttributeValue(appRef, kAXManualAccessibility, true)` pattern.
- Apple's `AXManualAccessibility` is the documented opt-in attribute for third-party assistive tech to force AX-tree activation in non-native apps (also referenced in WebKit/AppKit accessibility guidelines).

## Approach

Two complementary layers, applied together:

**Layer 1 (primary, app-level):** Activate WKWebView's accessibility tree **proactively at app startup** by setting `AXManualAccessibility = true` on our own application's `AXUIElement`. This makes the AX tree available to **any** assistive tool (Mac Whisper, VoiceOver, generic AX clients) without the tool having to opt-in itself.

**Layer 2 (defense in depth, per-surface):** Once the AX tree is active, the leaf input surfaces must be discoverable with enough metadata for Mac Whisper's text-field detection:

- Enable xterm.js's built-in `screenReaderMode`, which causes xterm to populate its own accessibility live-region tree.
- Label xterm's helper `<textarea>` (role, aria-label, autocomplete/autocorrect/spellcheck off) after `open()` so it presents as a real text-input surface.
- Re-style the helper textarea so it is visually hidden but retains in-document geometry (1x1 at 0,0 with opacity 0.01) instead of being pushed offscreen or zero-sized — positions that assistive clients tend to skip.
- Reinforce CodeMirror's focused content node with explicit `tabindex`, `inputmode="text"`, `spellcheck=false`, `autocorrect=off`, `autocapitalize=off`, plus a `data-lucode-text-input-surface` marker; mirror the labelling on the editor root via `EditorView.editorAttributes` so the outer DOM also reads as a labeled text-input region.

Layer 1 alone addresses the documented root cause. Layer 2 is cheap, asserted by tests, and hardens the inputs that Mac Whisper (and other AX tools) will actually land on after the tree is activated.

## Components

### New: `src-tauri/src/macos_accessibility.rs`

macOS-only module:

- `enable_manual_accessibility()` — gets the process PID, calls `AXUIElementCreateApplication(pid)`, then `AXUIElementSetAttributeValue(appRef, "AXManualAccessibility", kCFBooleanTrue)`. Releases the `AXUIElementRef`. Logs info on success, warn on error code. Never panics.
- Links the system `ApplicationServices` framework via `extern "C"`. No new crate dependencies (relies on existing `core-foundation` / `core-foundation-sys`).
- Non-macOS stub is an empty fn.
- A smoke test asserts the call does not panic.

### Modified: `src-tauri/src/main.rs`

Register `mod macos_accessibility;` and invoke `macos_accessibility::enable_manual_accessibility()` at startup, immediately after `macos_prefs::disable_smart_substitutions()` (same phase, same logging convention).

### Modified: `src/terminal/xterm/XtermTerminal.ts`

- Set `screenReaderMode: true` in `buildTerminalOptions`.
- After `raw.open(container)` on first attach, call a new private `configureInputTextareaAccessibility()` that sets `role=textbox`, `aria-label="Terminal input"`, `aria-multiline=false`, `autocomplete=off`, `autocorrect=off`, `autocapitalize=off`, `spellcheck=false`, and `data-lucode-text-input-surface=terminal` on `raw.textarea`.

### Modified: `src/components/terminal/xtermOverrides.css`

New rule `.schaltwerk-terminal-wrapper .xterm .xterm-helper-textarea` pinning the helper textarea to `top:0; left:0; width:1px; height:1px; opacity:0.01; z-index:0; pointer-events:none; caret-color/background/color: transparent`. Keeps the textarea visually invisible without pushing it offscreen.

### Modified: `src/components/specs/MarkdownEditor.tsx`

- Extend the existing `EditorView.contentAttributes` facet with `tabindex=0`, `inputmode=text`, `spellcheck=false`, `autocorrect=off`, `autocapitalize=off`, and `data-lucode-text-input-surface=markdown-editor`.
- Add a second facet `EditorView.editorAttributes` that mirrors the label on the editor root (`aria-label` / `aria-labelledby` fallback chain) plus `data-lucode-text-input-root=markdown-editor`. Both facets are added to `extensions`.

## Why This Is Sufficient

After Layer 1, WebKit populates its AX tree. After Layer 2, each leaf surface is labeled with the same metadata macOS native inputs expose. Native `<input>` elsewhere in the app (Agent Name, Settings fields) was already adequately labeled and becomes discoverable automatically once the tree is active.

Manual release validation remains necessary because Mac Whisper is an external macOS app: dictate into Agent Name, New Agent Prompt / Content, a spec editor, Settings setup script, and a spec-clarification terminal.

## Alternatives Rejected

1. **Per-element ARIA tweaks only** — April 14 already did this for CodeMirror and it did not fix Mac Whisper, because the AX tree itself was not active. Retained here as a supporting layer, not as the fix.
2. **Subclass `NSApplication` to override `accessibilityAttributeNames` / `accessibilitySetValue:forAttribute:`** (the Electron PR #38102 approach). Equivalent in effect, but requires swizzling `tao`'s NSApplication — far more invasive than setting the attribute on ourselves at startup.
3. **Replace CodeMirror with native `<textarea>`** — explicitly rejected by the April 14 design (loses CM features). Wouldn't help xterm anyway.
4. **Bundle a Tauri plugin or fork wry** — overkill for a single FFI call at startup.

## Non-Goals

- Do not replace CodeMirror with a plain textarea.
- Do not add a global dictation overlay that would steal normal keyboard focus.
- Do not remove the April 14 ARIA work.
- Do not build features for non-macOS platforms — Lucode is a macOS-only product.
