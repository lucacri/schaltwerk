//! Phase 7 Wave A.3.b architecture guard: enforce that the lib crate
//! holds **at most the existing two AppHandle globals** — the
//! Phase 7 `infrastructure::app_handle_registry` (`OnceCell<AppHandle>`)
//! and the legacy `infrastructure::pty` (`RwLock<Option<AppHandle>>`).
//! Any other module that introduces a new global registry would defeat
//! the seam this file pins.
//!
//! The original Phase 7 close-out test only caught `OnceCell<AppHandle>`.
//! That's too narrow — a future agent reaching for `Lazy<AppHandle>`,
//! `Mutex<Option<AppHandle>>`, `OnceLock<AppHandle>`, or even a bare
//! `static APP: AppHandle` would silently sprawl the singleton. This
//! tightened version catches the broader pattern: any single-handle
//! global wrapper around `AppHandle` outside the explicit allowlist.

use std::fs;
use std::path::Path;

/// Files allowed to hold an `AppHandle` global static. Adding a new
/// entry here is intentional and reviewable; it should be a one-line
/// PR with the rationale documented in the test message below.
///
/// `pty.rs` holds `RwLock<Option<AppHandle>>` as a STRUCT FIELD on
/// `TauriEventSink`, not as a global static — so it's not on this
/// list. The detector below explicitly ignores struct-field uses.
const ALLOWED_FILES: &[&str] = &[
    "src/infrastructure/app_handle_registry.rs",
];

#[test]
fn no_new_global_app_handle_registries_outside_the_allowlist() {
    let root = Path::new("src");
    let mut violations: Vec<(String, String)> = Vec::new();
    walk(root, &mut |path, body| {
        let rel = path.to_string_lossy().to_string();
        if ALLOWED_FILES.contains(&rel.as_str()) {
            return;
        }
        for (lineno, line) in body.lines().enumerate() {
            let normalized: String =
                line.split_whitespace().collect::<Vec<_>>().join(" ");
            if let Some(reason) = matches_global_app_handle(&normalized) {
                violations.push((rel.clone(), format!("{}: {line} [{reason}]", lineno + 1)));
            }
        }
    });

    assert!(
        violations.is_empty(),
        "Phase 7 Wave A.3.b violation: a new global `AppHandle` registry was \
         found outside the allowed files {:?}. Process-singleton AppHandle \
         lives in `infrastructure::app_handle_registry` (set-once). The \
         pty.rs registry is the only other allowed location (lifecycle-clear \
         semantics that don't fit OnceCell). If you need to read an \
         AppHandle from the lib layer, reuse one of those — don't add a \
         new global. To allow a third location intentionally, edit \
         ALLOWED_FILES with a code-review-time justification.\n\nMatches:\n{}",
        ALLOWED_FILES,
        violations
            .iter()
            .map(|(file, line)| format!("  {file} :: {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// Detect any **process-global static** carrier of `AppHandle`. The
/// threat we guard against is "agent X needs to emit Tauri events from
/// a new corner of the lib, so they add `static FOO: OnceCell<AppHandle>`."
/// Struct fields holding `Arc<Mutex<Option<AppHandle>>>` (terminal
/// manager, pty event sink, etc.) are NOT globals — they're
/// instance-scoped refs and follow a different lifetime contract.
///
/// We catch only `static` and `pub static` declarations whose type
/// involves AppHandle inside one of the singleton containers. Struct
/// fields and function arguments are explicitly ignored.
fn matches_global_app_handle(line: &str) -> Option<&'static str> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") || trimmed.starts_with("///") {
        return None;
    }
    if !line.contains("AppHandle") {
        return None;
    }

    // Only static declarations at module scope are global-scope.
    // Anything else (struct fields, fn args, let bindings) is
    // instance- or call-scoped.
    let is_static = trimmed.starts_with("static ") || trimmed.starts_with("pub static ");
    if !is_static {
        return None;
    }

    // Each singleton-shape match has a diagnostic so a violator sees
    // exactly which pattern we caught.
    if line.contains("OnceCell<") && contains_app_handle_after(line, "OnceCell<") {
        return Some("OnceCell<AppHandle>");
    }
    if line.contains("OnceLock<") && contains_app_handle_after(line, "OnceLock<") {
        return Some("OnceLock<AppHandle>");
    }
    if line.contains("Lazy<") && contains_app_handle_after(line, "Lazy<") {
        return Some("Lazy<AppHandle>");
    }
    // Lock-wrapped Option<AppHandle> at static scope. The pty.rs
    // pattern lives at struct scope (TauriEventSink field) so it does
    // NOT match this guard — only a *global static* would.
    if (line.contains("RwLock<") || line.contains("Mutex<") || line.contains("StdMutex<"))
        && line.contains("Option<")
        && contains_app_handle_after(line, "Option<")
    {
        return Some("static Lock<Option<AppHandle>>");
    }
    // Bare `static FOO: AppHandle` would sidestep all wrapper checks.
    if line.contains(": AppHandle")
        && !line.contains("&AppHandle")
        && !line.contains("Option<AppHandle>")
    {
        return Some("static AppHandle");
    }

    None
}

/// True when `AppHandle` (or a generic-parameterized variant like
/// `AppHandle<Wry>` / `tauri::AppHandle<…>`) appears textually after
/// the given prefix on the same line. Used to distinguish
/// `OnceCell<AppHandle>` (matches) from `OnceCell<SomethingElse>` (no
/// match) without parsing the type tree.
fn contains_app_handle_after(line: &str, prefix: &str) -> bool {
    if let Some(idx) = line.find(prefix) {
        let suffix = &line[idx + prefix.len()..];
        suffix.contains("AppHandle")
    } else {
        false
    }
}

fn walk(dir: &Path, on_file: &mut impl FnMut(&Path, &str)) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, on_file);
        } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            if let Ok(body) = fs::read_to_string(&path) {
                on_file(&path, &body);
            }
        }
    }
}

#[test]
fn detector_catches_each_static_singleton_pattern() {
    // Sanity: every static-scope pattern this guard claims to catch
    // must actually be caught. A regression in any arm would silently
    // let a new global registry through.
    assert_eq!(
        matches_global_app_handle("static X: OnceCell<AppHandle> = OnceCell::new();"),
        Some("OnceCell<AppHandle>"),
    );
    assert_eq!(
        matches_global_app_handle("static X: OnceCell<tauri::AppHandle<Wry>> = OnceCell::new();"),
        Some("OnceCell<AppHandle>"),
    );
    assert_eq!(
        matches_global_app_handle("pub static X: OnceLock<AppHandle> = OnceLock::new();"),
        Some("OnceLock<AppHandle>"),
    );
    assert_eq!(
        matches_global_app_handle("static X: Lazy<AppHandle> = Lazy::new(|| ...);"),
        Some("Lazy<AppHandle>"),
    );
    assert_eq!(
        matches_global_app_handle("static APP: Mutex<Option<AppHandle<Wry>>> = ...;"),
        Some("static Lock<Option<AppHandle>>"),
    );
    assert_eq!(
        matches_global_app_handle("static APP: AppHandle = bare_static();"),
        Some("static AppHandle"),
    );
}

#[test]
fn detector_ignores_struct_fields_and_local_uses() {
    // Critical: struct fields (terminal manager, pty event sink) are
    // instance-scoped refs, not process-global registries. They must
    // NOT trip the detector — that was the false-positive that the
    // first iteration of this test surfaced before scope-narrowing.
    assert_eq!(
        matches_global_app_handle("    app_handle: Arc<RwLock<Option<AppHandle>>>,"),
        None,
    );
    assert_eq!(
        matches_global_app_handle("    pub(super) app_handle: Arc<Mutex<Option<AppHandle>>>,"),
        None,
    );
    assert_eq!(
        matches_global_app_handle("    app_handle: RwLock<Option<AppHandle>>,"),
        None,
    );
    // Function arguments, method receivers, let bindings.
    assert_eq!(
        matches_global_app_handle("pub async fn handler(app: tauri::AppHandle)"),
        None,
    );
    assert_eq!(
        matches_global_app_handle("let handle: &AppHandle = &app;"),
        None,
    );
    // Doc-comment mentions.
    assert_eq!(
        matches_global_app_handle("/// stores `OnceCell<AppHandle>` (see app_handle_registry)"),
        None,
    );
    // Unrelated static OnceCell<T>.
    assert_eq!(
        matches_global_app_handle(
            "static SETTINGS: OnceCell<Arc<Mutex<SettingsManager>>> = OnceCell::new();"
        ),
        None,
    );
}
