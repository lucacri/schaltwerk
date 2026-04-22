# Generation Agent Consistency — Design

Scope is two narrow consistency fixes. No new UX, no new providers, no agent API changes.

## Fix 1 — AI Generation selectors follow enabled non-terminal providers

**Problem.** `SettingsModal.tsx` renders the AI Generation global agent and per-action override selectors from a hardcoded list (`claude`, `gemini`, `codex`, `opencode`, `kilocode`). This list drifts from the project's actual enabled non-terminal providers. The spec clarification selector already derives its options from enabled non-terminal agents.

**Approach.** Compute the option list from the already-loaded `enabledAgents` state, filtered with `AGENT_TYPES.filter(a => a !== 'terminal' && enabledAgents[a])` and labelled with the existing `agentDisplayName(agent)` helper. Prepend the existing "Default" option. If a previously-saved value points at an agent that is now disabled, keep that value visible as a trailing option — same pattern as `specClarificationAllowedAgents`. The per-action override list follows the same rule with its own "Use global default" placeholder.

No changes to save/load behavior, no migration. The effect is purely that the dropdown contents match enabled providers instead of a frozen subset.

## Fix 2 — Agent launch uses the same effective shell environment as Lucode shell terminals

**Problem.** Lucode's normal shell terminals go through `domains/terminal/command_builder.rs::build_environment`, which seeds `PATH` from `login_shell_env::get_login_shell_env()` plus a curated priority list. Agent launches diverge in two places:

1. `domains/agents/mod.rs::resolve_agent_binary_with_extra_paths` searches a fixed user-path list (`~/.local/bin`, `~/.cargo/bin`, `~/bin` on Unix) plus `/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`, `/bin`, then falls back to `which::which` on the app process PATH. On macOS, a GUI-launched Lucode has a stripped PATH, so a binary exposed only through the user's shell (`~/.bun/bin`, `~/.volta/bin`, or similar) is not resolved. Result: `gemini` stays unresolved and is passed through to launch.
2. Direct generation-agent subprocesses (`domains/agents/naming.rs`, `domains/agents/commit_message.rs`) build their `Command` env from a sparse override set (`NO_COLOR`, `TERM=dumb`, etc.) plus whatever the caller supplied. They never inject the login-shell `PATH`, `HOME`, `LANG`, so the subprocess inherits the app's bare PATH for its own `execvp` lookup when a bare binary name is used.

**Approach.**

- Extend `resolve_agent_binary_with_extra_paths` to append PATH entries from `login_shell_env::get_login_shell_env()["PATH"]` (deduplicated, Unix-only `:` split / Windows-only `;` split) to the candidate list before the `which::which` fallback. This is the same login-env cache `command_builder` already uses, so terminal and agent lookups resolve from the same worldview.

- Add a shared helper `login_shell_env::base_subprocess_env()` (or equivalent small API in `domains/terminal/login_shell_env.rs`) that returns a `Vec<(String, String)>` containing `PATH`, `HOME`/`USERPROFILE`, `LANG`, and `LC_ALL` when the login shell exposed them. Use this helper in `naming.rs::build_namegen_env` and `commit_message.rs::build_env`, merged before the caller-supplied `env_vars` so explicit caller overrides still win. The existing `NO_COLOR` / `TERM=dumb` / `CI` / `NONINTERACTIVE` overrides remain untouched.

Nothing else in the launch pipeline changes. Terminal agent launches already flow through `command_builder::build_environment`, so once binary resolution agrees they are aligned.

## Test strategy

- **Frontend:** Vitest for `SettingsModal` with a mocked enabled-agents atom — assert the global and override selectors expose the enabled set plus the saved value, and hide disabled agents. One test each for the happy path and for the "saved value is now disabled" fallback.
- **Backend binary resolution:** A Rust unit test that places a fake binary in a temp directory, temporarily sets that directory onto a custom login-shell PATH (via a seam that lets the test inject a PATH string), and verifies `resolve_agent_binary_with_extra_paths` finds it. Requires a small refactor: the resolver reads login-shell PATH through a thin function that tests can stub.
- **Generation subprocess env:** Rust unit tests for `build_namegen_env` and the commit `build_env` asserting PATH/HOME/LANG appear in the returned env and that caller-provided values override the defaults.

## Out of scope

Provider enablement, new providers, changed generation fallback, shell detection behavior, tmux/PTY sizing, terminal tabs. All untouched.
