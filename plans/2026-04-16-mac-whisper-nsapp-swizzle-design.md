# Mac Whisper Voice Input — NSApplication Swizzle Fix (Design)

## Problem

Mac Whisper (third-party AX-based dictation) cannot inject text into **any** Lucode input surface — native `<input>`, CodeMirror, xterm helper textarea, URL bar. The failure is silent (no error, no partial result) and universal across structurally different surfaces, so the defect is at the application / AX-tree layer, not per-element.

The prior fix on 2026-04-15 (`ffef5b58`) introduced a startup call:

```rust
AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", kCFBooleanTrue);
```

and ARIA-hardened two specific surfaces (MarkdownEditor, xterm helper textarea). The ARIA hardening is correct and remains useful. The startup AX call does not activate WKWebView's tree.

## Root Cause (Confirmed)

The prior fix's startup call returns `AXError = -25208` (`kAXErrorNotImplemented`) — confirmed by grepping `[macOS a11y]` lines in `~/Library/Application Support/lucode/logs/lucode-*.log`.

`AXManualAccessibility` is a **Chromium/Electron convention**, not a macOS system attribute. The AX subsystem will only route a set for it when the receiving NSApplication explicitly:

1. Advertises the attribute in `-[NSApplication accessibilityAttributeNames]`, and
2. Reports it settable via `-[NSApplication accessibilityIsAttributeSettable:]`, and
3. Handles it in `-[NSApplication accessibilitySetValue:forAttribute:]`.

Electron implements exactly this pattern in `AtomApplication` (an NSApplication subclass) — see `electron/electron#37465` and `electron/electron#38102`. Tauri's `wry` uses the stock `tao` NSApplication, which installs none of these overrides. Result: the set-attribute call becomes a no-op and the WKWebView AX tree never activates; Mac Whisper's discovery query for AX elements silently fails.

## Fix

Inject three `NSAccessibility` override methods onto NSApp's live class at runtime (after tao has installed `TaoApp`), so the stock `tao` app behaves like Electron's `AtomApplication` for the accessibility activation contract:

- `accessibilityAttributeNames` — add `AXManualAccessibility` and `AXEnhancedUserInterface` to the inherited list.
- `accessibilityIsAttributeSettable:` — return `YES` for those two attributes, else fall through.
- `accessibilitySetValue:forAttribute:` — accept those two attributes (the *fact that we accept* is the activation signal; for WKWebView there is no equivalent of Chromium's `BrowserAccessibilityState::EnableAccessibility()` — WebKit's own AX integration lazily activates once queries to NSApp succeed), then forward to the original implementation for every other attribute.

Why method injection and not isa-swizzling of the live singleton: `tao` installs its own `TaoApp : NSApplication` subclass that overrides `sendEvent:` to work around the macOS Cmd-keyUp bug. Isa-swizzling NSApp to a `LucodeAccessibleApplication : NSApplication` subclass would remove `TaoApp` from the method resolution chain and break Cmd-shortcut keyUp delivery. Instead, we define `LucodeAccessibleApplication : NSApplication` only as a well-typed **source** of IMPs and type encodings (using `objc2::define_class!`), never instantiate it, and use `class_addMethod` to inject those IMPs onto `[NSApp class]` (which is `TaoApp` at that point).

After injection, the existing `AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", true)` self-call succeeds (`err == 0`) at startup, eagerly activating the AX tree so Mac Whisper doesn't even have to set it itself. An external client setting the same attribute later is also accepted.

## Components

### Modified: `src-tauri/src/macos_accessibility.rs`

Replace the current body. Single public entry point:

- `enable_manual_accessibility()` — kept for callsite compatibility. Registers `LucodeAccessibleApplication` (defined via `define_class!`) with the Objective-C runtime as an IMP source, then on the main thread injects the three IMPs onto `[NSApp class]` via `ffi::class_addMethod` (`ffi::class_replaceMethod` if the method already exists). Idempotent via an `AtomicBool` that only latches on successful injection — off-main-thread calls log and return without consuming the latch. Finally performs the `AXUIElementSetAttributeValue` self-call and logs the return code. Never panics.

Non-macOS stub unchanged: empty fn.

### Modified: `src-tauri/Cargo.toml`

Add macOS-only direct deps (already transitive via Tauri, pinning as direct keeps the API surface stable):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.10"
core-foundation-sys = "0.8"
objc2 = "0.6"
objc2-foundation = "0.3"
objc2-app-kit = "0.3"
```

### Modified: `src-tauri/src/main.rs`

- The early call to `macos_accessibility::enable_manual_accessibility()` is removed (it previously ran before tao installed `TaoApp`).
- Replaced by a call from inside `.setup(move |app| { ... })`, which fires after Tauri/tao have bound NSApp to `TaoApp`.

### Unchanged (retained additive hardening)

- `src/components/specs/MarkdownEditor.tsx` — CodeMirror ARIA attributes retained.
- `src/terminal/xterm/XtermTerminal.ts` — helper textarea ARIA retained.
- `src/components/terminal/xtermOverrides.css` — 1×1 visible-but-tiny helper textarea rule retained.

## Test Strategy

**Unit tests (`src-tauri/src/macos_accessibility.rs`, macOS-only):**

1. `install_nsapp_accessibility_shim_is_idempotent` — call twice, assert no panic, assert `NSApplication` instance still responds to `accessibilityAttributeNames` and returns `AXManualAccessibility` in the returned array.
2. `nsapp_reports_ax_manual_accessibility_settable` — after install, `[NSApp accessibilityIsAttributeSettable:@"AXManualAccessibility"]` returns `YES`; same for `AXEnhancedUserInterface`; an unrelated attribute (`AXRole`) falls through to the original implementation and returns whatever stock NSApplication returns (must not crash, must not claim settable).
3. `nsapp_accepts_ax_manual_accessibility_set` — after install, `[NSApp accessibilitySetValue:@YES forAttribute:@"AXManualAccessibility"]` does not raise and does not panic; assert an internal "last accepted" flag was set.
4. `ax_self_call_succeeds_after_install` — after install, `AXUIElementSetAttributeValue(self, "AXManualAccessibility", kCFBooleanTrue)` returns `0` (was `-25208` before the fix). This is the test that would have caught the original regression.
5. `enable_manual_accessibility_does_not_panic` — keep existing smoke test.

**Validation in CI:** `cargo nextest run --package lucode macos_accessibility` covers the unit suite. `just test` runs the full suite.

**Manual validation (required; Mac Whisper is external):**

Dictate into each of these surfaces; each must accept text:

- Agent Name in New Session modal (native `<input>`).
- Prompt/Content in New Session modal (CodeMirror).
- Spec editor (CodeMirror, different mount).
- Settings → Git user name (native `<input>`).
- Settings → setup script (native `<textarea>`).
- WebPreview URL bar (native `<input>`).
- Running session terminal (xterm helper `<textarea>`).

If any one surface fails while others succeed after this fix, fall back to per-surface hardening analogous to the April 14 MarkdownEditor work on the remaining surfaces.

## Alternatives Considered

1. **Leave current FFI self-call in place** — rejected, logs prove it's a no-op.
2. **Isa-swizzle NSApp to `LucodeAccessibleApplication : NSApplication`** — rejected. `tao` installs its own `TaoApp : NSApplication` subclass with a `sendEvent:` override required for Cmd-keyUp delivery. Replacing NSApp's class with a sibling subclass drops `TaoApp` from the method resolution chain and breaks that workaround. Method injection on NSApp's live class preserves the full chain.
3. **Method-swizzle with `method_exchangeImplementations` on NSApplication** — rejected. NSApplication has no existing IMPs for `accessibilitySetValue:forAttribute:` etc. to exchange with; `class_addMethod` is the correct primitive for adding missing methods.
4. **Replace CodeMirror with native `<textarea>`** — rejected (April 14 design); does not help xterm/URL bar anyway.
5. **Post AX notifications directly** — not deterministic across macOS versions; the attribute-acceptance contract is the documented path.
6. **Wait for a Tauri/wry upstream fix** — indefinite timeline; we need this working now.

## Out of Scope

- Per-surface ARIA hardening beyond the two surfaces already covered. Only pursue if the AX-tree fix alone fails on specific surfaces.
- Non-macOS platforms (Lucode is macOS-only).
- Replacing CodeMirror; global dictation overlay; rolling back April 15 ARIA work.

## Risk & Rollback

Method swizzling is a widely used, stable macOS pattern; the three methods are part of the documented `NSAccessibility` informal protocol. Risk surface:

- Swizzle runs once, before Tauri's event loop starts, so ordering is deterministic.
- If swizzle fails (method not found, etc.), we log and fall back to the current no-op behavior — Mac Whisper stays broken but nothing else regresses.
- Rollback: revert the `macos_accessibility.rs` change; ARIA hardening continues to stand on its own.
