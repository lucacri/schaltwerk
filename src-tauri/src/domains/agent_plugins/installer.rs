use anyhow::{Context, Result, anyhow};
use log::{info, warn};
use std::path::{Path, PathBuf};

pub const LUCODE_PLUGINS_MARKETPLACE_DIR: &str = "lucode-plugins";
const PLUGIN_SUBDIR: &str = "plugins/lucode-plugins";
const STAMP_FILE: &str = ".lucode-install-stamp";

pub fn plugin_source_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join(PLUGIN_SUBDIR));
        candidates.push(dir.join("_up_").join(PLUGIN_SUBDIR));
    }
    if let Some(manifest_parent) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(manifest_parent.join(PLUGIN_SUBDIR));
    }
    candidates
}

fn resolve_source(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    plugin_source_candidates(resource_dir)
        .into_iter()
        .find(|p| p.join(".claude-plugin").join("marketplace.json").exists())
}

fn read_plugin_version(source_root: &Path) -> Result<String> {
    let manifest = source_root
        .join("lucode-terminal-hooks")
        .join(".claude-plugin")
        .join("plugin.json");
    let contents = std::fs::read_to_string(&manifest)
        .with_context(|| format!("Failed to read {}", manifest.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .with_context(|| format!("Failed to parse {}", manifest.display()))?;
    parsed
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("plugin.json missing version"))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    if src.is_file() {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create {}", parent.display()))?;
        }
        std::fs::copy(src, dst)
            .with_context(|| format!("Failed to copy {} -> {}", src.display(), dst.display()))?;
        return Ok(());
    }

    std::fs::create_dir_all(dst)
        .with_context(|| format!("Failed to create {}", dst.display()))?;
    for entry in std::fs::read_dir(src)
        .with_context(|| format!("Failed to read {}", src.display()))?
    {
        let entry = entry?;
        let entry_src = entry.path();
        let entry_dst = dst.join(entry.file_name());
        copy_dir_recursive(&entry_src, &entry_dst)?;
    }
    Ok(())
}

fn install_to(source: &Path, target_root: &Path) -> Result<()> {
    let version = read_plugin_version(source)?;
    let stamp_path = target_root.join(STAMP_FILE);

    if stamp_path.exists()
        && std::fs::read_to_string(&stamp_path)
            .map(|s| s.trim() == version)
            .unwrap_or(false)
    {
        return Ok(());
    }

    if target_root.exists() {
        std::fs::remove_dir_all(target_root).with_context(|| {
            format!("Failed to remove existing {}", target_root.display())
        })?;
    }
    copy_dir_recursive(source, target_root)?;
    std::fs::write(&stamp_path, version).with_context(|| {
        format!("Failed to write install stamp {}", stamp_path.display())
    })?;
    info!(
        "Installed Lucode terminal hooks plugin into {}",
        target_root.display()
    );
    Ok(())
}

pub fn install_bundled_lucode_plugins(resource_dir: Option<PathBuf>) -> Result<()> {
    let source = match resolve_source(resource_dir) {
        Some(p) => p,
        None => {
            warn!(
                "Could not locate bundled lucode-plugins directory; skipping plugin install"
            );
            return Ok(());
        }
    };

    let home = dirs::home_dir().ok_or_else(|| anyhow!("No home directory available"))?;
    let target = home
        .join(".claude")
        .join("plugins")
        .join(LUCODE_PLUGINS_MARKETPLACE_DIR);

    install_to(&source, &target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_source(tmp: &TempDir, version: &str) -> PathBuf {
        let root = tmp.path().join("plugins/lucode-plugins");
        std::fs::create_dir_all(root.join(".claude-plugin")).unwrap();
        std::fs::write(
            root.join(".claude-plugin/marketplace.json"),
            r#"{"name":"lucode-plugins","owner":{"name":"Lucode"},"plugins":[]}"#,
        )
        .unwrap();
        let plugin = root.join("lucode-terminal-hooks/.claude-plugin");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(
            plugin.join("plugin.json"),
            format!(r#"{{"name":"lucode-terminal-hooks","version":"{version}"}}"#),
        )
        .unwrap();
        let hooks = root.join("lucode-terminal-hooks/hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        std::fs::write(hooks.join("hooks.json"), r#"{"hooks":{}}"#).unwrap();
        root
    }

    #[test]
    fn install_copies_plugin_tree_and_writes_stamp() {
        let src_tmp = TempDir::new().unwrap();
        let source = make_source(&src_tmp, "1.0.0");

        let dst_tmp = TempDir::new().unwrap();
        let target = dst_tmp.path().join("lucode-plugins");

        install_to(&source, &target).unwrap();

        assert!(target.join(".claude-plugin/marketplace.json").exists());
        assert!(
            target
                .join("lucode-terminal-hooks/.claude-plugin/plugin.json")
                .exists()
        );
        assert!(target.join("lucode-terminal-hooks/hooks/hooks.json").exists());
        let stamp = std::fs::read_to_string(target.join(".lucode-install-stamp")).unwrap();
        assert_eq!(stamp.trim(), "1.0.0");
    }

    #[test]
    fn install_skips_when_version_matches_stamp() {
        let src_tmp = TempDir::new().unwrap();
        let source = make_source(&src_tmp, "1.0.0");

        let dst_tmp = TempDir::new().unwrap();
        let target = dst_tmp.path().join("lucode-plugins");
        install_to(&source, &target).unwrap();

        let plugin_json_path = target.join("lucode-terminal-hooks/.claude-plugin/plugin.json");
        std::fs::write(&plugin_json_path, "CUSTOMIZED").unwrap();

        install_to(&source, &target).unwrap();

        let after = std::fs::read_to_string(&plugin_json_path).unwrap();
        assert_eq!(after, "CUSTOMIZED");
    }

    #[test]
    fn install_replaces_when_version_changes() {
        let src_tmp = TempDir::new().unwrap();
        let source_v1 = make_source(&src_tmp, "1.0.0");

        let dst_tmp = TempDir::new().unwrap();
        let target = dst_tmp.path().join("lucode-plugins");
        install_to(&source_v1, &target).unwrap();

        // overwrite source manifest with new version
        let manifest = source_v1.join("lucode-terminal-hooks/.claude-plugin/plugin.json");
        std::fs::write(
            &manifest,
            r#"{"name":"lucode-terminal-hooks","version":"2.0.0"}"#,
        )
        .unwrap();

        install_to(&source_v1, &target).unwrap();

        let stamp = std::fs::read_to_string(target.join(".lucode-install-stamp")).unwrap();
        assert_eq!(stamp.trim(), "2.0.0");
        let installed = std::fs::read_to_string(
            target.join("lucode-terminal-hooks/.claude-plugin/plugin.json"),
        )
        .unwrap();
        assert!(installed.contains("2.0.0"));
    }
}
