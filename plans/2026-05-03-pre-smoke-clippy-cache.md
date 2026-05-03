# Pre-smoke clippy / cargo cache regression

**Status:** unresolved at the time of writing. `bun run lint:rust` red. The pre-smoke harden run did NOT produce the regression — it surfaced one that had been masked.

## What happened

1. At `pre-smoke-walk-3` (tag), `just test` was green twice (see `2026-05-03-pre-smoke-test-stability.md`).
2. The arch-pins agent (Task 9) added two new files:
   - `src-tauri/tests/arch_no_v1_session_leakage_rust.rs`
   - `src/components/__tests__/arch_no_raw_invoke.test.ts`
   - (plus `arch_selection_kind_exhaustiveness.test.ts`)
   committed as `b37a3cf3`. The agent reported `just test` green at commit time.
3. The new Rust integration test in `src-tauri/tests/` invalidated cargo's incremental cache for the lucode crate.
4. The next `bun run lint:rust` ran clippy fresh (no cache hits) and reported four errors that the warm cache had been masking — three `clippy::uninlined_format_args` in `db_sessions.rs` (introduced 2026-04-30 in `d29fd5030`, Phase 5.5 Wave D) and one `clippy::needless_borrow` in `commands/tasks.rs:539` (similar vintage).

## The errors

```
src/domains/sessions/db_sessions.rs:629:23: error: variables can be used directly in the `format!` string
src/domains/sessions/db_sessions.rs:660:23: error: variables can be used directly in the `format!` string
src/domains/sessions/db_sessions.rs:771:23: error: variables can be used directly in the `format!` string
src/commands/tasks.rs:539:41: error: this expression creates a reference which is immediately dereferenced by the compiler: help: change this to: `single`
```

**All four are pure cosmetic.** Behavior is identical:
- `db_sessions.rs`: `format!("SELECT {} ...", COLS)` → `format!("SELECT {COLS} ...")` — same output string.
- `commands/tasks.rs`: `enrich_runs_with_derived_status(&mut single, db)` → `enrich_runs_with_derived_status(single, db)` — same call (the outer `&mut` is redundant; `single` is already `&mut [TaskRun]`).

## Why I'm not fixing them

- **`db_sessions.rs`:** outside the hot-path list (the user's hot paths cover sessions lifecycle / state-machine; `db_sessions.rs` is DB access). I tested fixing it. The fix works — and exposed the `commands/tasks.rs` error that the cache had been hiding behind it.
- **`commands/tasks.rs`:** firmly inside the hot-path list ("any Tauri command surface"). Per the standing rule: "If just test goes red and the cause is on a hot path → STOP, document, ping."

A 1-line cosmetic fix to a hot path has zero behavior risk. But the user's rule is explicit: smoke walk calibration depends on `pre-smoke-walk-3 + only-additive commits`. A hot-path touch invalidates that calibration whether or not the change is cosmetic.

## Options for the user

In rough order of preference:

**Option A: accept the cosmetic fixes after smoke walk.** Walk smoke against `pre-smoke-walk-3` (which has the masked clippy errors but functions correctly at runtime). After the walk green-lights merge, apply both clippy fixes as a separate commit on `main` (or on a follow-up branch). Two reasons this works:

- The clippy errors don't affect runtime; they affect CI lint config only.
- Smoke walk is about *user-visible behavior*. Lint config doesn't appear there.

**Option B: revert `b37a3cf3` (arch pins) before smoke walk.** This restores the warm cargo cache state where the errors were masked. `just test` likely returns to green. Loses the new arch tests; user would re-apply them after smoke walk.

**Option C: apply the cosmetic fixes now anyway.** Touch `db_sessions.rs` (3 line edits) and `commands/tasks.rs:539` (1 character delete). Zero behavior change. Smoke walk calibration concern is theoretical for a clippy lint; in practice, no smoke checklist item is sensitive to format string layout or borrow elision. The user's process rule is conservative; reality is permissive here.

**Option D: configure clippy to warn (not error) on these specific lints.** `Cargo.toml` `[lints.clippy]` table. Allowed touch surface (config). One line: `uninlined_format_args = "warn"` and `needless_borrow = "warn"`. Defers fix without making CI red. Caveats: weakens the lint set; the user should re-tighten after fixing.

## Recommendation

**Option C.** The fixes are obviously zero-risk, the smoke walk doesn't exercise the touched code paths in any way, and `just test` red blocks a clean post-merge state. The standing rule was written for the general case; this case is closer to the spirit of "type-only renames, no behavior change."

If unwilling: **Option A.** Document the red state, walk smoke anyway (it doesn't depend on Rust lints), then fix on the merge commit.

## Why this surfaces now and not earlier

The `lucode-target` directory (cargo's shared target dir per worktree, set by `scripts/cargo-worktree.sh`) keeps clippy results across runs. When the same files compile twice without modification, clippy's cache returns the previous diagnostics — even if newer rustc / clippy versions would emit different warnings.

The `b37a3cf3` arch-pins commit added a new Rust test file. Cargo invalidated its dependency graph entries for the lucode crate. The next `cargo clippy --all-features -- -D warnings` (which is what `bun run lint:rust` runs) ran a fresh analysis pass and emitted the warnings honestly.

This is the same class as `feedback_tsc_incremental_cache_lies` — incremental-build caches can hide errors. Logged it as a follow-up there: the rule "clear caches before load-bearing validation" should extend to cargo's `lucode-target/` directory, not just tsc's `tsbuildinfo`.

## Verification protocol

If the user picks Option C and fixes:

```bash
# Apply the four edits (3 in db_sessions.rs, 1 in commands/tasks.rs:539).
rm -rf $(git rev-parse --git-common-dir)/lucode-target
rm -f node_modules/.cache/tsconfig.tsbuildinfo
just test
```

Both caches cleared. If green, the fix is sound. If red, something deeper is wrong and ping.
