# Generation Agent Consistency — Plan

Ordered steps. Each step lists the failing test to write first (TDD), then the implementation.

## Step 1 — Rust: testable seam for login-shell PATH

**Test first.** In `src-tauri/src/domains/terminal/login_shell_env.rs`, add a unit test that installs a mock PATH into the login-shell env cache (via a new `testing::set_cached_env_for_test`/teardown helper or equivalent `#[cfg(test)]` injector) and asserts `get_login_shell_path()` returns the injected value.

**Implementation.** Expose a `#[cfg(test)]`-gated setter that replaces the `OnceLock`-cached env for the duration of a test. (If the OnceLock is already filled, the test path uses a parallel `OnceLock` + a lookup function the production `get_login_shell_path` already routes through.) Keep production behavior unchanged.

## Step 2 — Rust: `resolve_agent_binary` consults login-shell PATH

**Test first.** In `domains/agents/mod.rs` (or a sibling `tests` module), add a unit test:
- Create a temp dir, write an executable file `fake-login-agent` with `+x`.
- Use the Step 1 seam to push `<temp_dir>` onto the login-shell PATH.
- Call `resolve_agent_binary("fake-login-agent")` and assert it returns the file path from the temp dir.
- Second test: when the binary is not on login-shell PATH and not in the hardcoded paths, assert the function still returns the bare command name (unchanged fallback).

**Implementation.** In `resolve_agent_binary_with_extra_paths`, after `extra_paths` and before the standard system paths, splice in PATH entries from `login_shell_env::get_login_shell_path()` (split by `:` on Unix, `;` on Windows, dedup against already-collected paths). Preserve the existing `which::which` fallback.

## Step 3 — Rust: shared subprocess env helper

**Test first.** Add unit tests in `login_shell_env.rs`:
- `base_subprocess_env_contains_login_path`: after injecting a fake PATH + HOME + LANG, the helper returns entries containing those keys.
- `base_subprocess_env_handles_missing_keys`: when the login-shell env is empty (no PATH), the helper returns an empty vector (no fabricated keys).

**Implementation.** Add `pub fn base_subprocess_env() -> Vec<(String, String)>` that projects only `PATH`, `HOME` (or `USERPROFILE` on Windows), `LANG`, and `LC_ALL` from the cached login-shell env. This is the reusable bridge for generation subprocess env builders.

## Step 4 — Rust: naming + commit subprocess env uses shell env

**Test first.**
- Extend the existing `build_namegen_env` test (line ~1332 in `naming.rs`) to:
  - Assert the returned env includes `PATH` from the login-shell env when injected (via Step 1 seam).
  - Assert the existing `NO_COLOR`/`TERM=dumb`/`CI`/`NONINTERACTIVE` overrides still appear exactly once.
  - Assert caller-supplied env_vars still override the defaults (e.g., the caller can set `PATH` and it wins).
- Add an equivalent test in `commit_message.rs` for `build_env`.

**Implementation.**
- Change `build_namegen_env` to prepend `login_shell_env::base_subprocess_env()` before the existing override set. Because `Vec<(String, String)>` later entries shadow earlier ones when `Command::envs()` is applied, ordering must be: `[login_shell_base, fixed_overrides, caller_env_vars]`. Verify against tokio `Command::envs` semantics (it maintains a HashMap; later keys win).
- Same change to `commit_message.rs::build_env`.

## Step 5 — Frontend: generation selector computed from enabled providers

**Test first.** In `src/components/modals/SettingsModal.test.tsx`, add:
- `generation global agent dropdown lists only enabled non-terminal providers`: stub the Jotai enabled-agents atom so only `gemini` and `codex` are enabled among non-terminal; render the generation tab; assert the main agent Select exposes `Default`, `Gemini`, `Codex` and **not** `Claude`, `OpenCode`, `Kilo Code`.
- `generation override selectors mirror enabled providers`: same stub; expand overrides; assert each override Select exposes `Use global default`, `Gemini`, `Codex`.
- `generation selectors surface saved-but-disabled values`: pre-load `generation.agent = 'claude'` with `claude` disabled; assert `Claude` remains in the global agent options so the user still sees what was saved.

**Implementation.** In `SettingsModal.tsx` `renderGenerationSettings`:
- Remove the hardcoded `generationAgentOptions` array.
- Derive `enabledNonTerminalAgents` from `AGENT_TYPES.filter(a => a !== 'terminal' && enabledAgents[a])` (reusing the same `enabledAgents` state the modal already manages).
- Build `generationAgentOptions = [{value:'', label: agentDefault}, ...enabledNonTerminalAgents.map(a => ({value: a, label: agentDisplayName(a)}))]` and append the currently-saved `generationAgent` if non-empty and not already present.
- Build `generationOverrideOptions = [{value:'', label: actionAgentDefault}, ...enabledNonTerminalAgents.map(...)]` and, per override field, append the current override value if it is a non-empty string not already listed.
- No other change.

## Step 6 — Verification

Run the full suite: `just test` (falls back to `bun run test`). All green before completion.

## Step 7 — Code review + squashed commit

Invoke `superpowers:requesting-code-review` on the final diff. Address any blockers. Finish with a single squashed commit per the task's completion rule.

## Non-goals (stay disciplined)

- No changes to enable/disable UX.
- No new generation action types.
- No fallback provider changes (still `gemini` when no override).
- No tmux or terminal lifecycle work.
