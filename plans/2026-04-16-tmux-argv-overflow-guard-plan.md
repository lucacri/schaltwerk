# Tmux Argv Overflow Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect oversized agent argv before invoking tmux and fail fast with a clear Lucode-branded error, in place of the current unhandled "tmux new-session failed: command too long" rejection.

**Architecture:** Add a byte-length guard in `TmuxCli::new_session_detached` (trait default method in `src-tauri/src/domains/terminal/tmux_cmd.rs`) that sums the bytes of every argv entry we're about to hand tmux and returns `Err(String)` if the total exceeds 500 KB. One guard covers all seven inlining agents (Claude, Codex, Gemini, OpenCode, Amp, Kilocode, Qwen) and both the first-launch and `force_restart=true` paths, because both funnel through this single method.

**Tech Stack:** Rust, tokio, the existing `MockTmuxCli` test infrastructure in `tmux_cmd.rs`.

---

## Task 1: Add the byte-length guard helper + constant

**Files:**
- Modify: `src-tauri/src/domains/terminal/tmux_cmd.rs` (add constant + helper near the top of the file, above the `TmuxCli` trait)

**Step 1: Write the failing tests**

Add these tests inside the existing `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/domains/terminal/tmux_cmd.rs`:

```rust
#[test]
fn argv_size_accepts_small_argvs() {
    let args: Vec<String> = vec!["new-session".into(), "-d".into(), "short".into()];
    assert!(super::check_argv_size(&args).is_ok());
}

#[test]
fn argv_size_rejects_argv_over_limit() {
    let huge = "x".repeat(super::TMUX_ARGV_SOFT_LIMIT_BYTES + 1);
    let args: Vec<String> = vec!["new-session".into(), "-d".into(), huge];
    let err = super::check_argv_size(&args).unwrap_err();
    assert!(err.contains("Lucode"), "err should identify Lucode: {err}");
    assert!(
        err.contains(&super::TMUX_ARGV_SOFT_LIMIT_BYTES.to_string()),
        "err should mention limit {}: {err}",
        super::TMUX_ARGV_SOFT_LIMIT_BYTES
    );
}

#[test]
fn argv_size_accounts_for_null_terminators() {
    // Each arg contributes len + 1 byte (trailing NUL). Assemble many small
    // args whose total byte-with-NUL count crosses the limit even though no
    // single arg is close to it.
    let per_arg = 100;
    let needed = super::TMUX_ARGV_SOFT_LIMIT_BYTES / (per_arg + 1) + 2;
    let args: Vec<String> = (0..needed).map(|_| "a".repeat(per_arg)).collect();
    assert!(super::check_argv_size(&args).is_err());
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd src-tauri && cargo nextest run --package lucode --lib domains::terminal::tmux_cmd::tests::argv_size_accepts_small_argvs --no-fail-fast 2>&1 | tail -30
```
Expected: compile error `cannot find function 'check_argv_size' in module 'super'` (or similar), because the helper doesn't exist yet.

**Step 3: Add the constant and helper**

In `src-tauri/src/domains/terminal/tmux_cmd.rs`, right after the existing `use` block at the top (around line 13, after `use crate::domains::terminal::ApplicationSpec;`), insert:

```rust
/// Upper byte-length Lucode allows for the argv it hands to `tmux new-session`.
///
/// Chosen so that `argv + inherited envp + tmux's own global args` comfortably
/// fits inside the OS `ARG_MAX` ceiling (1 MiB on macOS, 128 KiB–2 MiB on
/// Linux). Anything above this is almost certainly a multi-hundred-KB prompt
/// the user accidentally inlined; the UX goal is a clear error, not a shave
/// to the last byte of headroom.
pub(crate) const TMUX_ARGV_SOFT_LIMIT_BYTES: usize = 500_000;

/// Returns `Err` if the combined byte length of `args` (counting one trailing
/// NUL per entry, matching what `execve` writes into the arg area) exceeds
/// `TMUX_ARGV_SOFT_LIMIT_BYTES`. Used to fail fast on oversized agent argv
/// before tmux emits its own opaque `command too long` error.
pub(crate) fn check_argv_size(args: &[String]) -> Result<(), String> {
    let total: usize = args.iter().map(|a| a.len() + 1).sum();
    if total > TMUX_ARGV_SOFT_LIMIT_BYTES {
        return Err(format!(
            "Lucode preflight: agent argv is {total} bytes, which exceeds \
             Lucode's {TMUX_ARGV_SOFT_LIMIT_BYTES}-byte safety limit for \
             tmux/execve. The initial prompt is too large to inline as a \
             command-line argument. Shorten the prompt (or the session spec) \
             and relaunch."
        ));
    }
    Ok(())
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd src-tauri && cargo nextest run --package lucode --lib domains::terminal::tmux_cmd::tests --no-fail-fast 2>&1 | tail -40
```
Expected: all three new tests pass, plus every existing test in the module still passes.

**Step 5: Commit**

```bash
git add src-tauri/src/domains/terminal/tmux_cmd.rs
git commit -m "feat(terminal): add argv byte-length guard helper for tmux launch"
```

---

## Task 2: Wire the guard into `new_session_detached`

**Files:**
- Modify: `src-tauri/src/domains/terminal/tmux_cmd.rs:73-118` (the `new_session_detached` default method inside `trait TmuxCli`)

**Step 1: Write the failing tests**

Add these to the same `#[cfg(test)] mod tests` block:

```rust
#[tokio::test]
async fn new_session_detached_rejects_oversize_argv_without_calling_tmux() {
    let cli = MockTmuxCli::new(|_| panic!("tmux must not be called for oversize argv"));
    let huge_prompt = "p".repeat(super::TMUX_ARGV_SOFT_LIMIT_BYTES + 10);
    let app = ApplicationSpec {
        command: "claude".into(),
        args: vec![huge_prompt],
        env: vec![],
        ready_timeout_ms: 0,
    };
    let err = cli
        .new_session_detached("term1", 80, 24, "/tmp", Some(&app))
        .await
        .unwrap_err();
    assert!(err.contains("Lucode"), "err must identify Lucode: {err}");
    assert!(
        err.contains("safety limit"),
        "err must mention safety limit: {err}"
    );
    assert!(
        cli.recorded_calls().is_empty(),
        "tmux must not be invoked when argv exceeds the safety limit; calls: {:?}",
        cli.recorded_calls()
    );
}

#[tokio::test]
async fn new_session_detached_counts_env_bytes_toward_argv_limit() {
    // Prompt alone is safe (half the limit), but three env vars whose
    // combined KEY=VAL length is also half the limit tip the total over.
    let cli = MockTmuxCli::new(|_| panic!("tmux must not be called for oversize argv"));
    let half = super::TMUX_ARGV_SOFT_LIMIT_BYTES / 2;
    let big_value = "v".repeat(half);
    let app = ApplicationSpec {
        command: "claude".into(),
        args: vec!["p".repeat(half)],
        env: vec![("FOO".into(), big_value)],
        ready_timeout_ms: 0,
    };
    let err = cli
        .new_session_detached("term1", 80, 24, "/tmp", Some(&app))
        .await
        .unwrap_err();
    assert!(err.contains("Lucode"), "err must identify Lucode: {err}");
}

#[tokio::test]
async fn new_session_detached_accepts_realistic_prompt() {
    let cli = MockTmuxCli::new(|_| success());
    let realistic_prompt = "x".repeat(8 * 1024); // 8 KiB — typical "large" prompt
    let app = ApplicationSpec {
        command: "claude".into(),
        args: vec![realistic_prompt],
        env: vec![("FOO".into(), "bar".into())],
        ready_timeout_ms: 0,
    };
    cli.new_session_detached("term1", 80, 24, "/tmp", Some(&app))
        .await
        .expect("8 KiB prompt must pass the argv guard");
    assert_eq!(cli.recorded_calls().len(), 1);
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd src-tauri && cargo nextest run --package lucode --lib domains::terminal::tmux_cmd::tests::new_session_detached_rejects_oversize_argv_without_calling_tmux --no-fail-fast 2>&1 | tail -30
```
Expected: test panics because the mock's `panic!("tmux must not be called ...")` fires — tmux is being called despite the huge prompt.

**Step 3: Wire the guard into `new_session_detached`**

In `src-tauri/src/domains/terminal/tmux_cmd.rs`, inside the `async fn new_session_detached` body, immediately after `let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();` (currently line 109) and BEFORE `let out = self.run(&arg_refs).await?;`, insert:

```rust
        check_argv_size(&args)?;
```

So the block becomes:

```rust
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        check_argv_size(&args)?;
        let out = self.run(&arg_refs).await?;
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd src-tauri && cargo nextest run --package lucode --lib domains::terminal::tmux_cmd --no-fail-fast 2>&1 | tail -60
```
Expected: all three new tests pass, plus every existing test in the module (including `new_session_detached_emits_expected_argv` and `new_session_detached_includes_env_and_command_after_double_dash`) still passes.

**Step 5: Commit**

```bash
git add src-tauri/src/domains/terminal/tmux_cmd.rs
git commit -m "feat(terminal): fail fast when agent argv would exceed tmux/execve limit"
```

---

## Task 3: Document the new behavior in CHANGES.md

**Files:**
- Modify: `CHANGES.md` (insert a new entry at the top, just below the header on line 3)

**Step 1: Add the entry**

Insert this block between `## Consolidation: surface candidate verdict immediately` (the current first entry) and the header:

```markdown
## Terminal: fail fast when agent argv would overflow tmux/execve

Launching an agent with an enormous `initial_prompt` used to surface an opaque "tmux new-session failed (status 1): command too long" unhandled promise rejection — Claude, Codex, Gemini, OpenCode, Amp, Kilocode, and Qwen all inline the prompt as an argv entry, and once the total argv exceeds the OS `ARG_MAX`, tmux refuses to spawn the session. Lucode now measures the argv size before handing it to tmux and raises a Lucode-branded error when it would exceed a 500 KB safety limit.

- `TmuxCli::new_session_detached` in `src-tauri/src/domains/terminal/tmux_cmd.rs` sums the byte length of every argv entry (including `-e KEY=VAL` env pass-throughs) before invoking tmux. If the total exceeds `TMUX_ARGV_SOFT_LIMIT_BYTES = 500_000`, the method returns a clear error naming Lucode, the measured size, and the limit, instead of letting tmux fail with "command too long".
- The guard sits at the single point every agent launch goes through, so it applies to both the first-launch path and `force_restart=true` without per-agent plumbing, and to Claude/Codex/Gemini/OpenCode/Amp/Kilocode/Qwen identically. Droid already avoids argv inlining and is unaffected.
- The error propagates through the existing `create_terminal_with_app_and_size` → `inject_terminal_error` path, so users see the explanation inside the agent pane. This is deliberately fail-fast: no temp-file/stdin fallback is introduced — the goal is to replace the unhandled rejection with a diagnosable error, and gather telemetry on how often it fires before deciding on any further recovery strategy.
- Covered by new unit tests in `tmux_cmd.rs`: the guard rejects oversize argv without calling tmux, counts env-var bytes toward the total, and lets realistic 8 KiB prompts through unchanged.
```

**Step 2: Commit**

```bash
git add CHANGES.md
git commit -m "docs(changes): describe tmux argv overflow guard"
```

---

## Task 4: Full validation sweep

**Step 1: Run the full project validation**

Run from the repo root:
```bash
just test
```

Expected: all TypeScript lint/type-checks pass, all Rust clippy passes, all Rust tests pass (including the three new ones), `cargo shear` and `knip` report nothing new.

If anything fails, fix the root cause before continuing. Do NOT suppress warnings or add allow attributes.

**Step 2: Squash the three commits into a single feature commit**

Inspect the short log:
```bash
git log --oneline -5
```

Expected to see the three commits made above plus `e9040805 feat(consolidation): …` below them.

Squash them with:
```bash
git reset --soft HEAD~3
git commit -m "$(cat <<'EOF'
feat(terminal): fail fast when agent argv would exceed tmux/execve

Agents that inline `initial_prompt` as an argv entry (Claude, Codex,
Gemini, OpenCode, Amp, Kilocode, Qwen) used to surface an opaque
"tmux new-session failed (status 1): command too long" unhandled
promise rejection when the prompt pushed the argv over the OS
`ARG_MAX` ceiling. `TmuxCli::new_session_detached` now measures the
argv byte count (including `-e KEY=VAL` env pass-throughs) and
returns a Lucode-branded error before invoking tmux when the total
exceeds 500 KB.

The guard sits at the single launch chokepoint, so it covers both
the first-launch path and `force_restart=true` for every inlining
agent without per-agent plumbing. The existing
`create_terminal_with_app_and_size` → `inject_terminal_error` path
renders the error inside the agent pane. No temp-file/stdin fallback
is introduced — the goal is to replace the unhandled rejection with
a diagnosable error and gather telemetry on real-world frequency
before picking a further recovery strategy.
EOF
)"
```

**Step 3: Confirm the final state**

Run:
```bash
git log --oneline -3
git status
```

Expected: the new commit sits on top of `e9040805`, working tree is clean.

Then rerun `just test` one final time to confirm the squashed tree is green.
