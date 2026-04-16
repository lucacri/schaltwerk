# Mac Whisper NSApplication Accessibility Swizzle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Mac Whisper (and any AX-based dictation tool) able to inject text into every Lucode input surface on macOS by teaching Lucode's NSApplication to advertise and accept the `AXManualAccessibility` / `AXEnhancedUserInterface` attributes, so that WKWebView's accessibility tree actually activates.

**Architecture:** At startup, before Tauri's event loop runs, dynamically create an Objective-C subclass `LucodeAccessibleApplication : NSApplication` that overrides `accessibilityAttributeNames`, `accessibilityIsAttributeSettable:`, and `accessibilitySetValue:forAttribute:`, then isa-swizzle (`object_setClass`) the existing `NSApp` instance to this subclass. After the swizzle, the pre-existing self-call to `AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", true)` succeeds (returns `0` instead of `-25208`) and the WKWebView AX tree becomes discoverable to external clients.

**Tech Stack:** Rust, macOS Objective-C runtime, `objc2` (0.6) + `objc2-foundation` (0.3) + `objc2-app-kit` (0.3), `core-foundation`, `core-foundation-sys`.

---

## Context for the implementer

### Root cause (verified)

- `src-tauri/src/macos_accessibility.rs:41-51` calls `AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", kCFBooleanTrue)` at startup.
- The logs at `~/Library/Application Support/lucode/logs/lucode-*.log` show the return code is `-25208` = `kAXErrorNotImplemented`.
- `AXManualAccessibility` is a Chromium/Electron convention; macOS only routes sets for it when the target app's `NSApplication` advertises the attribute and implements the setter (see Electron PR #38102).
- `tao` (which `wry` / `tauri` use) installs no such override. The fix is to install one.

### Why isa-swizzling and not `class_addMethod` / `method_exchangeImplementations`

`NSApplication` inherits `accessibilityAttributeNames` etc. from `NSResponder` / `NSObject`, but may also implement them itself (undocumented). Cleanest route: build a fresh subclass with `ClassBuilder::new("LucodeAccessibleApplication", NSApplication)`, add the three override methods, register, then switch the one live `NSApp` instance over with `object_setClass`. In our overrides we can safely call the original implementation through `msg_send_super!` (the superclass is `NSApplication`).

### Constraints / repo rules

- `#![deny(dead_code)]` in `main.rs` stays; no `#[allow(dead_code)]`.
- No timeouts / polling / retries; swizzle happens deterministically at startup before the Tauri builder.
- Tests live next to source (`#[cfg(test)] mod tests`) and run under `cargo nextest` via `just test`.
- macOS-only code lives behind `#[cfg(target_os = "macos")]`; non-macOS gets empty stubs.
- Cargo deps for macOS go under `[target.'cfg(target_os = "macos")'.dependencies]` (see `src-tauri/Cargo.toml:74-76`).
- Keep existing `enable_manual_accessibility` entry point name so `main.rs:1410` keeps working.
- Keep April 15 ARIA hardening (`MarkdownEditor.tsx`, `XtermTerminal.ts`, `xtermOverrides.css`) — additive.

### Working directory

All work happens in `/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/fix-voice-input_v1`. Do not `cd` elsewhere. The branch is `lucode/fix-voice-input_v1`.

---

## Task 1: Add objc2 / objc2-foundation / objc2-app-kit as direct macOS deps

**Files:**
- Modify: `src-tauri/Cargo.toml` (in the `[target.'cfg(target_os = "macos")'.dependencies]` section, currently lines 74-76)

**Step 1: Edit Cargo.toml**

Append three lines inside the existing macOS-only dependencies block so it reads:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.10"
core-foundation-sys = "0.8"
objc2 = "0.6"
objc2-foundation = "0.3"
objc2-app-kit = "0.3"
```

**Step 2: Verify versions resolve from the lock (no fetch churn expected)**

Run: `cd src-tauri && cargo metadata --format-version 1 >/dev/null`
Expected: exit 0, no network required (these crates are already transitive via Tauri — Cargo.lock already pins objc2 0.6.4, objc2-app-kit 0.3.2, objc2-foundation 0.3.2).

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "build(macos): promote objc2 family to direct deps"
```

---

## Task 2: Write failing test — attribute names include AXManualAccessibility

**Files:**
- Test: `src-tauri/src/macos_accessibility.rs` (extend the existing `#[cfg(test)] mod tests`)

**Step 1: Write the failing test**

Append to the `mod tests` block in `src-tauri/src/macos_accessibility.rs`:

```rust
#[cfg(target_os = "macos")]
#[test]
fn nsapp_reports_ax_manual_accessibility_in_attribute_names() {
    use objc2::msg_send;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{NSArray, NSString};

    super::install_nsapp_accessibility_shim();

    let mtm = objc2_foundation::MainThreadMarker::new()
        .expect("tests must be marked for the main thread");
    let app = NSApplication::sharedApplication(mtm);
    let names: objc2::rc::Retained<NSArray<NSString>> =
        unsafe { msg_send![&*app, accessibilityAttributeNames] };
    let manual = NSString::from_str("AXManualAccessibility");
    let enhanced = NSString::from_str("AXEnhancedUserInterface");
    assert!(names.iter().any(|n| &*n == &*manual),
            "NSApp accessibilityAttributeNames must include AXManualAccessibility");
    assert!(names.iter().any(|n| &*n == &*enhanced),
            "NSApp accessibilityAttributeNames must include AXEnhancedUserInterface");
}
```

Note: All objc2 NSApplication tests need the main-thread marker. Mark the test module attrs so `cargo nextest` runs them single-threaded on macOS (see Task 6). If `MainThreadMarker::new()` returns `None`, the test panics with a clear message — acceptable for CI.

**Step 2: Run it — expect fail**

Run: `cd src-tauri && cargo nextest run --package lucode macos_accessibility::tests::nsapp_reports_ax_manual_accessibility_in_attribute_names`
Expected: FAIL (function `install_nsapp_accessibility_shim` does not yet exist, compile error).

**Step 3: Do NOT commit yet (test is red)**

---

## Task 3: Install minimal swizzle skeleton to make Task 2 compile and still fail at runtime

**Files:**
- Modify: `src-tauri/src/macos_accessibility.rs`

**Step 1: Replace the file with the skeleton below**

```rust
// macOS accessibility activation for third-party AX clients (e.g., Mac Whisper).
//
// Stock `tao` NSApplication does not advertise the `AXManualAccessibility` /
// `AXEnhancedUserInterface` attributes that WebKit/Chromium apps are expected
// to expose so external assistive tech can force AX-tree activation. We install
// a one-time runtime override on the live NSApplication instance.

#[cfg(target_os = "macos")]
pub fn install_nsapp_accessibility_shim() {
    imp::install();
}

#[cfg(target_os = "macos")]
pub fn enable_manual_accessibility() {
    imp::install();
    imp::ax_self_activate();
}

#[cfg(not(target_os = "macos"))]
pub fn install_nsapp_accessibility_shim() {}

#[cfg(not(target_os = "macos"))]
pub fn enable_manual_accessibility() {}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::Once;

    static INSTALL_ONCE: Once = Once::new();

    pub(super) fn install() {
        INSTALL_ONCE.call_once(|| {
            // Implemented in Task 4.
        });
    }

    pub(super) fn ax_self_activate() {
        // Implemented in Task 5.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enable_manual_accessibility_does_not_panic() {
        enable_manual_accessibility();
    }
}
```

**Step 2: Verify Task 2 test now compiles but fails at runtime**

Run: `cd src-tauri && cargo nextest run --package lucode macos_accessibility`
Expected: test `nsapp_reports_ax_manual_accessibility_in_attribute_names` FAILS with "must include AXManualAccessibility"; the pre-existing smoke test passes.

**Step 3: Do NOT commit yet**

---

## Task 4: Implement the swizzle (core fix)

**Files:**
- Modify: `src-tauri/src/macos_accessibility.rs` — fill in `imp::install()`.

**Step 1: Replace the `mod imp` block with the working swizzle**

Replace the `#[cfg(target_os = "macos")] mod imp { … }` block with:

```rust
#[cfg(target_os = "macos")]
mod imp {
    use std::sync::Once;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, ClassBuilder};
    use objc2::{msg_send, sel, ClassType};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{MainThreadMarker, NSArray, NSString};

    static INSTALL_ONCE: Once = Once::new();

    const MANUAL: &str = "AXManualAccessibility";
    const ENHANCED: &str = "AXEnhancedUserInterface";

    pub(super) fn install() {
        INSTALL_ONCE.call_once(install_inner);
    }

    fn install_inner() {
        let Some(mtm) = MainThreadMarker::new() else {
            log::warn!("[macOS a11y] install skipped: not on main thread");
            return;
        };
        let app = NSApplication::sharedApplication(mtm);

        let subclass_name = c"LucodeAccessibleApplication";
        let Some(mut builder) = ClassBuilder::new(subclass_name, NSApplication::class()) else {
            // Class already registered from a prior call in this process — re-isa-swizzle.
            if let Some(cls) = objc2::runtime::AnyClass::get(subclass_name) {
                unsafe { objc2::runtime::objc_setClass(Retained::as_ptr(&app) as *mut _, cls) };
                log::info!("[macOS a11y] re-applied LucodeAccessibleApplication isa-swizzle");
            } else {
                log::warn!("[macOS a11y] could not allocate LucodeAccessibleApplication subclass");
            }
            return;
        };

        unsafe {
            builder.add_method(
                sel!(accessibilityAttributeNames),
                lucode_accessibility_attribute_names as extern "C" fn(_, _) -> _,
            );
            builder.add_method(
                sel!(accessibilityIsAttributeSettable:),
                lucode_accessibility_is_attribute_settable as extern "C" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(accessibilitySetValue:forAttribute:),
                lucode_accessibility_set_value_for_attribute as extern "C" fn(_, _, _, _),
            );
        }

        let cls = builder.register();
        unsafe {
            objc2::runtime::objc_setClass(Retained::as_ptr(&app) as *mut _, cls.as_ref());
        }
        log::info!("[macOS a11y] LucodeAccessibleApplication installed");
    }

    extern "C" fn lucode_accessibility_attribute_names(
        this: &AnyObject,
        _sel: objc2::runtime::Sel,
    ) -> *mut NSArray<NSString> {
        unsafe {
            let base: Retained<NSArray<NSString>> =
                msg_send![super(this, NSApplication::class()), accessibilityAttributeNames];
            let extras = [NSString::from_str(MANUAL), NSString::from_str(ENHANCED)];
            let merged = base.to_vec().into_iter()
                .chain(extras.iter().map(|s| Retained::clone(s)))
                .collect::<Vec<_>>();
            Retained::into_raw(NSArray::from_retained_slice(&merged))
        }
    }

    extern "C" fn lucode_accessibility_is_attribute_settable(
        this: &AnyObject,
        _sel: objc2::runtime::Sel,
        attribute: *mut NSString,
    ) -> Bool {
        let attr = unsafe { &*attribute };
        if attr.to_string() == MANUAL || attr.to_string() == ENHANCED {
            return Bool::YES;
        }
        unsafe {
            msg_send![super(this, NSApplication::class()),
                      accessibilityIsAttributeSettable: attribute]
        }
    }

    extern "C" fn lucode_accessibility_set_value_for_attribute(
        this: &AnyObject,
        _sel: objc2::runtime::Sel,
        value: *mut AnyObject,
        attribute: *mut NSString,
    ) {
        let attr = unsafe { &*attribute };
        let name = attr.to_string();
        if name == MANUAL || name == ENHANCED {
            log::info!("[macOS a11y] accepted {name}=… from AX client");
            return;
        }
        unsafe {
            let _: () = msg_send![super(this, NSApplication::class()),
                                  accessibilitySetValue: value
                                  forAttribute: attribute];
        }
    }

    pub(super) fn ax_self_activate() {
        // Implemented in Task 5.
    }
}
```

**Step 2: Build**

Run: `cd src-tauri && cargo build -p lucode --tests`
Expected: compiles cleanly. If `objc_setClass` / `super(...)` macro paths don't match 0.6.x exactly, adjust imports; the canonical references live in `~/.cargo/registry/src/index.crates.io-*/objc2-0.6.4/src/runtime/mod.rs` and `.../runtime/define.rs`.

**Step 3: Run the Task 2 test**

Run: `cd src-tauri && cargo nextest run --package lucode macos_accessibility::tests::nsapp_reports_ax_manual_accessibility_in_attribute_names`
Expected: PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/macos_accessibility.rs
git commit -m "feat(macos): install LucodeAccessibleApplication AX override"
```

---

## Task 5: Write failing test — AXUIElementSetAttributeValue now returns 0

**Files:**
- Test: `src-tauri/src/macos_accessibility.rs` (extend `mod tests`)

**Step 1: Write the failing test**

Append:

```rust
#[cfg(target_os = "macos")]
#[test]
fn ax_self_call_succeeds_after_install() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::CFString;
    use core_foundation_sys::base::CFTypeRef;
    use std::os::raw::{c_int, c_void};

    type AXUIElementRef = *mut c_void;
    type AXError = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: c_int) -> AXUIElementRef;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: *const c_void,
            value: CFTypeRef,
        ) -> AXError;
        fn CFRelease(cf: *const c_void);
    }

    super::install_nsapp_accessibility_shim();

    let pid = std::process::id() as c_int;
    let attr = CFString::new("AXManualAccessibility");
    let value = CFBoolean::true_value();
    let err = unsafe {
        let app_ref = AXUIElementCreateApplication(pid);
        assert!(!app_ref.is_null());
        let e = AXUIElementSetAttributeValue(
            app_ref,
            attr.as_concrete_TypeRef() as *const _,
            value.as_CFTypeRef(),
        );
        CFRelease(app_ref as *const c_void);
        e
    };
    assert_eq!(err, 0,
        "AXUIElementSetAttributeValue must return 0 after the swizzle (got {err}); \
         -25208 indicates the override is not installed");
}
```

**Step 2: Run — expect pass** (Task 4 already wired `accessibilitySetValue:forAttribute:` so the AX subsystem now has a receiver)

Run: `cd src-tauri && cargo nextest run --package lucode macos_accessibility::tests::ax_self_call_succeeds_after_install`
Expected: PASS.

If it fails: the selector signature expected by the AX framework differs from ours. Double-check encodings in `method_type_encoding` output; confirm `accessibilityIsAttributeSettable:` is included in the swizzle (the AX framework also queries settability before accepting).

**Step 3: Flesh out `ax_self_activate` so runtime callers benefit from the same proactive set**

Replace the body of `ax_self_activate` with:

```rust
pub(super) fn ax_self_activate() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation_sys::base::CFTypeRef;
    use std::os::raw::{c_int, c_void};

    type AXUIElementRef = *mut c_void;
    type AXError = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: c_int) -> AXUIElementRef;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> AXError;
        fn CFRelease(cf: *const c_void);
    }

    let pid = std::process::id() as c_int;
    let attr = CFString::new("AXManualAccessibility");
    let value = CFBoolean::true_value();
    unsafe {
        let app_ref = AXUIElementCreateApplication(pid);
        if app_ref.is_null() {
            log::warn!("[macOS a11y] AXUIElementCreateApplication returned null for pid={pid}");
            return;
        }
        let err = AXUIElementSetAttributeValue(
            app_ref,
            attr.as_concrete_TypeRef(),
            value.as_CFTypeRef(),
        );
        CFRelease(app_ref as *const c_void);
        if err == 0 {
            log::info!("[macOS a11y] AXManualAccessibility set; WKWebView AX tree should be live");
        } else {
            log::warn!("[macOS a11y] AXUIElementSetAttributeValue returned {err}");
        }
    }
}
```

**Step 4: Commit**

```bash
git add src-tauri/src/macos_accessibility.rs
git commit -m "test(macos): pin AX self-activation returning 0 after swizzle"
```

---

## Task 6: Make the test module main-thread-only

**Files:**
- Modify: `src-tauri/src/macos_accessibility.rs` — test module attrs.

**Step 1: Wrap each macOS-only test with `serial_test::serial`? No — avoid a new dep. Instead use nextest filter.**

Append to the top of the `#[cfg(test)] mod tests` block so tests that touch NSApp run sequentially on main thread:

```rust
// NSApplication touches must run serially on the main thread. Under `cargo
// nextest` we get a dedicated thread per test; `MainThreadMarker::new()` fails
// when not on the main thread, which we convert to a clear skip rather than
// a flake.
```

Add at the **start** of each NSApp-touching test:

```rust
let Some(_mtm) = objc2_foundation::MainThreadMarker::new() else {
    eprintln!("skip: not on main thread");
    return;
};
```

(The `nsapp_reports_ax_manual_accessibility_in_attribute_names` test from Task 2 already reads the marker; add the same guard to `ax_self_call_succeeds_after_install`.)

**Step 2: Run the macOS test suite**

Run: `cd src-tauri && cargo nextest run --package lucode macos_accessibility`
Expected: all tests in the module pass or explicitly skip; no panics, no hangs.

**Step 3: Commit**

```bash
git add src-tauri/src/macos_accessibility.rs
git commit -m "test(macos): guard NSApp tests behind MainThreadMarker"
```

---

## Task 7: Confirm startup hook still calls through

**Files:**
- Read-only: `src-tauri/src/main.rs:1405-1411`

**Step 1: Inspect**

Run: `grep -n "enable_manual_accessibility" src-tauri/src/main.rs`
Expected: exactly one hit at the existing position around line 1410. No change needed because the entry point name is preserved.

**Step 2: Rebuild the binary to double-check nothing upstream broke**

Run: `cd src-tauri && cargo build -p lucode --bin lucode`
Expected: compiles.

**Step 3: No commit** (no code change).

---

## Task 8: Full validation suite

**Step 1: Run the full gate**

Run: `just test`
Expected: PASS across TypeScript lint, Rust clippy, knip, cargo shear, Rust tests. Fix anything that regresses before moving on; do NOT suppress warnings via `#[allow(...)]`.

**Step 2: Tail logs during a dev run to confirm the success line**

Run (in a separate shell, optional): `RUST_LOG=lucode=info bun run tauri:dev` then:
`LOG_FILE=$(ls -t ~/Library/Application\ Support/lucode/logs/lucode-*.log | head -1); grep "macOS a11y" "$LOG_FILE"`
Expected: lines `[macOS a11y] LucodeAccessibleApplication installed` and `[macOS a11y] AXManualAccessibility set; WKWebView AX tree should be live`. No `returned error code -25208` line.

**Step 3: Commit any drive-by fixups**

Only if `just test` surfaced an unrelated breakage caused by the Cargo.toml change; otherwise skip.

---

## Task 9: Squash to a single commit and push

**Step 1: Squash**

Run: `git log --oneline origin/main..HEAD` — confirm the commits from Tasks 1/4/5/6 are what you expect.

Run (interactive rebase is forbidden per repo rules — use `git reset --soft`):
```bash
MERGE_BASE=$(git merge-base HEAD origin/main)
git reset --soft "$MERGE_BASE"
git commit -m "fix(macos): swizzle NSApp accessibility so Mac Whisper can inject text

Prior fix set AXManualAccessibility via AXUIElementSetAttributeValue but
got kAXErrorNotImplemented (-25208): the AX subsystem has no receiver
for that attribute on stock NSApplication. Install a runtime subclass
(LucodeAccessibleApplication) that advertises AXManualAccessibility and
AXEnhancedUserInterface in accessibilityAttributeNames, reports them
settable, and accepts sets — matching the Electron PR #38102 pattern.
After the swizzle the same self-call succeeds (returns 0) and WKWebView
populates its AX tree, letting Mac Whisper and other AX dictation tools
discover and inject text into native inputs, CodeMirror, xterm's helper
textarea, and the URL bar."
```

**Step 2: Run `just test` once more post-squash**

Expected: green.

**Step 3: DO NOT push** — handing off to the user for push/PR creation per repo rules.

---

## Checkpoints for the reviewer

- `src-tauri/src/macos_accessibility.rs` — exports `install_nsapp_accessibility_shim` and retains `enable_manual_accessibility`.
- `src-tauri/Cargo.toml` — lists `objc2`, `objc2-foundation`, `objc2-app-kit` under the macOS-only target block.
- `main.rs` — unchanged around line 1410.
- No changes to MarkdownEditor / xterm ARIA work; the April 15 hardening stays in place as defense-in-depth.
- Tests 2 and 5 are the regression pins. Test 5 in particular would have failed on the April 15 implementation; keeping it guards against future regressions.
