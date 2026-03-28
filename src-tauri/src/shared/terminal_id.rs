use std::collections::HashSet;

const FNV_OFFSET_BASIS: u32 = 0x811c9dc5;
const FNV_PRIME: u32 = 0x0100_0193;
const HASH_SLICE_CURRENT: usize = 8;
const HASH_SLICE_V1: usize = 6;

pub fn sanitize_session_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

pub fn session_terminal_hash(name: &str) -> u32 {
    let mut hash = FNV_OFFSET_BASIS;
    for unit in name.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

pub fn session_terminal_hash_fragment(name: &str) -> String {
    let hash_hex = format!("{:08x}", session_terminal_hash(name));
    hash_hex[..HASH_SLICE_CURRENT].to_string()
}

fn session_terminal_hash_fragment_v1(name: &str) -> String {
    let hash_hex = format!("{:08x}", session_terminal_hash(name));
    hash_hex[..HASH_SLICE_V1].to_string()
}

pub fn session_terminal_base(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment(name);
    format!("session-{sanitized}~{fragment}")
}

pub fn session_terminal_base_v1(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment_v1(name);
    format!("session-{sanitized}~{fragment}")
}

pub fn session_terminal_base_legacy_hashed(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment_v1(name);
    format!("session-{sanitized}-{fragment}")
}

pub fn session_terminal_base_legacy(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    format!("session-{sanitized}")
}

pub fn session_terminal_base_variants(name: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut variants = Vec::new();
    for candidate in [
        session_terminal_base(name),
        session_terminal_base_v1(name),
        session_terminal_base_legacy_hashed(name),
        session_terminal_base_legacy(name),
    ] {
        if seen.insert(candidate.clone()) {
            variants.push(candidate);
        }
    }
    variants
}

pub fn terminal_id_for_session_top(name: &str) -> String {
    format!("{}-top", session_terminal_base(name))
}

pub fn terminal_id_for_session_bottom(name: &str) -> String {
    format!("{}-bottom", session_terminal_base(name))
}

pub fn terminal_id_for_orchestrator_top(project_path: &std::path::Path) -> String {
    let dir_name = project_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    let sanitized: String = dir_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    };

    let mut hash: i32 = 0;
    for unit in project_path.to_string_lossy().encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(unit as i32);
    }
    let abs_hash: i64 = (hash as i64).abs();
    let hex = format!("{abs_hash:x}");
    let fragment = if hex.len() > 6 { &hex[..6] } else { &hex };

    format!("orchestrator-{sanitized}-{fragment}-top")
}

pub fn previous_tilde_hashed_terminal_id_for_session_top(name: &str) -> String {
    format!("{}-top", session_terminal_base_v1(name))
}

pub fn previous_tilde_hashed_terminal_id_for_session_bottom(name: &str) -> String {
    format!("{}-bottom", session_terminal_base_v1(name))
}

fn strip_numeric_suffix(id: &str) -> &str {
    if let Some((prefix, suffix)) = id.rsplit_once('-')
        && suffix.chars().all(|c| c.is_ascii_digit())
    {
        return prefix;
    }
    id
}

pub fn is_session_top_terminal_id(id: &str) -> bool {
    if id.starts_with("run-terminal-") {
        return false;
    }

    let trimmed = strip_numeric_suffix(id);
    trimmed.ends_with("-top")
}

pub fn legacy_terminal_id_for_session_top(name: &str) -> String {
    format!("{}-top", session_terminal_base_legacy(name))
}

pub fn legacy_terminal_id_for_session_bottom(name: &str) -> String {
    format!("{}-bottom", session_terminal_base_legacy(name))
}

pub fn previous_hashed_terminal_id_for_session_top(name: &str) -> String {
    format!("{}-top", session_terminal_base_legacy_hashed(name))
}

pub fn previous_hashed_terminal_id_for_session_bottom(name: &str) -> String {
    format!("{}-bottom", session_terminal_base_legacy_hashed(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn sanitizes_session_name_and_handles_empty() {
        assert_eq!(sanitize_session_name("alpha beta"), "alpha_beta");
        assert_eq!(sanitize_session_name("////"), "____");
        assert_eq!(sanitize_session_name(""), "unknown");
    }

    #[test]
    fn stable_hash_fragment_is_consistent() {
        let fragment_a = session_terminal_hash_fragment("alpha beta");
        let fragment_b = session_terminal_hash_fragment("alpha beta");
        assert_eq!(fragment_a, fragment_b);
    }

    #[test]
    fn base_and_terminal_ids_include_tilde_hash() {
        let base = session_terminal_base("alpha beta");
        assert_eq!(base, "session-alpha_beta~47c052e3");
        assert_eq!(
            session_terminal_base_v1("alpha beta"),
            "session-alpha_beta~47c052"
        );
        let top = terminal_id_for_session_top("alpha beta");
        assert_eq!(format!("{base}-top"), top);
        let bottom = terminal_id_for_session_bottom("alpha beta");
        assert_eq!(format!("{base}-bottom"), bottom);
    }

    #[test]
    fn distinct_inputs_produce_distinct_ids_even_when_sanitized_same() {
        assert_eq!(
            sanitize_session_name("alpha beta"),
            sanitize_session_name("alpha?beta")
        );
        let top_a = terminal_id_for_session_top("alpha beta");
        let top_b = terminal_id_for_session_top("alpha?beta");
        assert_ne!(top_a, top_b);
    }

    #[test]
    fn legacy_and_previous_hash_helpers_match_expected_patterns() {
        assert!(
            legacy_terminal_id_for_session_top("alpha beta").starts_with("session-alpha_beta-")
        );
        assert!(
            previous_hashed_terminal_id_for_session_top("alpha beta")
                .starts_with("session-alpha_beta-")
        );
        assert!(
            previous_tilde_hashed_terminal_id_for_session_top("alpha beta")
                .starts_with("session-alpha_beta~")
        );
    }

    #[test]
    fn base_variants_cover_all_generations_and_are_unique() {
        let variants = session_terminal_base_variants("alpha beta");
        assert!(variants.iter().any(|v| v.contains('~')));
        assert!(variants.iter().any(|v| !v.contains('~')));

        let unique: HashSet<_> = variants.iter().collect();
        assert_eq!(unique.len(), variants.len());

        let unknown_variants = session_terminal_base_variants("");
        assert!(
            unknown_variants
                .iter()
                .all(|v| v.starts_with("session-unknown"))
        );
    }

    #[test]
    fn top_terminal_detection_handles_variants() {
        let hashed_top = terminal_id_for_session_top("dreamy_kirch");
        assert!(is_session_top_terminal_id(&hashed_top));

        let hashed_bottom = terminal_id_for_session_bottom("dreamy_kirch");
        assert!(!is_session_top_terminal_id(&hashed_bottom));

        let indexed_top = format!("{hashed_top}-0");
        assert!(is_session_top_terminal_id(&indexed_top));

        assert!(is_session_top_terminal_id("orchestrator-main-top"));
        assert!(!is_session_top_terminal_id("orchestrator-main-bottom"));
        assert!(!is_session_top_terminal_id("run-terminal-main"));
        assert!(!is_session_top_terminal_id("run-terminal-top-0"));
    }

    #[test]
    fn orchestrator_terminal_id_matches_frontend_format() {
        use std::path::Path;
        let id = terminal_id_for_orchestrator_top(Path::new("/tmp/my project !@#"));
        assert!(id.starts_with("orchestrator-my_project____-"));
        assert!(id.ends_with("-top"));

        let middle = id
            .strip_prefix("orchestrator-my_project____-")
            .unwrap()
            .strip_suffix("-top")
            .unwrap();
        assert!(!middle.is_empty());
        assert!(middle.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sanitize_session_name_preserves_alphanumeric_and_allowed_chars() {
        assert_eq!(sanitize_session_name("hello-world_123"), "hello-world_123");
    }

    #[test]
    fn sanitize_session_name_replaces_spaces_and_dots() {
        assert_eq!(sanitize_session_name("my.session name"), "my_session_name");
    }

    #[test]
    fn sanitize_session_name_unicode() {
        assert_eq!(sanitize_session_name("\u{00E9}t\u{00E9}"), "\u{00E9}t\u{00E9}");
    }

    #[test]
    fn session_terminal_hash_is_deterministic() {
        let h1 = session_terminal_hash("test");
        let h2 = session_terminal_hash("test");
        assert_eq!(h1, h2);
    }

    #[test]
    fn session_terminal_hash_differs_for_different_inputs() {
        assert_ne!(session_terminal_hash("alpha"), session_terminal_hash("beta"));
    }

    #[test]
    fn session_terminal_hash_fragment_is_8_chars() {
        let fragment = session_terminal_hash_fragment("anything");
        assert_eq!(fragment.len(), 8);
        assert!(fragment.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn session_terminal_hash_fragment_v1_is_6_chars() {
        let fragment = session_terminal_hash_fragment_v1("anything");
        assert_eq!(fragment.len(), 6);
        assert!(fragment.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn terminal_id_top_and_bottom_differ_for_same_session() {
        let top = terminal_id_for_session_top("test");
        let bottom = terminal_id_for_session_bottom("test");
        assert_ne!(top, bottom);
        assert!(top.ends_with("-top"));
        assert!(bottom.ends_with("-bottom"));
    }

    #[test]
    fn session_terminal_base_legacy_no_hash_in_output() {
        let base = session_terminal_base_legacy("my-session");
        assert_eq!(base, "session-my-session");
        assert!(!base.contains('~'));
    }

    #[test]
    fn session_terminal_base_legacy_hashed_uses_dash_separator() {
        let base = session_terminal_base_legacy_hashed("my-session");
        assert!(base.starts_with("session-my-session-"));
        assert!(!base.contains('~'));
    }

    #[test]
    fn strip_numeric_suffix_removes_trailing_number() {
        assert_eq!(strip_numeric_suffix("session-top-0"), "session-top");
        assert_eq!(strip_numeric_suffix("session-top-123"), "session-top");
    }

    #[test]
    fn strip_numeric_suffix_preserves_non_numeric_suffix() {
        assert_eq!(strip_numeric_suffix("session-top"), "session-top");
        assert_eq!(strip_numeric_suffix("session-top-abc"), "session-top-abc");
    }

    #[test]
    fn strip_numeric_suffix_handles_single_segment() {
        assert_eq!(strip_numeric_suffix("top"), "top");
    }

    #[test]
    fn is_session_top_terminal_id_bare_top() {
        assert!(is_session_top_terminal_id("something-top"));
    }

    #[test]
    fn is_session_top_terminal_id_with_numeric_index() {
        assert!(is_session_top_terminal_id("something-top-5"));
    }

    #[test]
    fn is_session_top_terminal_id_bottom_variants() {
        assert!(!is_session_top_terminal_id("something-bottom"));
        assert!(!is_session_top_terminal_id("something-bottom-0"));
    }

    #[test]
    fn orchestrator_terminal_id_deterministic() {
        use std::path::Path;
        let id1 = terminal_id_for_orchestrator_top(Path::new("/home/user/project"));
        let id2 = terminal_id_for_orchestrator_top(Path::new("/home/user/project"));
        assert_eq!(id1, id2);
    }

    #[test]
    fn orchestrator_terminal_id_different_paths_produce_different_ids() {
        use std::path::Path;
        let id1 = terminal_id_for_orchestrator_top(Path::new("/home/user/project-a"));
        let id2 = terminal_id_for_orchestrator_top(Path::new("/home/user/project-b"));
        assert_ne!(id1, id2);
    }

    #[test]
    fn orchestrator_terminal_id_unknown_fallback() {
        use std::path::Path;
        let id = terminal_id_for_orchestrator_top(Path::new("/"));
        assert!(id.contains("unknown") || id.starts_with("orchestrator-"));
    }

    #[test]
    fn session_terminal_base_variants_always_has_at_least_one() {
        let variants = session_terminal_base_variants("x");
        assert!(!variants.is_empty());
    }

    #[test]
    fn previous_tilde_hashed_ids_use_v1_hash() {
        let top = previous_tilde_hashed_terminal_id_for_session_top("test");
        let bottom = previous_tilde_hashed_terminal_id_for_session_bottom("test");
        assert!(top.contains('~'));
        assert!(bottom.contains('~'));
        assert!(top.ends_with("-top"));
        assert!(bottom.ends_with("-bottom"));
    }

    #[test]
    fn previous_hashed_ids_use_dash_separator() {
        let top = previous_hashed_terminal_id_for_session_top("test");
        let bottom = previous_hashed_terminal_id_for_session_bottom("test");
        assert!(!top.contains('~'));
        assert!(!bottom.contains('~'));
        assert!(top.ends_with("-top"));
        assert!(bottom.ends_with("-bottom"));
    }

    #[test]
    fn legacy_ids_contain_no_hash() {
        let top = legacy_terminal_id_for_session_top("my-session");
        let bottom = legacy_terminal_id_for_session_bottom("my-session");
        assert_eq!(top, "session-my-session-top");
        assert_eq!(bottom, "session-my-session-bottom");
    }
}
