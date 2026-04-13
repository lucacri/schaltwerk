//! Lucode-owned tmux configuration. Shipped as a compile-time string and
//! provisioned on disk at startup. Never sources the user's `~/.tmux.conf`.

/// Stamp written as the first line of the generated tmux.conf. Bumping the
/// Lucode crate version changes the stamp, which in turn forces per-project
/// tmux servers to restart at next launch.
pub const TMUX_CONF_VERSION_STAMP: &str =
    concat!("# lucode-tmux-conf v", env!("CARGO_PKG_VERSION"));

/// Full body of the Lucode tmux configuration file. The first line is the
/// version stamp; callers compare the on-disk first line against this stamp
/// to decide whether to rewrite the file and kill stale servers.
pub const TMUX_CONF_BODY: &str = concat!(
    "# lucode-tmux-conf v",
    env!("CARGO_PKG_VERSION"),
    "\n",
    "\n",
    "# --- UI suppression\n",
    "set -g status off\n",
    "set -g set-titles off\n",
    "set -g allow-rename off\n",
    "set -g automatic-rename off\n",
    "\n",
    "# --- Keys (Lucode drives panes; no tmux chords reach the user)\n",
    "unbind-key -a\n",
    "set -g prefix None\n",
    "set -g prefix2 None\n",
    "\n",
    "# --- Mouse (xterm.js owns it)\n",
    "set -g mouse off\n",
    "\n",
    "# --- Latency / focus\n",
    "set -s escape-time 0\n",
    "set -s focus-events on\n",
    "\n",
    "# --- Scrollback\n",
    "set -g history-limit 50000\n",
    "\n",
    "# --- Terminal capabilities\n",
    "set -g default-terminal \"tmux-256color\"\n",
    "set -ga terminal-features \"*:RGB:hyperlinks:usstyle\"\n",
    "\n",
    "# --- Clipboard / passthrough\n",
    "set -g set-clipboard on\n",
    "set -g allow-passthrough on\n",
    "\n",
    "# --- Resize (single attacher per session)\n",
    "set -g window-size latest\n",
    "set -g aggressive-resize off\n",
    "set -g default-size 80x24\n",
    "\n",
    "# --- Crash visibility\n",
    "set -g remain-on-exit on\n",
    "\n",
    "# --- Env propagation for long-lived server\n",
    "set -g update-environment \"PATH SHELL LANG LC_ALL LC_CTYPE TERM_PROGRAM SSH_AUTH_SOCK ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY DISPLAY\"\n",
    "\n",
    "# --- Shell (empty => spawn $SHELL as login shell)\n",
    "set -g default-command \"\"\n",
    "\n",
    "# --- Server lifecycle (Lucode owns it)\n",
    "set -g destroy-unattached off\n",
    "set -g detach-on-destroy off\n",
    "set -g exit-empty off\n",
    "set -g exit-unattached off\n",
);

/// The first-line version stamp used by bootstrap for staleness checks.
pub fn config_version_stamp() -> &'static str {
    TMUX_CONF_VERSION_STAMP
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_line_is_version_stamp() {
        let first_line = TMUX_CONF_BODY.lines().next().unwrap();
        assert_eq!(first_line, TMUX_CONF_VERSION_STAMP);
        assert!(first_line.starts_with("# lucode-tmux-conf v"));
    }

    #[test]
    fn contains_required_directives() {
        for d in [
            "status off",
            "unbind-key -a",
            "mouse off",
            "escape-time 0",
            "history-limit 50000",
            "default-terminal \"tmux-256color\"",
            "window-size latest",
            "aggressive-resize off",
            "default-size 80x24",
            "remain-on-exit on",
            "destroy-unattached off",
            "detach-on-destroy off",
            "exit-empty off",
            "exit-unattached off",
            "default-command \"\"",
            "allow-passthrough on",
            "set-clipboard on",
        ] {
            assert!(
                TMUX_CONF_BODY.contains(d),
                "tmux.conf missing required directive: {d:?}"
            );
        }
    }

    #[test]
    fn does_not_source_user_tmux_conf() {
        assert!(!TMUX_CONF_BODY.contains("source-file"));
        assert!(!TMUX_CONF_BODY.contains("~/.tmux.conf"));
    }
}
