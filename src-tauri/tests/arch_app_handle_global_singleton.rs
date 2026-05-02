//! Phase 7 Wave A.3.b architecture guard: enforce that the lib crate
//! holds **exactly one** `OnceCell<AppHandle>` (in
//! `src/infrastructure/app_handle_registry.rs`). Any other module that
//! introduces a duplicate global registry would defeat the seam this
//! file pins.
//!
//! The pty.rs registry uses a different shape
//! (`RwLock<Option<AppHandle>>`) and is intentionally distinct — it has
//! a lifecycle-clear semantics that doesn't fit `OnceCell`. The pattern
//! we're guarding is "process-singleton, set-once" specifically.

use std::fs;
use std::path::Path;

const ALLOWED_FILE: &str = "src/infrastructure/app_handle_registry.rs";

#[test]
fn only_app_handle_registry_holds_a_once_cell_app_handle() {
    let root = Path::new("src");
    let mut violations: Vec<(String, String)> = Vec::new();
    walk(root, &mut |path, body| {
        let rel = path.to_string_lossy().to_string();
        if rel == ALLOWED_FILE {
            return;
        }
        for (lineno, line) in body.lines().enumerate() {
            // Trim and collapse whitespace so multi-space variants match.
            let normalized: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
            if contains_once_cell_app_handle(&normalized) {
                violations.push((rel.clone(), format!("{}: {line}", lineno + 1)));
            }
        }
    });

    assert!(
        violations.is_empty(),
        "Phase 7 Wave A.3.b violation: a `OnceCell<AppHandle>` was found outside \
         the allowed module `{ALLOWED_FILE}`. The app handle global must stay \
         a singleton — every additional registry is a new place to forget to \
         install at startup. Move the global to `infrastructure::app_handle_registry` \
         instead.\n\nMatches:\n{}",
        violations
            .iter()
            .map(|(file, line)| format!("  {file} :: {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

fn contains_once_cell_app_handle(line: &str) -> bool {
    // We only want to flag actual *new* registries — not comments, doc
    // mentions, or test fixtures. The signal is `OnceCell<` immediately
    // followed by an `AppHandle` token (with optional `tauri::` /
    // generic params).
    if line.trim_start().starts_with("//") || line.trim_start().starts_with("///") {
        return false;
    }
    if !line.contains("OnceCell<") {
        return false;
    }
    line.contains("OnceCell<AppHandle")
        || line.contains("OnceCell<tauri::AppHandle")
        || line.contains("OnceCell<tauri :: AppHandle")
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
fn pattern_detector_recognizes_actual_violations() {
    // Sanity: the detector must catch the very pattern we're guarding
    // against, otherwise the guard is silently broken.
    assert!(contains_once_cell_app_handle(
        "static X: OnceCell<AppHandle> = OnceCell::new();"
    ));
    assert!(contains_once_cell_app_handle(
        "OnceCell<tauri::AppHandle<Wry>>"
    ));
    // And must NOT flag unrelated `OnceCell<T>` uses.
    assert!(!contains_once_cell_app_handle(
        "static SETTINGS: OnceCell<Arc<Mutex<SettingsManager>>> = OnceCell::new();"
    ));
    // And must not flag a doc-comment mention.
    assert!(!contains_once_cell_app_handle(
        "/// Holds a `OnceCell<AppHandle>` (see app_handle_registry)."
    ));
}
