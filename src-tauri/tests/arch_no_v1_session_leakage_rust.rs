//! Phase 8 pre-smoke arch pin (Gap 1, Rust half).
//!
//! The frontend pin `arch_no_v1_session_leakage.test.ts` walks `src/`
//! only. Retired Tauri command names and the v1->v2 migration helper
//! could still appear in Rust source (a stale `#[command]` definition,
//! a string literal mapping name->handler, a leftover migration
//! reference) without tripping the frontend test.
//!
//! This Rust pin walks the `src/` tree of the lib crate and fails if
//! any production source file references a retired symbol. Doc
//! comments and line comments are stripped before the scan so that
//! historical / explanatory headers ("// Phase 8 W.3 retired
//! lucode_task_capture_session") do not trip the pin — only LIVE
//! references count.
//!
//! What this catches:
//! - A `#[tauri::command] pub fn lucode_task_capture_session` that was
//!   missed during the W.3 sweep.
//! - A string literal command name in a routing table.
//! - A doc-test or example wiring up the retired migration helper.
//!
//! What this does NOT catch: the symbol appearing inside another arch
//! test's allowlist (those test files are excluded from the walk).

use std::fs;
use std::path::{Path, PathBuf};

/// Symbols retired in Phase 8 W.3/W.4. A live reference to any of
/// these from production Rust source means the cleanup left a dangling
/// surface.
const RETIRED_RUST_SYMBOLS: &[(&str, &str)] = &[
    ("lucode_task_capture_session", "Tauri command retired in W.3"),
    (
        "lucode_task_capture_version_group",
        "Tauri command retired in W.3",
    ),
    (
        "v1_to_v2_specs_to_tasks",
        "v1->v2 migration helper retired in W.4",
    ),
];

#[test]
fn no_production_rust_references_retired_v1_symbols() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let src_root = manifest_dir.join("src");

    let mut hits: Vec<String> = Vec::new();
    walk_rust_files(&src_root, &mut |path, body| {
        let rel = path
            .strip_prefix(manifest_dir)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        for (lineno, raw_line) in body.lines().enumerate() {
            let stripped = strip_rust_comment(raw_line);
            if stripped.trim().is_empty() {
                continue;
            }
            for (symbol, rationale) in RETIRED_RUST_SYMBOLS {
                if stripped.contains(symbol) {
                    hits.push(format!(
                        "  {rel}:{}  [{symbol}] {rationale}\n      => {}",
                        lineno + 1,
                        raw_line.trim_start(),
                    ));
                }
            }
        }
    });

    assert!(
        hits.is_empty(),
        "Phase 8 retired-symbol leak detected in production Rust source.\n\n\
         Each line below references a symbol that was deleted with the v1\n\
         session shape. If a test legitimately needs the name to pin its\n\
         absence, move that test out of `src/` (this walker only scans\n\
         the lib crate's `src/` tree).\n\n{}",
        hits.join("\n"),
    );
}

/// Strip line comments and trim doc-comment markers so the scan only
/// inspects executable text. Block comments are conservatively
/// stripped at line granularity (any line whose first non-whitespace
/// token is `*` is treated as a continuation comment line).
fn strip_rust_comment(line: &str) -> String {
    let mut working = line.to_string();
    if let Some(idx) = working.find("//") {
        working.truncate(idx);
    }
    if let Some(start) = working.find("/*") {
        if let Some(end) = working[start..].find("*/") {
            working.replace_range(start..start + end + 2, "");
        } else {
            working.truncate(start);
        }
    }
    let trimmed_check = working.trim_start();
    if trimmed_check.starts_with('*') && !trimmed_check.starts_with("*/") {
        return String::new();
    }
    working
}

fn walk_rust_files(dir: &Path, on_file: &mut impl FnMut(&PathBuf, &str)) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_rust_files(&path, on_file);
        } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            if let Ok(body) = fs::read_to_string(&path) {
                on_file(&path, &body);
            }
        }
    }
}

#[test]
fn comment_stripper_removes_line_and_block_comments() {
    assert_eq!(strip_rust_comment("// this is a comment"), "");
    assert_eq!(
        strip_rust_comment("let x = 1; // tail comment"),
        "let x = 1; "
    );
    assert_eq!(
        strip_rust_comment("/* block */ let y = 2;"),
        " let y = 2;"
    );
    // doc-comment continuation line.
    assert_eq!(strip_rust_comment(" * see Phase 8 W.3 notes"), "");
    assert_eq!(strip_rust_comment("///! header comment"), "");
}

#[test]
fn detector_catches_each_retired_symbol_when_referenced_in_code() {
    // Sanity: each retired symbol triggers when present in code.
    for (symbol, _why) in RETIRED_RUST_SYMBOLS {
        let line = format!("pub fn handler() -> &'static str {{ \"{symbol}\" }}");
        let stripped = strip_rust_comment(&line);
        assert!(
            stripped.contains(symbol),
            "stripper should NOT remove production code: {line}",
        );
    }
}

#[test]
fn detector_ignores_retired_symbol_inside_a_comment() {
    for (symbol, _why) in RETIRED_RUST_SYMBOLS {
        let line = format!("// Phase 8 W.3 retired {symbol}");
        let stripped = strip_rust_comment(&line);
        assert!(
            !stripped.contains(symbol),
            "stripper SHOULD remove comment-only references: {line}",
        );
    }
}
