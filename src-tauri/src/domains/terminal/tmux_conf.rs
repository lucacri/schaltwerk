//! Lucode-owned tmux configuration. Shipped as a compile-time string and
//! provisioned on disk at startup. Never sources the user's `~/.tmux.conf`.

/// Stamp written as the first line of the generated tmux.conf. The
/// `mouse-v2` suffix is bumped independently of the crate version whenever
/// the bundled tmux mouse behavior changes so existing on-disk configs are
/// rewritten and live Lucode tmux servers can be reloaded at startup.
pub const TMUX_CONF_VERSION_STAMP: &str =
    concat!("# lucode-tmux-conf v", env!("CARGO_PKG_VERSION"), " mouse-v2");

/// Full body of the Lucode tmux configuration file. The first line is the
/// version stamp; callers compare the on-disk first line against this stamp
/// to decide whether to rewrite the file and kill stale servers.
pub const TMUX_CONF_BODY: &str = concat!(
    "# lucode-tmux-conf v",
    env!("CARGO_PKG_VERSION"),
    " mouse-v2",
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
    "# --- Mouse (tmux owns wheel + selection; xterm.js forwards SGR reports)\n",
    "set -g mouse on\n",
    "\n",
    "# Wheel outside copy-mode: always enter copy-mode and scroll three lines\n",
    "# up on the first tick. Lucode keeps wheel-up reserved for tmux-owned\n",
    "# agent scrollback even when the inner app has enabled mouse tracking.\n",
    "bind-key -T root WheelUpPane   copy-mode -e\\; send-keys -X -N 3 scroll-up\n",
    "bind-key -T root WheelDownPane if-shell -F -t = \"#{mouse_any_flag}\" \"send-keys -M\"\n",
    "\n",
    "# Wheel inside copy-mode scrolls tmux's 50k history buffer.\n",
    "bind-key -T copy-mode WheelUpPane   send-keys -X -N 3 scroll-up\n",
    "bind-key -T copy-mode WheelDownPane send-keys -X -N 3 scroll-down\n",
    "\n",
    "# Drag to select: enter copy-mode via mouse; release copies through\n",
    "# set-clipboard on (OSC 52) to the OS clipboard.\n",
    "bind-key -T root MouseDrag1Pane if-shell -F -t = \"#{mouse_any_flag}\" \"send-keys -M\" \"copy-mode -M\"\n",
    "bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel\n",
    "\n",
    "# Double-click and right-click select a word (replaces the default tmux\n",
    "# context menu, which is suppressed for Lucode's single-pane UX).\n",
    "bind-key -T root DoubleClick1Pane copy-mode\\; send-keys -X select-word\\; send-keys -X copy-pipe-no-clear\n",
    "bind-key -T root MouseDown3Pane   copy-mode\\; send-keys -X select-word\\; send-keys -X copy-pipe-no-clear\n",
    "\n",
    "# Exit paths out of copy-mode (mouse click, q, Escape, Enter).\n",
    "bind-key -T copy-mode MouseDown1Pane send-keys -X cancel\n",
    "bind-key -T copy-mode q      send-keys -X cancel\n",
    "bind-key -T copy-mode Escape send-keys -X cancel\n",
    "bind-key -T copy-mode Enter  send-keys -X copy-pipe-and-cancel\n",
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
        assert!(
            first_line.ends_with(" mouse-v2"),
            "tmux.conf stamp must change when bundled tmux mouse behavior changes"
        );
    }

    #[test]
    fn contains_required_directives() {
        for d in [
            "status off",
            "unbind-key -a",
            "mouse on",
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
        assert!(
            !TMUX_CONF_BODY.contains("set -g mouse off"),
            "tmux.conf must not disable mouse handling"
        );
    }

    #[test]
    fn wheel_outside_copy_mode_enters_copy_mode_and_scrolls() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T root WheelUpPane"),
            "missing root WheelUpPane binding"
        );
        assert!(
            TMUX_CONF_BODY.contains("copy-mode -e\\; send-keys -X -N 3 scroll-up"),
            "root WheelUpPane must enter copy-mode and scroll on the first tick"
        );
        assert!(
            !TMUX_CONF_BODY.contains("bind-key -T root WheelUpPane   if-shell -F -t = \"#{mouse_any_flag}\""),
            "root WheelUpPane must not defer to inner-app mouse tracking"
        );
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T root WheelDownPane"),
            "missing root WheelDownPane binding"
        );
    }

    #[test]
    fn copy_mode_wheel_bindings_scroll_tmux_history() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T copy-mode WheelUpPane"),
            "missing copy-mode WheelUpPane binding"
        );
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T copy-mode WheelDownPane"),
            "missing copy-mode WheelDownPane binding"
        );
        assert!(
            TMUX_CONF_BODY.contains("scroll-up"),
            "copy-mode WheelUp must drive scroll-up"
        );
        assert!(
            TMUX_CONF_BODY.contains("scroll-down"),
            "copy-mode WheelDown must drive scroll-down"
        );
    }

    #[test]
    fn drag_selection_enters_copy_mode_and_copies_on_release() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T root MouseDrag1Pane"),
            "drag must start a selection in copy-mode"
        );
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T copy-mode MouseDragEnd1Pane"),
            "drag release must finish the selection"
        );
        assert!(
            TMUX_CONF_BODY.contains("copy-pipe-and-cancel"),
            "drag release must copy selection (uses set-clipboard/OSC 52)"
        );
    }

    #[test]
    fn right_click_selects_word_instead_of_showing_menu() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T root MouseDown3Pane"),
            "missing root MouseDown3Pane binding (required to override default context menu)"
        );
        assert!(
            TMUX_CONF_BODY.contains("select-word"),
            "right-click must select-word"
        );
        assert!(
            !TMUX_CONF_BODY.contains("display-menu"),
            "default context menu must not be enabled"
        );
    }

    #[test]
    fn double_click_selects_word() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T root DoubleClick1Pane"),
            "missing root DoubleClick1Pane binding"
        );
    }

    #[test]
    fn copy_mode_has_mouse_and_keyboard_exit_paths() {
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T copy-mode MouseDown1Pane"),
            "left-click in copy-mode must exit copy-mode"
        );
        for key in ["bind-key -T copy-mode q", "bind-key -T copy-mode Escape"] {
            assert!(
                TMUX_CONF_BODY.contains(key),
                "copy-mode must bind {key:?} as an exit path"
            );
        }
        assert!(
            TMUX_CONF_BODY.contains("bind-key -T copy-mode Enter"),
            "copy-mode Enter must copy-and-cancel so users can finish a selection"
        );
    }

    #[test]
    fn does_not_source_user_tmux_conf() {
        assert!(!TMUX_CONF_BODY.contains("source-file"));
        assert!(!TMUX_CONF_BODY.contains("~/.tmux.conf"));
    }
}
