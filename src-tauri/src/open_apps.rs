use crate::schaltwerk_core::db_app_config::AppConfigMethods;
use std::path::{Path, PathBuf};

const APP_KIND_SYSTEM: &str = "system";
const APP_KIND_TERMINAL: &str = "terminal";
const APP_KIND_EDITOR: &str = "editor";

fn platform_default_open_app_id() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "finder"
    }

    #[cfg(target_os = "linux")]
    {
        "nautilus"
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        "explorer"
    }
}

fn normalize_open_app_id(id: &str) -> Option<String> {
    let normalized = match id {
        "code" => "vscode",
        "idea" => "intellij",
        "iterm" => "iterm2",
        value => value,
    };

    supported_open_app_catalog()
        .into_iter()
        .find(|app| app.id == normalized)
        .map(|app| app.id)
}

fn default_enabled_open_app_ids() -> Vec<String> {
    let detected_ids = detect_available_apps()
        .into_iter()
        .map(|app| app.id)
        .collect::<std::collections::HashSet<_>>();

    let supported = supported_open_app_catalog();
    let detected_supported = supported
        .iter()
        .filter(|app| detected_ids.contains(&app.id))
        .map(|app| app.id.clone())
        .collect::<Vec<_>>();

    if detected_supported.is_empty() {
        return vec![platform_default_open_app_id().to_string()];
    }

    detected_supported
}

fn normalize_enabled_open_app_ids<I>(raw_ids: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let normalized_ids = raw_ids
        .into_iter()
        .filter_map(|id| normalize_open_app_id(&id))
        .collect::<std::collections::HashSet<_>>();
    let mut seen = std::collections::HashSet::new();
    let normalized = supported_open_app_catalog()
        .into_iter()
        .filter(|app| normalized_ids.contains(&app.id))
        .filter_map(|app| {
            if seen.insert(app.id.clone()) {
                Some(app.id)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        return default_enabled_open_app_ids();
    }

    normalized
}

fn resolve_default_open_app_id(stored_default: &str, enabled_ids: &[String]) -> String {
    if let Some(normalized_default) = normalize_open_app_id(stored_default)
        && enabled_ids
            .iter()
            .any(|enabled| enabled == &normalized_default)
    {
        return normalized_default;
    }

    enabled_ids
        .first()
        .cloned()
        .unwrap_or_else(|| platform_default_open_app_id().to_string())
}

fn normalize_editor_override_id(id: &str) -> String {
    normalize_open_app_id(id).unwrap_or_else(|| id.to_string())
}

fn normalize_editor_overrides(
    overrides: &std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String> {
    overrides
        .iter()
        .map(|(ext, app_id)| (ext.clone(), normalize_editor_override_id(app_id)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_legacy_open_app_ids_normalize_to_canonical_ids() {
        assert_eq!(normalize_open_app_id("code"), Some("vscode".to_string()));
        assert_eq!(normalize_open_app_id("vscode"), Some("vscode".to_string()));
        assert_eq!(normalize_open_app_id("idea"), Some("intellij".to_string()));
        assert_eq!(
            normalize_open_app_id("intellij"),
            Some("intellij".to_string())
        );
        assert_eq!(normalize_open_app_id("unknown-app"), None);
    }

    #[test]
    fn test_invalid_enabled_ids_recover_to_platform_defaults() {
        assert_eq!(
            normalize_enabled_open_app_ids(["unknown-app".to_string()]),
            default_enabled_open_app_ids()
        );
    }

    #[test]
    fn test_default_open_app_falls_back_to_first_enabled_app() {
        let enabled = vec!["finder".to_string(), "vscode".to_string()];
        assert_eq!(
            resolve_default_open_app_id("ghostty", &enabled),
            "finder".to_string()
        );
    }

    #[test]
    fn test_set_enabled_open_apps_reassigns_default_when_current_default_is_disabled() {
        let db = crate::schaltwerk_core::Database::new_in_memory().unwrap();
        set_default_open_app_in_db(&db, "vscode").expect("seed default");
        set_enabled_open_apps_in_db(&db, &["finder".to_string()]).expect("set enabled apps");

        assert_eq!(
            get_default_open_app_from_db(&db).expect("read resolved default"),
            "finder".to_string()
        );
    }

    #[test]
    fn test_setting_default_auto_enables_selected_app() {
        let db = crate::schaltwerk_core::Database::new_in_memory().unwrap();
        set_enabled_open_apps_in_db(&db, &["finder".to_string()]).expect("seed enabled apps");

        set_default_open_app_in_db(&db, "vscode").expect("set default");

        assert_eq!(
            get_default_open_app_from_db(&db).expect("read default"),
            "vscode".to_string()
        );
        assert_eq!(
            get_enabled_open_apps_from_db(&db).expect("read enabled apps"),
            vec!["finder".to_string(), "vscode".to_string()]
        );
    }

    #[test]
    fn test_editor_override_ids_normalize_to_canonical_ids() {
        let mut overrides = std::collections::HashMap::new();
        overrides.insert(".ts".to_string(), "code".to_string());
        overrides.insert(".java".to_string(), "idea".to_string());

        let normalized = normalize_editor_overrides(&overrides);
        assert_eq!(normalized.get(".ts"), Some(&"vscode".to_string()));
        assert_eq!(normalized.get(".java"), Some(&"intellij".to_string()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_macos_catalog_includes_required_builtin_entries() {
        let ids = supported_open_app_catalog()
            .into_iter()
            .map(|app| app.id)
            .collect::<Vec<_>>();

        assert!(ids.contains(&"finder".to_string()));
        assert!(ids.contains(&"iterm2".to_string()));
        assert!(ids.contains(&"vscode".to_string()));
        assert!(ids.contains(&"phpstorm".to_string()));
    }

    #[test]
    fn test_app_kinds_are_valid() {
        let apps = detect_available_apps();
        for app in apps {
            assert!(
                app.kind == "system" || app.kind == "terminal" || app.kind == "editor",
                "Invalid app kind: {}",
                app.kind
            );
        }
    }

    #[test]
    fn test_platform_specific_defaults() {
        let db = crate::schaltwerk_core::Database::new_in_memory().unwrap();
        let default = get_default_open_app_from_db(&db).unwrap();

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");

        #[cfg(target_os = "windows")]
        assert_eq!(default, "explorer");
    }

    #[test]
    fn test_default_open_app_roundtrip_in_db() {
        let db = crate::schaltwerk_core::Database::new_in_memory()
            .expect("failed to create in-memory db");

        let default = get_default_open_app_from_db(&db).expect("failed to read default open app");

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");

        #[cfg(target_os = "windows")]
        assert_eq!(default, "explorer");

        set_default_open_app_in_db(&db, "vscode").expect("failed to persist default open app");

        let updated =
            get_default_open_app_from_db(&db).expect("failed to read updated default open app");
        assert_eq!(updated, "vscode");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_resolve_request_sets_terminal_parent_for_files() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(10), None)
            .expect("resolve should succeed");
        assert_eq!(req.terminal_workdir, PathBuf::from("/repo/root/src"));
        let target = req.target.expect("target should exist");
        assert!(target.is_file);
        assert_eq!(
            target.absolute_path,
            PathBuf::from("/repo/root/src/main.rs")
        );
        assert_eq!(target.line, Some(10));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_vscode_with_goto() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(12), Some(3))
            .expect("resolve should succeed");
        let spec = build_command_macos("code", &req).expect("build should succeed");
        assert_eq!(spec.program, "code");
        assert_eq!(spec.working_dir, Some(PathBuf::from("/repo/root")));
        assert!(spec.args.contains(&"--reuse-window".into()));
        assert!(
            !spec.args.contains(&"--folder-uri".into()),
            "should not include --folder-uri when opening a specific file"
        );
        assert!(spec.args.contains(&"--goto".into()));
        assert!(
            spec.args
                .iter()
                .any(|arg| arg.ends_with("src/main.rs:12:3"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_intellij_root_only() {
        let req = resolve_request("/repo/root", None, None, None).expect("resolve should succeed");
        let spec = build_command_macos("idea", &req).expect("build should succeed");
        assert_eq!(spec.program, "idea");
        assert_eq!(spec.args, vec!["/repo/root"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_zed_with_root_and_file() {
        let req = resolve_request("/repo/root", Some("src/lib.rs"), Some(5), None)
            .expect("resolve should succeed");
        let spec = build_command_macos("zed", &req).expect("build should succeed");
        assert_eq!(spec.program, "zed");
        assert_eq!(
            spec.args,
            vec![
                "/repo/root".to_string(),
                "/repo/root/src/lib.rs:5".to_string()
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_finder_with_file_target_opens_file_path() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(7), None)
            .expect("resolve should succeed");
        let spec = build_command_macos("finder", &req).expect("build should succeed");
        assert_eq!(spec.program, "/usr/bin/open");
        assert_eq!(spec.args, vec!["/repo/root/src/main.rs".to_string()]);
        assert_eq!(spec.working_dir, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_system_open_with_file_target() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(7), None)
            .expect("resolve should succeed");
        let spec = build_command_macos("system-open", &req).expect("build should succeed");
        assert_eq!(spec.program, "/usr/bin/open");
        assert_eq!(spec.args, vec!["/repo/root/src/main.rs".to_string()]);
        assert_eq!(spec.working_dir, None);
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenAppCatalogEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_detected: bool,
    pub is_enabled: bool,
    pub is_default: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTarget {
    pub absolute_path: PathBuf,
    pub is_file: bool,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRequest {
    pub worktree_root: PathBuf,
    pub target: Option<ResolvedTarget>,
    pub terminal_workdir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
}

struct ResolvedOpenAppState {
    catalog: Vec<OpenApp>,
    detected_ids: std::collections::HashSet<String>,
    enabled_ids: Vec<String>,
    default_id: String,
}

fn supported_open_app_catalog() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    #[cfg(target_os = "macos")]
    {
        apps.extend([
            OpenApp {
                id: "finder".into(),
                name: "Finder".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "iterm2".into(),
                name: "iTerm2".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "ghostty".into(),
                name: "Ghostty".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "warp".into(),
                name: "Warp".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "terminal".into(),
                name: "Terminal".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
        ]);
    }

    #[cfg(target_os = "linux")]
    {
        apps.extend([
            OpenApp {
                id: "nautilus".into(),
                name: "Nautilus".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "dolphin".into(),
                name: "Dolphin".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "nemo".into(),
                name: "Nemo".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "pcmanfm".into(),
                name: "PCManFM".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "thunar".into(),
                name: "Thunar".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "alacritty".into(),
                name: "Alacritty".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "ghostty".into(),
                name: "Ghostty".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "gnome-terminal".into(),
                name: "GNOME Terminal".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "kgx".into(),
                name: "Console".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "kitty".into(),
                name: "Kitty".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "konsole".into(),
                name: "Konsole".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "ptyxis".into(),
                name: "Ptyxis".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "tilix".into(),
                name: "Tilix".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "tmux".into(),
                name: "Tmux".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "warp".into(),
                name: "Warp".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "wezterm".into(),
                name: "WezTerm".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "xfce4-terminal".into(),
                name: "Xfce Terminal".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "zellij".into(),
                name: "Zellij".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
        ]);
    }

    #[cfg(target_os = "windows")]
    {
        apps.extend([
            OpenApp {
                id: "explorer".into(),
                name: "Explorer".into(),
                kind: APP_KIND_SYSTEM.into(),
            },
            OpenApp {
                id: "wt".into(),
                name: "Windows Terminal".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "pwsh".into(),
                name: "PowerShell".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "powershell".into(),
                name: "Windows PowerShell".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
            OpenApp {
                id: "cmd".into(),
                name: "Command Prompt".into(),
                kind: APP_KIND_TERMINAL.into(),
            },
        ]);
    }

    apps.extend([
        OpenApp {
            id: "cursor".into(),
            name: "Cursor".into(),
            kind: APP_KIND_EDITOR.into(),
        },
        OpenApp {
            id: "vscode".into(),
            name: "VS Code".into(),
            kind: APP_KIND_EDITOR.into(),
        },
        OpenApp {
            id: "intellij".into(),
            name: "IntelliJ IDEA".into(),
            kind: APP_KIND_EDITOR.into(),
        },
        OpenApp {
            id: "phpstorm".into(),
            name: "PhpStorm".into(),
            kind: APP_KIND_EDITOR.into(),
        },
        OpenApp {
            id: "zed".into(),
            name: "Zed".into(),
            kind: APP_KIND_EDITOR.into(),
        },
    ]);

    apps
}

fn detect_available_apps() -> Vec<OpenApp> {
    let detected_ids = detect_available_app_ids();
    supported_open_app_catalog()
        .into_iter()
        .filter(|app| detected_ids.contains(&app.id))
        .collect()
}

fn detect_available_app_ids() -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();

    #[cfg(target_os = "macos")]
    {
        ids.insert("finder".into());
        ids.extend(detect_macos_terminal_ids());
    }

    #[cfg(target_os = "linux")]
    {
        ids.extend(detect_linux_file_manager_ids());
        ids.extend(detect_linux_terminal_ids());
    }

    #[cfg(target_os = "windows")]
    {
        ids.insert("explorer".into());
        ids.extend(detect_windows_terminal_ids());
    }

    ids.extend(detect_editor_ids());

    ids
}

#[cfg(target_os = "linux")]
fn detect_linux_file_manager_ids() -> Vec<String> {
    let candidates = ["dolphin", "nautilus", "nemo", "pcmanfm", "thunar"];

    candidates
        .iter()
        .filter(|id| which::which(id).is_ok())
        .map(|id| (*id).to_string())
        .collect()
}

#[cfg(target_os = "linux")]
fn detect_linux_terminal_ids() -> Vec<String> {
    let candidates = [
        "alacritty",
        "ghostty",
        "gnome-terminal",
        "kgx",
        "kitty",
        "konsole",
        "ptyxis",
        "tilix",
        "tmux",
        "warp",
        "wezterm",
        "xfce4-terminal",
        "zellij",
    ];

    candidates
        .iter()
        .filter(|id| which::which(id).is_ok())
        .map(|id| (*id).to_string())
        .collect()
}

#[cfg(target_os = "macos")]
fn detect_macos_terminal_ids() -> Vec<String> {
    let candidates = [
        (
            "ghostty",
            which::which("ghostty").is_ok() || macos_bundle_exists("Ghostty.app"),
        ),
        ("iterm2", macos_bundle_exists("iTerm.app")),
        (
            "warp",
            which::which("warp").is_ok() || macos_bundle_exists("Warp.app"),
        ),
        ("terminal", true),
    ];

    candidates
        .into_iter()
        .filter(|(_, detected)| *detected)
        .map(|(id, _)| id.to_string())
        .collect()
}

#[cfg(target_os = "windows")]
fn detect_windows_terminal_ids() -> Vec<String> {
    let mut terminals = Vec::new();

    if which::which("wt").is_ok() {
        terminals.push("wt".to_string());
    }

    if which::which("pwsh").is_ok() {
        terminals.push("pwsh".to_string());
    } else if which::which("powershell").is_ok() {
        terminals.push("powershell".to_string());
    }

    terminals.push("cmd".to_string());

    terminals
}

fn detect_editor_ids() -> Vec<String> {
    let candidates = ["cursor", "vscode", "intellij", "phpstorm", "zed"];

    candidates
        .iter()
        .filter(|id| {
            is_editor_cli_available(id) || {
                #[cfg(target_os = "macos")]
                {
                    match **id {
                        "cursor" => std::path::Path::new("/Applications/Cursor.app").exists(),
                        "vscode" => {
                            std::path::Path::new("/Applications/Visual Studio Code.app").exists()
                        }
                        "intellij" => find_existing_intellij_bundle().is_some(),
                        "phpstorm" => find_existing_phpstorm_bundle().is_some(),
                        "zed" => find_existing_macos_zed_bundle().is_some(),
                        _ => false,
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    check_windows_editor_installed(id)
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                false
            }
        })
        .map(|id| (*id).to_string())
        .collect()
}

fn is_editor_cli_available(id: &str) -> bool {
    match id {
        "vscode" => which::which("code").is_ok(),
        "intellij" => which::which("idea").is_ok(),
        other => which::which(other).is_ok(),
    }
}

#[cfg(target_os = "windows")]
fn check_windows_editor_installed(id: &str) -> bool {
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let programfiles = std::env::var("ProgramFiles").unwrap_or_default();

    match id {
        "cursor" => {
            std::path::Path::new(&format!("{localappdata}\\Programs\\Cursor\\Cursor.exe")).exists()
        }
        "vscode" => {
            which::which("code").is_ok()
                || std::path::Path::new(&format!(
                    "{localappdata}\\Programs\\Microsoft VS Code\\Code.exe"
                ))
                .exists()
                || std::path::Path::new(&format!("{programfiles}\\Microsoft VS Code\\Code.exe"))
                    .exists()
        }
        "intellij" => {
            let toolbox = std::env::var("LOCALAPPDATA")
                .map(|la| {
                    std::path::Path::new(&format!("{la}\\JetBrains\\Toolbox\\apps\\IDEA-U\\ch-0"))
                        .exists()
                })
                .unwrap_or(false);
            toolbox
                || std::path::Path::new(&format!(
                    "{programfiles}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe"
                ))
                .exists()
        }
        "phpstorm" => {
            let toolbox = std::env::var("LOCALAPPDATA")
                .map(|la| {
                    std::path::Path::new(&format!("{la}\\JetBrains\\Toolbox\\apps\\PhpStorm\\ch-0"))
                        .exists()
                })
                .unwrap_or(false);
            toolbox
                || std::path::Path::new(&format!(
                    "{programfiles}\\JetBrains\\PhpStorm\\bin\\phpstorm64.exe"
                ))
                .exists()
        }
        "zed" => std::path::Path::new(&format!("{localappdata}\\Programs\\Zed\\zed.exe")).exists(),
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn macos_bundle_exists(bundle_name: &str) -> bool {
    let mut candidates = vec![std::path::PathBuf::from("/Applications").join(bundle_name)];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications").join(bundle_name));
    }

    candidates.into_iter().any(|candidate| candidate.exists())
}

fn guess_is_file(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file(),
        Err(_) => path.extension().map(|ext| !ext.is_empty()).unwrap_or(false),
    }
}

fn resolve_request(
    worktree_root: &str,
    target_path: Option<&str>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<ResolvedRequest, String> {
    let root = PathBuf::from(worktree_root);
    if !root.is_absolute() {
        return Err("Worktree root must be an absolute path".into());
    }

    let mut terminal_workdir = root.clone();
    let target = target_path.map(|raw| {
        let mut abs = PathBuf::from(raw);
        if !abs.is_absolute() {
            abs = root.join(raw);
        }
        let is_file = guess_is_file(&abs);
        if is_file {
            if let Some(parent) = abs.parent() {
                terminal_workdir = parent.to_path_buf();
            }
        } else {
            terminal_workdir = abs.clone();
        }
        ResolvedTarget {
            absolute_path: abs,
            is_file,
            line,
            column,
        }
    });

    Ok(ResolvedRequest {
        worktree_root: root,
        target,
        terminal_workdir,
    })
}

fn format_path_with_position(path: &Path, line: Option<u32>, column: Option<u32>) -> String {
    match (line, column) {
        (Some(l), Some(c)) => format!("{}:{}:{}", path.to_string_lossy(), l, c),
        (Some(l), None) => format!("{}:{}", path.to_string_lossy(), l),
        _ => path.to_string_lossy().to_string(),
    }
}

#[cfg(target_os = "macos")]
fn to_file_uri(path: &Path) -> String {
    format!("file://{}", path.to_string_lossy())
}

#[cfg(target_os = "macos")]
fn build_command_macos(app_id: &str, req: &ResolvedRequest) -> Result<CommandSpec, String> {
    let root = req.worktree_root.to_string_lossy().to_string();
    let goto = req
        .target
        .as_ref()
        .map(|t| format_path_with_position(&t.absolute_path, t.line, t.column));
    let terminal_dir = req.terminal_workdir.to_string_lossy().to_string();
    let target_or_root = req
        .target
        .as_ref()
        .map(|t| t.absolute_path.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    match app_id {
        "finder" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec![target_or_root.clone()],
            working_dir: None,
        }),
        "system-open" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec![target_or_root],
            working_dir: None,
        }),
        "terminal" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec!["-a".into(), "Terminal".into(), terminal_dir],
            working_dir: None,
        }),
        "iterm2" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec!["-a".into(), "iTerm".into(), terminal_dir],
            working_dir: None,
        }),
        "warp" => Ok(CommandSpec {
            program: "warp".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "ghostty" => Ok(CommandSpec {
            program: "ghostty".into(),
            args: vec![format!("--working-directory={}", terminal_dir)],
            working_dir: None,
        }),
        "vscode" | "code" | "cursor" => {
            let mut args = vec!["--reuse-window".into()];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            } else {
                args.push("--folder-uri".into());
                args.push(to_file_uri(&req.worktree_root));
            }
            Ok(CommandSpec {
                program: if app_id == "cursor" { "cursor" } else { "code" }.into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "intellij" | "idea" | "phpstorm" => {
            let mut args: Vec<String> = Vec::new();
            if let Some(target) = req.target.as_ref() {
                if let Some(line) = target.line {
                    args.push("--line".into());
                    args.push(line.to_string());
                }
                args.push(target.absolute_path.to_string_lossy().to_string());
            } else {
                args.push(root);
            }
            Ok(CommandSpec {
                program: if app_id == "phpstorm" {
                    "phpstorm"
                } else {
                    "idea"
                }
                .into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "zed" => {
            let mut args = vec![root];
            if let Some(target) = req.target.as_ref() {
                args.push(format_path_with_position(
                    &target.absolute_path,
                    target.line,
                    target.column,
                ));
            }
            Ok(CommandSpec {
                program: "zed".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        other => Err(format!("Unsupported app id: {other}")),
    }
}

#[cfg(target_os = "linux")]
fn build_command_linux(app_id: &str, req: &ResolvedRequest) -> Result<CommandSpec, String> {
    let root = req.worktree_root.to_string_lossy().to_string();
    let goto = req
        .target
        .as_ref()
        .map(|t| format_path_with_position(&t.absolute_path, t.line, t.column));
    let terminal_dir = req.terminal_workdir.to_string_lossy().to_string();
    let target_or_root = req
        .target
        .as_ref()
        .map(|t| t.absolute_path.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    match app_id {
        "system-open" => Ok(CommandSpec {
            program: "xdg-open".into(),
            args: vec![target_or_root],
            working_dir: None,
        }),

        // File managers
        "dolphin" | "nautilus" | "nemo" | "pcmanfm" | "thunar" => Ok(CommandSpec {
            program: app_id.into(),
            args: vec![target_or_root],
            working_dir: None,
        }),

        // Terminals
        "alacritty" => Ok(CommandSpec {
            program: "alacritty".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "gnome-terminal" => Ok(CommandSpec {
            program: "gnome-terminal".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "konsole" => Ok(CommandSpec {
            program: "konsole".into(),
            args: vec!["--workdir".into(), terminal_dir],
            working_dir: None,
        }),
        "kitty" => Ok(CommandSpec {
            program: "kitty".into(),
            args: vec!["--directory".into(), terminal_dir],
            working_dir: None,
        }),
        "kgx" => Ok(CommandSpec {
            program: "kgx".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "ptyxis" => Ok(CommandSpec {
            program: "ptyxis".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "tilix" => Ok(CommandSpec {
            program: "tilix".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "xfce4-terminal" => Ok(CommandSpec {
            program: "xfce4-terminal".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "wezterm" => Ok(CommandSpec {
            program: "wezterm".into(),
            args: vec!["start".into(), "--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "ghostty" => Ok(CommandSpec {
            program: "ghostty".into(),
            args: vec![format!("--working-directory={terminal_dir}")],
            working_dir: None,
        }),
        "warp" => Ok(CommandSpec {
            program: "warp".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "tmux" => Ok(CommandSpec {
            program: "tmux".into(),
            args: vec!["new-session".into(), "-c".into(), terminal_dir],
            working_dir: None,
        }),
        "zellij" => Ok(CommandSpec {
            program: "zellij".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),

        // Editors
        "cursor" | "code" | "vscode" => {
            let mut args = vec!["--reuse-window".into(), root.clone()];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            }
            Ok(CommandSpec {
                program: if app_id == "cursor" { "cursor" } else { "code" }.into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "intellij" | "idea" | "phpstorm" => {
            let mut args: Vec<String> = Vec::new();
            if let Some(target) = req.target.as_ref() {
                if let Some(line) = target.line {
                    args.push("--line".into());
                    args.push(line.to_string());
                }
                args.push(target.absolute_path.to_string_lossy().to_string());
            } else {
                args.push(root);
            }
            Ok(CommandSpec {
                program: if app_id == "phpstorm" {
                    "phpstorm"
                } else {
                    "idea"
                }
                .into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "zed" => {
            let mut args = vec![root];
            if let Some(target) = req.target.as_ref() {
                args.push(format_path_with_position(
                    &target.absolute_path,
                    target.line,
                    target.column,
                ));
            }
            Ok(CommandSpec {
                program: "zed".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }

        other => Err(format!("Unsupported app id: {other}")),
    }
}

#[cfg(target_os = "windows")]
fn build_command_windows(app_id: &str, req: &ResolvedRequest) -> Result<CommandSpec, String> {
    let root = req.worktree_root.to_string_lossy().to_string();
    let goto = req
        .target
        .as_ref()
        .map(|t| format_path_with_position(&t.absolute_path, t.line, t.column));
    let terminal_dir = req.terminal_workdir.to_string_lossy().to_string();
    let target_or_root = req
        .target
        .as_ref()
        .map(|t| t.absolute_path.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    match app_id {
        "system-open" => Ok(CommandSpec {
            program: "cmd".into(),
            args: vec![
                "/C".into(),
                "start".into(),
                String::new(),
                target_or_root.clone(),
            ],
            working_dir: None,
        }),

        "explorer" => Ok(CommandSpec {
            program: "explorer.exe".into(),
            args: vec![target_or_root],
            working_dir: None,
        }),

        "wt" => Ok(CommandSpec {
            program: "wt".into(),
            args: vec!["-d".into(), terminal_dir],
            working_dir: None,
        }),

        "pwsh" | "powershell" => Ok(CommandSpec {
            program: app_id.into(),
            args: vec![
                "-NoExit".into(),
                "-Command".into(),
                format!("Set-Location '{terminal_dir}'"),
            ],
            working_dir: None,
        }),

        "cmd" => Ok(CommandSpec {
            program: "cmd".into(),
            args: vec!["/K".into(), format!("cd /d \"{terminal_dir}\"")],
            working_dir: None,
        }),

        "cursor" | "code" | "vscode" => {
            let mut args = vec!["--reuse-window".into(), root.clone()];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            }
            Ok(CommandSpec {
                program: if app_id == "cursor" { "cursor" } else { "code" }.into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }

        "intellij" | "idea" | "phpstorm" => {
            let mut args: Vec<String> = Vec::new();
            if let Some(target) = req.target.as_ref() {
                if let Some(line) = target.line {
                    args.push("--line".into());
                    args.push(line.to_string());
                }
                args.push(target.absolute_path.to_string_lossy().to_string());
            } else {
                args.push(root);
            }
            Ok(CommandSpec {
                program: if app_id == "phpstorm" {
                    "phpstorm64"
                } else {
                    "idea64"
                }
                .into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }

        "zed" => {
            let mut args = vec![root];
            if let Some(target) = req.target.as_ref() {
                args.push(format_path_with_position(
                    &target.absolute_path,
                    target.line,
                    target.column,
                ));
            }
            Ok(CommandSpec {
                program: "zed".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }

        other => Err(format!("Unsupported app id: {other}")),
    }
}

fn open_path_in(
    app_id: &str,
    worktree_root: &str,
    target_path: Option<&str>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    let resolved = resolve_request(worktree_root, target_path, line, column)?;

    #[cfg(target_os = "macos")]
    {
        let spec = build_command_macos(app_id, &resolved)?;
        run_command_spec(spec)
    }

    #[cfg(target_os = "linux")]
    {
        let spec = build_command_linux(app_id, &resolved)?;
        run_command_spec(spec)
    }

    #[cfg(target_os = "windows")]
    {
        let spec = build_command_windows(app_id, &resolved)?;
        run_command_spec(spec)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

fn run_command_spec(spec: CommandSpec) -> Result<(), String> {
    let mut cmd = std::process::Command::new(&spec.program);
    if let Some(cwd) = spec.working_dir {
        cmd.current_dir(cwd);
    }
    cmd.args(&spec.args);
    match cmd.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            // Windows Explorer returns exit code 1 even on success - this is a known quirk
            #[cfg(target_os = "windows")]
            if spec.program.to_lowercase().contains("explorer") {
                return Ok(());
            }
            Err(format!("{} exited with status: {status}", spec.program))
        }
        Err(e) => Err(format!("Failed to open in {}: {e}", spec.program)),
    }
}

#[cfg(target_os = "macos")]
fn find_existing_macos_zed_bundle() -> Option<std::path::PathBuf> {
    macos_zed_bundle_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(target_os = "macos")]
fn macos_zed_bundle_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from("/Applications/Zed.app")];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/Zed.app"));
    }

    candidates
        .into_iter()
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .collect()
}

#[cfg(target_os = "macos")]
fn find_existing_intellij_bundle() -> Option<std::path::PathBuf> {
    intellij_app_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(target_os = "macos")]
fn find_existing_phpstorm_bundle() -> Option<std::path::PathBuf> {
    phpstorm_app_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use super::{build_command_linux, resolve_request};
    use std::path::PathBuf;

    #[test]
    fn test_build_command_for_code_with_goto_linux() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(8), Some(2))
            .expect("resolve should succeed");
        let spec = build_command_linux("code", &req).expect("build should succeed");
        assert_eq!(spec.program, "code");
        assert_eq!(spec.working_dir, Some(PathBuf::from("/repo/root")));
        assert!(spec.args.contains(&"--reuse-window".into()));
        assert!(spec.args.contains(&"--goto".into()));
        assert!(spec.args.iter().any(|a| a.ends_with("src/main.rs:8:2")));
    }

    #[test]
    fn test_build_command_for_terminal_sets_parent_dir() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), None, None)
            .expect("resolve should succeed");
        let spec = build_command_linux("alacritty", &req).expect("build should succeed");
        assert_eq!(spec.program, "alacritty");
        assert_eq!(
            spec.args,
            vec![
                "--working-directory".to_string(),
                "/repo/root/src".to_string()
            ]
        );
    }
}

#[cfg(target_os = "macos")]
fn intellij_app_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    push_bundle_variants(&mut candidates, std::path::PathBuf::from("/Applications"));

    if let Some(home) = dirs::home_dir() {
        push_bundle_variants(&mut candidates, home.join("Applications"));
        push_bundle_variants(&mut candidates, home.join("Applications/JetBrains Toolbox"));

        let toolbox_root = home.join("Library/Application Support/JetBrains/Toolbox/apps");
        for channel in ["IDEA-U", "IDEA-C"] {
            let channel_dir = toolbox_root.join(channel);
            push_bundle_variants(&mut candidates, channel_dir.clone());
            collect_intellij_apps_in_dir(&channel_dir, &mut candidates, 0);
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

#[cfg(target_os = "macos")]
fn phpstorm_app_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from("/Applications/PhpStorm.app")];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/PhpStorm.app"));
        candidates.push(home.join("Applications/JetBrains Toolbox/PhpStorm.app"));
    }

    candidates
        .into_iter()
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .collect()
}

#[cfg(target_os = "macos")]
fn push_bundle_variants(candidates: &mut Vec<std::path::PathBuf>, base_dir: std::path::PathBuf) {
    if base_dir.as_os_str().is_empty() {
        return;
    }
    for name in [
        "IntelliJ IDEA.app",
        "IntelliJ IDEA CE.app",
        "IntelliJ IDEA Ultimate.app",
    ] {
        candidates.push(base_dir.join(name));
    }
}

#[cfg(target_os = "macos")]
fn collect_intellij_apps_in_dir(
    dir: &Path,
    candidates: &mut Vec<std::path::PathBuf>,
    depth: usize,
) {
    if depth > 4 {
        return;
    }

    if !dir.exists() {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if looks_like_intellij_app(&path) {
                    candidates.push(path);
                } else {
                    collect_intellij_apps_in_dir(&path, candidates, depth + 1);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn looks_like_intellij_app(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("app"))
        != Some(true)
    {
        return false;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().contains("intellij idea"))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn list_available_open_apps() -> Result<Vec<OpenApp>, String> {
    Ok(detect_available_apps())
}

fn resolve_open_app_state(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<ResolvedOpenAppState> {
    let stored_enabled = db.get_enabled_open_apps()?;
    let enabled_ids = if stored_enabled.is_empty() {
        default_enabled_open_app_ids()
    } else {
        normalize_enabled_open_app_ids(stored_enabled.clone())
    };

    if stored_enabled != enabled_ids {
        db.set_enabled_open_apps(&enabled_ids)?;
    }

    let stored_default = db.get_default_open_app()?;
    let resolved_default = resolve_default_open_app_id(&stored_default, &enabled_ids);
    if stored_default != resolved_default {
        db.set_default_open_app(&resolved_default)?;
    }

    Ok(ResolvedOpenAppState {
        catalog: supported_open_app_catalog(),
        detected_ids: detect_available_app_ids(),
        enabled_ids,
        default_id: resolved_default,
    })
}

pub fn list_available_open_apps_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<Vec<OpenApp>> {
    let state = resolve_open_app_state(db)?;
    let enabled_set = state
        .enabled_ids
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    Ok(state
        .catalog
        .into_iter()
        .filter(|app| enabled_set.contains(&app.id))
        .collect())
}

pub fn list_open_app_catalog_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<Vec<OpenAppCatalogEntry>> {
    let state = resolve_open_app_state(db)?;
    let enabled_set = state
        .enabled_ids
        .into_iter()
        .collect::<std::collections::HashSet<_>>();

    Ok(state
        .catalog
        .into_iter()
        .map(|app| OpenAppCatalogEntry {
            is_detected: state.detected_ids.contains(&app.id),
            is_enabled: enabled_set.contains(&app.id),
            is_default: app.id == state.default_id,
            id: app.id,
            name: app.name,
            kind: app.kind,
        })
        .collect())
}

pub fn get_default_open_app_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<String> {
    Ok(resolve_open_app_state(db)?.default_id)
}

pub fn get_enabled_open_apps_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<Vec<String>> {
    Ok(resolve_open_app_state(db)?.enabled_ids)
}

pub fn get_editor_overrides_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<std::collections::HashMap<String, String>> {
    let overrides = db.get_editor_overrides()?;
    let normalized = normalize_editor_overrides(&overrides);
    if normalized != overrides {
        db.set_editor_overrides(&normalized)?;
    }
    Ok(normalized)
}

pub fn set_editor_overrides_in_db(
    db: &crate::schaltwerk_core::Database,
    overrides: &std::collections::HashMap<String, String>,
) -> anyhow::Result<()> {
    db.set_editor_overrides(&normalize_editor_overrides(overrides))
}

pub fn set_enabled_open_apps_in_db(
    db: &crate::schaltwerk_core::Database,
    app_ids: &[String],
) -> anyhow::Result<()> {
    let normalized_ids = normalize_enabled_open_app_ids(app_ids.iter().cloned());
    db.set_enabled_open_apps(&normalized_ids)?;

    let stored_default = db.get_default_open_app()?;
    let resolved_default = resolve_default_open_app_id(&stored_default, &normalized_ids);
    db.set_default_open_app(&resolved_default)
}

pub fn set_default_open_app_in_db(
    db: &crate::schaltwerk_core::Database,
    app_id: &str,
) -> anyhow::Result<()> {
    if let Some(normalized_app_id) = normalize_open_app_id(app_id) {
        let mut enabled_ids = get_enabled_open_apps_from_db(db)?;
        if !enabled_ids
            .iter()
            .any(|enabled_id| enabled_id == &normalized_app_id)
        {
            enabled_ids.push(normalized_app_id.clone());
            let normalized_enabled_ids = normalize_enabled_open_app_ids(enabled_ids);
            db.set_enabled_open_apps(&normalized_enabled_ids)?;
        }

        db.set_default_open_app(&normalized_app_id)?;
        return Ok(());
    }

    let enabled_ids = get_enabled_open_apps_from_db(db)?;
    let resolved_default = resolve_default_open_app_id(app_id, &enabled_ids);
    db.set_default_open_app(&resolved_default)
}

#[tauri::command]
pub async fn open_in_app(
    app_id: String,
    worktree_root: Option<String>,
    worktree_path: Option<String>, // backward compatibility
    target_path: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    // Run in a blocking task to avoid UI freezing
    tokio::task::spawn_blocking(move || {
        let root = worktree_root
            .or(worktree_path)
            .ok_or_else(|| "worktree_root is required".to_string())?;
        open_path_in(&app_id, &root, target_path.as_deref(), line, column)
    })
    .await
    .map_err(|e| format!("Failed to spawn task: {e}"))?
}
