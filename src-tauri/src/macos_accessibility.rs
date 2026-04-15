// Activate the macOS accessibility tree at startup so that
// accessibility-API-based assistive tools (Mac Whisper, generic AX
// clients) can discover and inject text into HTML inputs hosted by our
// WKWebView. WKWebView builds its AX tree lazily; setting
// `AXManualAccessibility` on our own AXUIElement is the public opt-in.

#[cfg(target_os = "macos")]
pub fn enable_manual_accessibility() {
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
            log::warn!(
                "[macOS a11y] AXUIElementCreateApplication returned null for pid={pid}"
            );
            return;
        }
        let err = AXUIElementSetAttributeValue(
            app_ref,
            attr.as_concrete_TypeRef(),
            value.as_CFTypeRef(),
        );
        CFRelease(app_ref as *const c_void);
        if err == 0 {
            log::info!("[macOS a11y] AXManualAccessibility enabled (WKWebView AX tree active)");
        } else {
            log::warn!("[macOS a11y] AXUIElementSetAttributeValue returned error code {err}");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn enable_manual_accessibility() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enable_manual_accessibility_does_not_panic() {
        enable_manual_accessibility();
    }
}
