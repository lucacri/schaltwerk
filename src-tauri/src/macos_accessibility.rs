// macOS accessibility activation for third-party AX clients (e.g., Mac Whisper).
//
// Stock tao NSApplication does not advertise the Chromium/Electron-convention
// attributes (`AXManualAccessibility`, `AXEnhancedUserInterface`) that external
// assistive tech sets to force a WebView's accessibility tree to activate. Without
// a running NSApp that advertises and accepts them, the AX subsystem returns
// `kAXErrorNotImplemented` (-25208) and WKWebView never exposes its AX tree.
//
// We install the three-method activation contract by *method injection* onto
// NSApp's live class (`TaoApp` once tao has bound it). Isa-swizzling would
// sidestep tao's own `sendEvent:` override — instead, we add our AX methods to
// TaoApp directly using the Objective-C runtime. A compile-time
// `LucodeAccessibleApplication : NSApplication` subclass, created with
// `define_class!`, is only used to produce the correctly typed IMP/type-encoding
// pair for injection; the subclass is never instantiated or swapped in.
//
// `enable_manual_accessibility()` must run on the main thread *after* tao has
// called `[TaoApp sharedApplication]`, so it is wired into the Tauri `.setup()`
// hook rather than at early startup.
//
// See `plans/2026-04-16-mac-whisper-nsapp-swizzle-design.md` for the full root
// cause analysis, alternatives, and risk notes.

#[cfg(target_os = "macos")]
pub fn enable_manual_accessibility() {
    imp::install_on_main_thread();
    imp::ax_self_activate();
}

#[cfg(target_os = "macos")]
pub fn prime_webview_accessibility<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    imp::prime_webview(webview);
}

#[cfg(not(target_os = "macos"))]
pub fn enable_manual_accessibility() {}

#[cfg(not(target_os = "macos"))]
pub fn prime_webview_accessibility<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};

    use objc2::ffi;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject};
    use objc2::{ClassType, define_class, msg_send, sel};
    use objc2_app_kit::{NSApplication, NSObjectNSAccessibility};
    use objc2_foundation::{MainThreadMarker, NSArray, NSString};
    use objc2_web_kit::WKWebView;

    pub(super) const MANUAL: &str = "AXManualAccessibility";
    pub(super) const ENHANCED: &str = "AXEnhancedUserInterface";

    static INJECTED: AtomicBool = AtomicBool::new(false);

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum WebViewAccessibilityPrimeResult {
        SkippedNullHandle,
        QueriedFocusedElement { had_focused_element: bool },
    }

    pub(super) fn is_ax_activation_attribute(name: &str) -> bool {
        name == MANUAL || name == ENHANCED
    }

    pub(super) fn merged_attribute_names(existing: Vec<String>) -> Vec<String> {
        let mut out = existing;
        for attr in [MANUAL, ENHANCED] {
            if !out.iter().any(|s| s == attr) {
                out.push(attr.to_string());
            }
        }
        out
    }

    define_class!(
        // SAFETY: We never instantiate or swap NSApp's class to this subclass —
        // it exists only as a well-typed source for the method IMPs and their
        // type encodings. Cocoa invariants for NSApplication are therefore
        // untouched.
        #[unsafe(super(NSApplication))]
        #[thread_kind = objc2::MainThreadOnly]
        #[name = "LucodeAccessibleApplication"]
        struct LucodeAccessibleApplication;

        impl LucodeAccessibleApplication {
            #[unsafe(method_id(accessibilityAttributeNames))]
            fn lucode_accessibility_attribute_names(&self) -> Retained<NSArray<NSString>> {
                let base: Retained<NSArray<NSString>> = unsafe {
                    msg_send![super(self), accessibilityAttributeNames]
                };
                let existing: Vec<String> = base.iter().map(|s| s.to_string()).collect();
                let merged = merged_attribute_names(existing);
                let nsstrings: Vec<Retained<NSString>> =
                    merged.iter().map(|s| NSString::from_str(s)).collect();
                let refs: Vec<&NSString> = nsstrings.iter().map(|s| s.as_ref()).collect();
                NSArray::from_slice(&refs)
            }

            #[unsafe(method(accessibilityIsAttributeSettable:))]
            fn lucode_accessibility_is_attribute_settable(
                &self,
                attribute: *const NSString,
            ) -> Bool {
                if let Some(name) = nsstring_to_str(attribute)
                    && is_ax_activation_attribute(&name)
                {
                    return Bool::YES;
                }
                unsafe {
                    msg_send![
                        super(self),
                        accessibilityIsAttributeSettable: attribute
                    ]
                }
            }

            #[unsafe(method(accessibilitySetValue:forAttribute:))]
            fn lucode_accessibility_set_value_for_attribute(
                &self,
                value: *mut AnyObject,
                attribute: *const NSString,
            ) {
                if let Some(name) = nsstring_to_str(attribute)
                    && is_ax_activation_attribute(&name)
                {
                    log::info!("[macOS a11y] accepted {name} set from AX client");
                    return;
                }
                unsafe {
                    let _: () = msg_send![
                        super(self),
                        accessibilitySetValue: value,
                        forAttribute: attribute,
                    ];
                }
            }
        }
    );

    fn nsstring_to_str(ptr: *const NSString) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let attr = unsafe { &*ptr };
        Some(attr.to_string())
    }

    pub(super) fn install_on_main_thread() {
        // Registration of the Obj-C class is thread-safe and serves as our IMP
        // source; doing it unconditionally lets tests assert the class exists
        // without needing to be on the macOS main thread.
        ensure_method_source_registered();

        if INJECTED.load(Ordering::Acquire) {
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            log::warn!(
                "[macOS a11y] install_on_main_thread skipped: not on main thread; \
                 call from Tauri .setup() hook"
            );
            return;
        };
        if INJECTED
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        if let Err(err) = inject_methods(mtm) {
            INJECTED.store(false, Ordering::Release);
            log::warn!("[macOS a11y] method injection failed: {err}");
        }
    }

    fn ensure_method_source_registered() {
        // Forces the Obj-C runtime to register `LucodeAccessibleApplication`
        // (first `::class()` call triggers class-pair registration). Thread-safe.
        let _ = LucodeAccessibleApplication::class();
    }

    fn inject_methods(mtm: MainThreadMarker) -> Result<(), String> {
        let src_cls = LucodeAccessibleApplication::class();
        let app = NSApplication::sharedApplication(mtm);
        let app_obj: &NSObject = app.as_super();
        let any: &AnyObject = app_obj.as_ref();
        let target_cls: &AnyClass = any.class();
        let target_cls_name = target_cls.name().to_string_lossy();

        if std::ptr::eq(target_cls, NSApplication::class()) {
            return Err(format!(
                "NSApp class is still `{target_cls_name}` — tao has not installed its \
                 subclass yet; refusing to inject into the framework-level class. \
                 Call enable_manual_accessibility() from the Tauri .setup() hook."
            ));
        }

        let selectors = [
            sel!(accessibilityAttributeNames),
            sel!(accessibilityIsAttributeSettable:),
            sel!(accessibilitySetValue:forAttribute:),
        ];

        for sel in selectors {
            let method = src_cls
                .instance_method(sel)
                .ok_or_else(|| format!("LucodeAccessibleApplication missing IMP for `{sel}`"))?;
            let imp = method.implementation();
            let types = unsafe { ffi::method_getTypeEncoding(std::ptr::from_ref(method).cast()) };
            if types.is_null() {
                return Err(format!("method `{sel}` has null type encoding"));
            }

            let added = unsafe {
                ffi::class_addMethod(
                    target_cls as *const AnyClass as *mut AnyClass,
                    sel,
                    imp,
                    types,
                )
            };
            if !added.as_bool() {
                unsafe {
                    ffi::class_replaceMethod(
                        target_cls as *const AnyClass as *mut AnyClass,
                        sel,
                        imp,
                        types,
                    );
                }
                log::info!("[macOS a11y] replaced existing `{sel}` on {target_cls_name}");
            } else {
                log::info!("[macOS a11y] injected `{sel}` onto {target_cls_name}");
            }
        }
        Ok(())
    }

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
        let value = CFBoolean::true_value();
        unsafe {
            let app_ref = AXUIElementCreateApplication(pid);
            if app_ref.is_null() {
                log::warn!("[macOS a11y] AXUIElementCreateApplication returned null for pid={pid}");
                return;
            }
            activate_attributes_with(|attribute| {
                let attr = CFString::new(attribute);
                AXUIElementSetAttributeValue(
                    app_ref,
                    attr.as_concrete_TypeRef(),
                    value.as_CFTypeRef(),
                )
            });
            CFRelease(app_ref as *const c_void);
        }
    }

    pub(super) fn activate_attributes_with<F>(mut set_attribute: F)
    where
        F: FnMut(&str) -> i32,
    {
        for attribute in [MANUAL, ENHANCED] {
            let err = set_attribute(attribute);
            if err == 0 {
                log::info!("[macOS a11y] set {attribute}; WKWebView AX activation advanced");
            } else {
                log::warn!(
                    "[macOS a11y] AXUIElementSetAttributeValue returned {err} for {attribute}"
                );
            }
        }
    }

    pub(super) fn prime_webview<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
        let label = webview.label().to_string();
        let label_for_log = label.clone();
        if let Err(err) = webview.with_webview(move |native_webview| {
            match prime_webview_accessibility(native_webview.inner()) {
                WebViewAccessibilityPrimeResult::SkippedNullHandle => {
                    log::warn!(
                        "[macOS a11y] skipped WKWebView accessibility warm-up for {label_for_log}: null handle"
                    );
                }
                WebViewAccessibilityPrimeResult::QueriedFocusedElement {
                    had_focused_element,
                } => {
                    log::info!(
                        "[macOS a11y] queried WKWebView accessibilityFocusedUIElement \
                         to initialize WebKit AX for {label_for_log} \
                         (had_focused_element={had_focused_element})"
                    );
                }
            }
        }) {
            log::warn!("[macOS a11y] failed to prime WKWebView accessibility for {label}: {err}");
        }
    }

    pub(super) fn prime_webview_accessibility(
        webview_handle: *mut c_void,
    ) -> WebViewAccessibilityPrimeResult {
        if webview_handle.is_null() {
            return WebViewAccessibilityPrimeResult::SkippedNullHandle;
        }

        let webview: &WKWebView = unsafe { &*webview_handle.cast::<WKWebView>() };
        let had_focused_element = webview.accessibilityFocusedUIElement().is_some();
        WebViewAccessibilityPrimeResult::QueriedFocusedElement {
            had_focused_element,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enable_manual_accessibility_does_not_panic() {
        enable_manual_accessibility();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn activation_attribute_names_match_electron_convention() {
        assert_eq!(imp::MANUAL, "AXManualAccessibility");
        assert_eq!(imp::ENHANCED, "AXEnhancedUserInterface");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn is_ax_activation_attribute_requires_exact_match() {
        assert!(imp::is_ax_activation_attribute("AXManualAccessibility"));
        assert!(imp::is_ax_activation_attribute("AXEnhancedUserInterface"));
        assert!(!imp::is_ax_activation_attribute("axmanualaccessibility"));
        assert!(!imp::is_ax_activation_attribute(
            "AXManualAccessibilityExtra"
        ));
        assert!(!imp::is_ax_activation_attribute("AXRole"));
        assert!(!imp::is_ax_activation_attribute(""));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn merged_attribute_names_appends_both_ax_activation_attributes() {
        let merged = imp::merged_attribute_names(vec!["AXRole".to_string()]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0], "AXRole");
        assert!(merged.contains(&"AXManualAccessibility".to_string()));
        assert!(merged.contains(&"AXEnhancedUserInterface".to_string()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn merged_attribute_names_does_not_duplicate_existing_entries() {
        let merged = imp::merged_attribute_names(vec![
            "AXRole".to_string(),
            "AXManualAccessibility".to_string(),
        ]);
        let manual_count = merged
            .iter()
            .filter(|s| *s == "AXManualAccessibility")
            .count();
        assert_eq!(manual_count, 1);
        assert!(merged.contains(&"AXEnhancedUserInterface".to_string()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn merged_attribute_names_preserves_base_order() {
        let merged =
            imp::merged_attribute_names(vec!["AXRole".to_string(), "AXSubrole".to_string()]);
        assert_eq!(merged[0], "AXRole");
        assert_eq!(merged[1], "AXSubrole");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn method_source_subclass_has_the_three_overrides() {
        use objc2::ClassType;
        use objc2::runtime::AnyClass;
        use objc2::sel;
        use objc2_app_kit::NSApplication;

        enable_manual_accessibility();

        let src_cls = AnyClass::get(c"LucodeAccessibleApplication")
            .expect("LucodeAccessibleApplication must be registered as the IMP source");

        assert_eq!(
            src_cls.superclass().map(|s| s as *const _),
            Some(NSApplication::class() as *const _),
            "LucodeAccessibleApplication must inherit NSApplication for super-dispatch \
             to land on NSApplication's AX implementation"
        );

        let selectors = [
            sel!(accessibilityAttributeNames),
            sel!(accessibilityIsAttributeSettable:),
            sel!(accessibilitySetValue:forAttribute:),
        ];

        for sel in selectors {
            let our_method = src_cls.instance_method(sel);
            assert!(
                our_method.is_some(),
                "LucodeAccessibleApplication missing override for `{sel}`"
            );
            let our_method = our_method.unwrap();

            if let Some(super_method) = NSApplication::class().instance_method(sel) {
                assert_ne!(
                    our_method.implementation() as usize,
                    super_method.implementation() as usize,
                    "LucodeAccessibleApplication must define its own IMP for `{sel}`, \
                     not inherit NSApplication's"
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn self_activation_attempts_manual_then_enhanced() {
        let mut seen = Vec::new();
        imp::activate_attributes_with(|attribute| {
            seen.push(attribute.to_string());
            0
        });

        assert_eq!(
            seen,
            vec![
                "AXManualAccessibility".to_string(),
                "AXEnhancedUserInterface".to_string(),
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn prime_webview_accessibility_skips_null_handle() {
        assert_eq!(
            imp::prime_webview_accessibility(std::ptr::null_mut()),
            imp::WebViewAccessibilityPrimeResult::SkippedNullHandle
        );
    }
}
