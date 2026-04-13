//! Startup preflight for the system `tmux` binary. Lucode requires tmux >= 3.6;
//! letter suffixes (e.g. "3.6a") are accepted but not required.

use std::process::Command;

const MIN_MAJOR: u32 = 3;
const MIN_MINOR: u32 = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TmuxVersion {
    pub major: u32,
    pub minor: u32,
    /// Letter suffix on the minor version, e.g. `"a"` for `"3.6a"`. Empty if absent.
    pub suffix: String,
}

impl TmuxVersion {
    pub fn as_tuple(&self) -> (u32, u32) {
        (self.major, self.minor)
    }
}

/// Run `tmux -V` and return the parsed version. Fail fast if tmux is missing,
/// unparseable, or older than 3.6.
pub fn ensure_tmux_available() -> Result<TmuxVersion, String> {
    let output = Command::new("tmux").arg("-V").output().map_err(|e| {
        format!("tmux is required but not found on PATH: {e}. Install it with `brew install tmux`.")
    })?;
    if !output.status.success() {
        return Err(format!(
            "tmux -V exited with status {:?}; stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let version =
        parse_tmux_version(&raw).ok_or_else(|| format!("unrecognized tmux -V output: {raw:?}"))?;
    check_min_version(&version)?;
    Ok(version)
}

pub(crate) fn parse_tmux_version(raw: &str) -> Option<TmuxVersion> {
    let trimmed = raw.trim();
    let after_prefix = trimmed.strip_prefix("tmux ")?;
    let version_token = after_prefix.split_whitespace().next()?;

    let mut parts = version_token.splitn(2, '.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor_with_suffix = parts.next()?;

    let split_idx = minor_with_suffix
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(i, _)| i)
        .unwrap_or(minor_with_suffix.len());
    let (minor_digits, suffix) = minor_with_suffix.split_at(split_idx);
    if minor_digits.is_empty() {
        return None;
    }
    let minor = minor_digits.parse::<u32>().ok()?;
    Some(TmuxVersion {
        major,
        minor,
        suffix: suffix.to_string(),
    })
}

pub(crate) fn check_min_version(v: &TmuxVersion) -> Result<(), String> {
    if v.as_tuple() < (MIN_MAJOR, MIN_MINOR) {
        return Err(format!(
            "tmux {MIN_MAJOR}.{MIN_MINOR} or newer is required (found {}.{}{}). Upgrade via `brew upgrade tmux`.",
            v.major, v.minor, v.suffix
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_version() {
        let v = parse_tmux_version("tmux 3.5\n").unwrap();
        assert_eq!(
            v,
            TmuxVersion {
                major: 3,
                minor: 5,
                suffix: String::new()
            }
        );
    }

    #[test]
    fn parses_version_with_letter_suffix() {
        let v = parse_tmux_version("tmux 3.6a\n").unwrap();
        assert_eq!(
            v,
            TmuxVersion {
                major: 3,
                minor: 6,
                suffix: "a".into()
            }
        );
    }

    #[test]
    fn parses_two_digit_minor() {
        let v = parse_tmux_version("tmux 3.10\n").unwrap();
        assert_eq!(
            v,
            TmuxVersion {
                major: 3,
                minor: 10,
                suffix: String::new()
            }
        );
    }

    #[test]
    fn rejects_unparseable_input() {
        assert!(parse_tmux_version("not tmux output\n").is_none());
        assert!(parse_tmux_version("tmux\n").is_none());
        assert!(parse_tmux_version("tmux a.b\n").is_none());
    }

    #[test]
    fn accepts_3_6_exactly() {
        let v = TmuxVersion {
            major: 3,
            minor: 6,
            suffix: String::new(),
        };
        assert!(check_min_version(&v).is_ok());
    }

    #[test]
    fn accepts_3_6a() {
        let v = TmuxVersion {
            major: 3,
            minor: 6,
            suffix: "a".into(),
        };
        assert!(check_min_version(&v).is_ok());
    }

    #[test]
    fn rejects_3_5() {
        let v = TmuxVersion {
            major: 3,
            minor: 5,
            suffix: String::new(),
        };
        assert!(check_min_version(&v).is_err());
    }

    #[test]
    fn rejects_2_x() {
        let v = TmuxVersion {
            major: 2,
            minor: 99,
            suffix: String::new(),
        };
        assert!(check_min_version(&v).is_err());
    }

    #[test]
    fn accepts_4_0() {
        let v = TmuxVersion {
            major: 4,
            minor: 0,
            suffix: String::new(),
        };
        assert!(check_min_version(&v).is_ok());
    }
}
