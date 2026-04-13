//! Stable short hash of a project path, reused for the project DB folder
//! name and the per-project tmux socket name. Living in `shared` keeps
//! cross-domain consumers (e.g. `terminal`) from reaching into `projects`.

use sha2::{Digest, Sha256};
use std::path::Path;

/// First 16 lowercase-hex chars of SHA-256 of the canonicalized project path.
pub fn project_hash16(project_path: &Path) -> Result<String, std::io::Error> {
    let canonical_path = std::fs::canonicalize(project_path)?;
    Ok(project_hash16_for_canonical(&canonical_path))
}

/// Variant that skips canonicalization — callers are responsible for passing
/// an already-canonical path.
pub fn project_hash16_for_canonical(canonical_path: &Path) -> String {
    let path_str = canonical_path.to_string_lossy();
    let mut hasher = Sha256::new();
    hasher.update(path_str.as_bytes());
    let hash_result = hasher.finalize();
    let hash_hex = format!("{hash_result:x}");
    hash_hex[..16].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn returns_16_lowercase_hex() {
        let tmp = TempDir::new().unwrap();
        let h = project_hash16(tmp.path()).unwrap();
        assert_eq!(h.len(), 16);
        assert!(
            h.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
    }

    #[test]
    fn is_stable_for_same_canonical_path() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            project_hash16(tmp.path()).unwrap(),
            project_hash16(tmp.path()).unwrap()
        );
    }

    #[test]
    fn differs_for_different_paths() {
        let a = TempDir::new().unwrap();
        let b = TempDir::new().unwrap();
        assert_ne!(
            project_hash16(a.path()).unwrap(),
            project_hash16(b.path()).unwrap()
        );
    }
}
