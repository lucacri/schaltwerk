use anyhow::Result;
use git2::{Repository, Status, StatusOptions};
use std::collections::HashSet;
use std::path::Path;

#[inline]
fn is_internal_tooling_path(path: &str) -> bool {
    path == ".lucode" || path.starts_with(".lucode/")
}

#[derive(Debug, Clone)]
pub struct WorktreeSnapshot {
    pub has_uncommitted: bool,
    pub has_conflicts: bool,
    pub dirty_files_count: u32,
    pub dirty_paths: HashSet<String>,
    pub uncommitted_sample: Vec<String>,
    pub status_signature: u64,
}

impl WorktreeSnapshot {
    pub fn capture(repo: &Repository) -> Result<Self> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = repo.statuses(Some(&mut opts))?;

        let mut dirty_paths = HashSet::new();
        let mut has_conflicts = false;
        let mut uncommitted_sample = Vec::new();

        let mut status_sig: u64 = 1469598103934665603;
        for entry in statuses.iter() {
            let s = entry.status().bits() as u64;
            status_sig ^= s.wrapping_mul(1099511628211);
            if let Some(path) = entry.path() {
                for b in path.as_bytes() {
                    status_sig ^= (*b as u64).wrapping_mul(1099511628211);
                }
            }

            let Some(path) = entry.path() else { continue };
            if is_internal_tooling_path(path) {
                continue;
            }

            dirty_paths.insert(path.to_string());

            if uncommitted_sample.len() < 5 {
                uncommitted_sample.push(path.to_string());
            }

            if entry.status().contains(Status::CONFLICTED) {
                has_conflicts = true;
            }
        }

        let dirty_files_count = u32::try_from(dirty_paths.len()).unwrap_or(u32::MAX);
        let has_uncommitted = !dirty_paths.is_empty();

        Ok(Self {
            has_uncommitted,
            has_conflicts,
            dirty_files_count,
            dirty_paths,
            uncommitted_sample,
            status_signature: status_sig,
        })
    }

    pub fn from_path(worktree_path: &Path) -> Result<Self> {
        let repo = Repository::open(worktree_path)?;
        Self::capture(&repo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;
    use std::io::Write;
    use std::process::Command;
    use tempfile::TempDir;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).expect("Failed to init repo");
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        drop(tree);
        repo
    }

    fn run_git(path: &Path, args: &[&str]) {
        let global_config = path.join(".gitconfig-test");
        let output = Command::new("git")
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &global_config)
            .args(args)
            .output()
            .expect("failed to execute git command");
        assert!(output.status.success(), "git {:?} failed", args);
    }

    #[test]
    fn clean_repo_snapshot() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert!(!snap.has_uncommitted);
        assert!(!snap.has_conflicts);
        assert_eq!(snap.dirty_files_count, 0);
        assert!(snap.dirty_paths.is_empty());
        assert!(snap.uncommitted_sample.is_empty());
    }

    #[test]
    fn untracked_file_detected() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        fs::write(dir.path().join("new.txt"), "content").unwrap();

        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert!(snap.has_uncommitted);
        assert!(!snap.has_conflicts);
        assert_eq!(snap.dirty_files_count, 1);
        assert!(snap.dirty_paths.contains("new.txt"));
        assert_eq!(snap.uncommitted_sample, vec!["new.txt"]);
    }

    #[test]
    fn internal_tooling_paths_excluded() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        fs::create_dir_all(dir.path().join(".lucode")).unwrap();
        let mut f = fs::File::create(dir.path().join(".lucode/internal.txt")).unwrap();
        writeln!(f, "data").unwrap();

        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert!(!snap.has_uncommitted);
        assert_eq!(snap.dirty_files_count, 0);
        assert!(snap.dirty_paths.is_empty());
    }

    #[test]
    fn staged_changes_detected() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        fs::write(dir.path().join("staged.txt"), "content").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("staged.txt"))
            .unwrap();
        index.write().unwrap();

        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert!(snap.has_uncommitted);
        assert!(snap.dirty_paths.contains("staged.txt"));
    }

    #[test]
    fn conflict_detected() {
        let dir = TempDir::new().unwrap();

        run_git(dir.path(), &["init"]);
        run_git(dir.path(), &["config", "user.email", "t@t.com"]);
        run_git(dir.path(), &["config", "user.name", "T"]);

        fs::write(dir.path().join("file.txt"), "base\n").unwrap();
        run_git(dir.path(), &["add", "file.txt"]);
        run_git(dir.path(), &["commit", "-m", "base"]);
        run_git(dir.path(), &["branch", "-m", "main"]);

        run_git(dir.path(), &["checkout", "-b", "feature"]);
        fs::write(dir.path().join("file.txt"), "feature\n").unwrap();
        run_git(dir.path(), &["commit", "-am", "feature"]);

        run_git(dir.path(), &["checkout", "main"]);
        fs::write(dir.path().join("file.txt"), "main\n").unwrap();
        run_git(dir.path(), &["commit", "-am", "main"]);

        let _ = Command::new("git")
            .current_dir(dir.path())
            .args(["merge", "feature"])
            .output()
            .unwrap();

        let repo = Repository::open(dir.path()).unwrap();
        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert!(snap.has_conflicts);
    }

    #[test]
    fn sample_capped_at_five() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        for i in 0..10 {
            fs::write(dir.path().join(format!("file{i}.txt")), "x").unwrap();
        }

        let snap = WorktreeSnapshot::capture(&repo).unwrap();

        assert_eq!(snap.uncommitted_sample.len(), 5);
        assert_eq!(snap.dirty_files_count, 10);
    }

    #[test]
    fn from_path_works() {
        let dir = TempDir::new().unwrap();
        let _repo = init_repo(dir.path());
        fs::write(dir.path().join("test.txt"), "data").unwrap();

        let snap = WorktreeSnapshot::from_path(dir.path()).unwrap();

        assert!(snap.has_uncommitted);
        assert!(snap.dirty_paths.contains("test.txt"));
    }

    #[test]
    fn status_signature_stable() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());
        fs::write(dir.path().join("a.txt"), "data").unwrap();

        let snap1 = WorktreeSnapshot::capture(&repo).unwrap();
        let snap2 = WorktreeSnapshot::capture(&repo).unwrap();

        assert_eq!(snap1.status_signature, snap2.status_signature);
    }

    #[test]
    fn status_signature_changes_with_content() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo(dir.path());

        let snap_clean = WorktreeSnapshot::capture(&repo).unwrap();

        fs::write(dir.path().join("a.txt"), "data").unwrap();
        let snap_dirty = WorktreeSnapshot::capture(&repo).unwrap();

        assert_ne!(snap_clean.status_signature, snap_dirty.status_signature);
    }
}
