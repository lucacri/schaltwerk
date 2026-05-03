# Cutover-day risks — task-flow v2 against production data

**Audience:** Luca, on cutover day, making the call between (a) running v2 as a sidecar build alongside production v1, vs. (b) merging v2 to main and running the unflavored build against existing v1 data.

**Source-of-truth refs:**
- Flavor helpers: `src-tauri/src/shared/app_paths.rs:50-95` (`flavored()`, `app_support_dir()`, `project_data_dir()`).
- Sidecar install path: `justfile:394-451` (`dev-install`).
- Post-merge runbook: `plans/2026-05-03-post-merge-runbook.md`.
- Migration that physically drops legacy columns: `src-tauri/src/infrastructure/database/migrations/v2_drop_session_legacy_columns.rs`.
- W.5 GAP 4 invisibility pin: `src/components/sidebar/Sidebar.test.tsx:146-160`.

**Two scenarios** drive almost every risk's severity:

- **Scenario A — sidecar:** `just dev-install taskflow-v2`. Bundle id `com.lucacri.lucode-taskflow-v2`. Tauri-resolved `app_config_dir()` → flavored. `project_data_dir()` → flavored. v1 keeps running at `/Applications/Lucode.app` against `~/Library/Application Support/com.lucacri.lucode/` and `~/Library/Application Support/lucode/projects/`. **Important:** v2 sidecar starts with empty data dirs — it does NOT see v1's projects, sessions, or specs unless the user manually copies the project DBs across. The "v2 against production data" framing in this audit applies cleanly only to Scenario B; in Scenario A the risks are runtime-collision-only (shared tmux socket, MCP port, recents/log files).
- **Scenario B — post-merge replacement:** `git merge` per runbook §2, then `just install` (no flavor). Bundle id reverts to `com.lucacri.lucode`. Single binary, single dataset. v1's app at `/Applications/Lucode.app` is supplanted but its old binary may still launch if not removed. **This is where v2 is reading and migrating the real production DBs.**

Each risk is annotated with severity per scenario.

---

## 1. LUCODE_FLAVOR isolation completeness

**Findings:**

| Path / module | Flavor-aware? | Evidence |
|---|---|---|
| Per-project sessions DB | YES (Scenario A) | `src-tauri/src/project_manager.rs:115` routes through `app_paths::project_data_dir()`. |
| Settings (`settings.json`) | YES (Scenario A) | `src-tauri/src/infrastructure/config/settings.rs:27-30` uses `app_handle.path().app_config_dir()`, which Tauri resolves from `tauri.conf.json#identifier`. `dev-install` (`justfile:427`) writes a flavored identifier into the conf, so the bundle gets its own config dir. |
| `tmux.conf` | YES (Scenario A) | `app_paths::tmux_conf_path()` (`shared/app_paths.rs:98-100`) joins onto `app_support_dir()`. |
| **Project history (`project_history.json`, `open_tabs.json`)** | **NO** | `src-tauri/src/projects.rs:47-52, 122-126` calls `dirs::config_dir().join("lucode")` directly, bypassing `app_paths`. On macOS this is `~/Library/Application Support/lucode/`, identical for v1 and v2 sidecar. Recents list and last-open-tabs are shared. |
| **Log directory** | **NO** | `src-tauri/src/infrastructure/logging/mod.rs:41-46` uses `dirs::data_local_dir().join("lucode").join("logs")`. On macOS this resolves to `~/Library/Application Support/lucode/logs/` regardless of flavor. v1 and v2 sidecar write to the same dir; per-launch timestamped filenames keep individual files separated, but retention sweeps are shared-state. |
| **MCP webhook port** | **NO** | `src-tauri/src/main.rs:778-787`: `calculate_project_port(project_path)` hashes only `project_path`. v1 and v2 sidecar derive the same port for the same project. The runtime has fallback-port retry on bind failure, but the port the MCP server announces to the client is fixed; if v1 holds it, v2 silently fails to claim its expected port (or vice versa) and the MCP bridge talks to the wrong app. |
| **tmux socket prefix** | **NO** | `src-tauri/src/domains/terminal/manager.rs:20`: `const TMUX_SOCKET_PREFIX: &str = "lucode-v2-";`. The same prefix lives on `origin/main` (verified by reading `git show origin/main:src-tauri/src/domains/terminal/manager.rs`). Same project_path → same `project_hash16` → same socket name → both apps connect to the same tmux server. Cross-contamination of terminal state between v1 and v2 sidecar. |
| Permissions module | macOS-Tauri-aligned | `src-tauri/src/permissions.rs:8` hardcodes `com.lucacri.lucode` for TCC permission queries. NOT flavor-aware, but TCC's grant key uses the actual running bundle id, so a flavored bundle would query the wrong key — symptom: re-prompt for screen-recording / accessibility permissions on the sidecar. Cosmetic, not data-corrupting. |

**Severity:**
- Scenario A: HIGH — MCP port collision and tmux socket sharing are the two real correctness risks. Flavor was added for data isolation but not extended to runtime ports/sockets.
- Scenario B: not applicable — single binary, no v1 to share with.

**Mitigation (Scenario A):** documented user-side workarounds. See §11 below. No pre-merge code change blocks cutover; these are sidecar-coexistence issues only.

---

## 2. Settings file compatibility

**v2 reads v1's settings.json safely.**

- `src-tauri/src/infrastructure/config/settings.rs:43-58`: load path catches deserialization failure with `serde_json::from_value::<Settings>(value).unwrap_or_default()` plus an outer `unwrap_or_else(|_| Settings::default())`. Permissive.
- Diff against `origin/main` (`git diff origin/main..HEAD -- src-tauri/src/domains/settings/`): all new fields use `#[serde(default)]`. The `AttentionNotificationMode` default changed from `Dock` to `Both` (`src-tauri/src/domains/settings/types.rs:163-178`) — semantic, not breaking.
- Forward direction (v1 reads v2-saved settings): v1 also has `#[serde(default)]` on its known fields, and unknown fields are silently dropped (default serde behavior is to ignore extras). Confirmed by inspecting `Settings` struct shape on both sides.

**Severity:** none / verified.

**Caveat (Scenario B only):** if the user later rolls back to a v1 binary (e.g. via `git revert -m 1` per runbook §10a) and v2 has saved settings with new fields, those fields are dropped on next v1 save — not corrupting, but the user loses v2-only config (e.g. `consolidation_judge_agent`, new prompt templates). Document this in the rollback section of the runbook.

---

## 3. MCP server port collision

**`src-tauri/src/main.rs:778-787`:**
```rust
fn calculate_project_port(project_path: &str) -> u16 {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    ...
    8547 + port_offset
}
```

`LUCODE_FLAVOR` does not enter the hash. v1 and v2 sidecar opening the same project derive the exact same port.

The bind path (`find_available_port` higher up in `main.rs`) probes incrementally on collision, so the v2 sidecar will get a different actual port — but the port number embedded in the project's MCP discovery (the bridge in `mcp-server/src/lucode-bridge.ts:462,494` probes `8547+offset`) talks to whoever bound first. **External MCP tools will hit whichever app started first**, with no way to disambiguate.

**Severity:**
- Scenario A: HIGH. External MCP-driven workflows (Codex, Factory, anything using `mcp__lucode__*`) target the wrong app.
- Scenario B: not applicable.

**Mitigation:** runbook addition — "do not run v1 and v2 sidecar against the same project simultaneously." If sidecar coexistence is needed, open different projects in each. Code fix (post-merge): include `dev_flavor()` in the port hash. Out of scope for cutover-day.

---

## 4. Forge auth/cache sharing (gh CLI)

`gh` configuration lives in `~/.config/gh/` and is process-global. Lucode does not maintain its own gh credential cache: searched `domains/git/github_cli.rs` for `gh auth`, `gh config`, `GH_TOKEN` — only invocations of the `gh` binary, no internal token store.

**Severity:** none / verified. v1 and v2 share the same gh login state. This is intentional and harmless.

---

## 5. Production Lucode running while v2 dev runs (Scenario A)

**Verified shared/isolated resources:**

| Resource | Shared or isolated | Notes |
|---|---|---|
| Tauri socket file | isolated by bundle id | sidecar uses `com.lucacri.lucode-taskflow-v2`. |
| LaunchAgent / launchctl | not used | `grep -rn "launchctl\|LaunchAgent\|launchd" --include="*.rs"` returns only one comment in `domains/terminal/local.rs:1719` about init reaping zombies. No registered services. |
| **tmux socket (`/tmp/tmux-{uid}/lucode-v2-{hash}`)** | **shared** | See §1. |
| **MCP webhook port** | **shared** | See §3. |
| Permissions / TCC | per-bundle | sidecar will re-prompt for screen recording / accessibility, but no overlap. |
| **Log directory** | **shared dir, isolated files** | See §1; per-launch timestamped filenames don't collide, but retention sweep walks the shared dir. |

**Severity:**
- Scenario A: HIGH (subsumed by §1 and §3 — same root cause: incomplete flavor coverage).
- Scenario B: not applicable.

---

## 6. Orphaned v1 worktrees in user's repo

**`cleanup_orphaned_worktrees` (`src-tauri/src/domains/sessions/utils.rs:194-242`)** acts on a worktree path only when:

1. `git::list_worktrees(&self.repo_path)` returns it (i.e., it is git-registered for that repo).
2. It lives under a managed base — the default `.lucode/worktrees/` or the user's custom base (via `managed_worktree_bases`, `utils.rs:244-258`).
3. No non-spec session in `db_manager.list_sessions()` claims that worktree path.

**v1 sessions are still rows in the v2 DB after migration** (the migration drops only the legacy `status` / `session_state` columns; rows are preserved verbatim). `list_sessions` (`src-tauri/src/domains/sessions/db_sessions.rs:624-653`) reads ALL rows for the repo — there is no v1/v2 filter at the DB layer; the W.5 GAP 4 invisibility is sidebar-only (`src/components/sidebar/Sidebar.test.tsx:146-160`).

**Therefore**: as long as the v1 session rows are still in the DB, their worktrees are protected from cleanup. The risk surface narrows to:

- User runs runbook §7 Option B (surgical wipe) — DB rows deleted, worktree dirs remain. Next v2 reconcile will sweep those orphaned worktree directories. **Expected behavior, intentional.** Document this in §7 of the runbook so the user isn't surprised to lose worktree dirs.
- User manually deletes a session row in the DB but leaves the worktree on disk. Same result. Edge case.

**Severity:** LOW. The cleanup is correctly scoped to git-registered worktrees inside managed bases; it cannot touch random user files outside `.lucode/worktrees/`.

---

## 7. Database migrations — forward and backward compatibility

**Forward (v2 opens v1 DB):** verified safe. `apply_sessions_migrations` and `apply_tasks_migrations` are idempotent; the migration chain has end-to-end test coverage at `src-tauri/src/infrastructure/database/migrations/v2_drop_session_legacy_columns.rs:445-504` (`end_to_end_v1_shape_db_migrates_and_reads_correctly`) plus `src-tauri/tests/e2e_legacy_migration_then_read.rs`.

**Backward (v1 opens a v2-touched DB): UNSAFE.**

`v2_drop_session_legacy_columns` (`src-tauri/src/infrastructure/database/migrations/v2_drop_session_legacy_columns.rs:72-179`) physically rebuilds the `sessions` table to remove `status` and `session_state` columns:

```rust
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
```

A v1 binary subsequently selecting `status` or `session_state` from this DB will hard-fail (SQLite "no such column"). **Confirmed:** `git show origin/main:src-tauri/src/domains/sessions/db_sessions.rs` shows v1 SELECTs explicitly name those columns (e.g., the `Session` struct hydration path reads `status: SessionStatus, session_state: SessionState` as required fields, and the INSERT/UPDATE statements list them by name). v1 does NOT use `SELECT *`. v1 cannot reopen a project after v2 has touched it.

The original values are preserved in `sessions_v2_status_archive` for forensics, but **no automated mechanism reconstructs the v1 `sessions` shape**. Recovery requires restoring a `.bak` file.

**Severity:**
- Scenario A: CRITICAL — if the user opens a project in v2 sidecar, then later returns to v1 for that project, v1 fails to load it.
- Scenario B: CRITICAL — if the user `git revert`s the merge per runbook §10a after v2 has run, the running v1 binary cannot reopen any project v2 has migrated. Rollback as currently documented in the runbook is **lossier than implied**.

**Mitigation:** runbook MUST tell the user to back up project DBs **before first v2 open**, not after — the post-merge runbook §7 Option A currently sequences the archive *after* cutover, which is too late if rollback is desired. See §11 below.

---

## 8. Project tab persistence

`OpenTabsState` (`src-tauri/src/projects.rs:95-126`) — fields `tabs: Vec<String>`, `active: Option<String>`. Diff vs `origin/main` (`git diff origin/main..HEAD -- src-tauri/src/projects.rs`) shows only a stylistic change to `get_recent_projects`'s sort. **Schema unchanged.**

Path `~/Library/Application Support/lucode/open_tabs.json` and `~/Library/Application Support/lucode/project_history.json` are **NOT flavor-aware** (see §1). v1 and v2 sidecar share these files.

**Severity:**
- Scenario A: MEDIUM. Recents-list cross-talk: opening a project in v2 sidecar updates the same list v1 reads. Last-active tab on next v1 launch may point at something v2 opened. Annoying, not corrupting.
- Scenario B: not applicable (single binary).

---

## 9. Log file sharing

Path: `~/Library/Application Support/lucode/logs/lucode-{timestamp}.log` (`infrastructure/logging/mod.rs:41-66`). Not flavor-aware. v1 and v2 sidecar:
- Write to the same directory.
- Use timestamped filenames, so individual log files don't collide.
- Share the retention sweep (`DEFAULT_RETENTION_HOURS: u64 = 72`); a v2 launch's sweep can prune v1's logs older than 72h, and vice versa.

**Severity:**
- Scenario A: LOW. Files don't collide, sweeping is symmetric. Mildly confusing when forensicizing.
- Scenario B: none — single binary.

---

## 10. Other shared resources checked

- **Named system services:** none registered (`grep launchctl|LaunchAgent|launchd` finds only one comment in unrelated context).
- **Tauri identifier collision:** isolated by flavor in Scenario A (verified — `dev-install` rewrites `tauri.conf.json#identifier`).
- **PTY spawning:** local PTY backend has no global names. tmux backend is the shared-state risk (§1).
- **gh / git credentials:** OS-global (`~/.config/gh/`, `~/.ssh/`). Intentionally shared. No Lucode-side cache.
- **`#[serde(default)]` coverage on `Settings`:** verified across all additive fields.

---

## 11. Cutover-day recommendations

**Order matters.** Each step assumes everything above completed cleanly.

### Pre-cutover (do these BEFORE first v2 open against production data)

1. **Back up every project DB** the user cares about. **This is the rollback story** — once v2 runs migrations, v1 cannot reopen those DBs (§7).
   ```bash
   cd ~/Library/Application\ Support/lucode/projects
   for d in */; do
     cp "$d/sessions.db" "$d/sessions.db.pre-v2-$(date +%Y%m%d).bak"
   done
   ```
   This produces a per-project snapshot in the same dir. Verify the count of `.bak` files matches the count of project subdirs.

2. **Decide your scenario.**
   - **Scenario A (sidecar coexistence):** continue with §11.A.
   - **Scenario B (post-merge replacement):** continue with §11.B.

### 11.A — Sidecar coexistence (Scenario A)

1. **Shut down production v1 Lucode** before launching v2 sidecar against any project v1 has open. Even briefly running both against the same project triggers:
   - tmux socket sharing (§1) — terminal cross-contamination.
   - MCP port collision (§3) — external MCP tools talk to the wrong app.

2. **If you must run both simultaneously:** make sure they target different projects. Open project A in v1, project B in v2 sidecar. Different `project_path` → different tmux socket and MCP port.

3. **Permissions re-prompt** is expected on first v2 sidecar launch (screen recording, accessibility). Grant once.

4. **Recents list cross-talk** is expected (§8). Opening project A in v2 sidecar will appear in v1's recents next launch. Cosmetic.

### 11.B — Post-merge replacement (Scenario B)

1. Follow `plans/2026-05-03-post-merge-runbook.md` §1–§2 (smoke check, merge to main, push).

2. **Before installing the new build to `/Applications/Lucode.app`:** quit the running v1 Lucode and confirm the process is gone (`pgrep -fl Lucode`). Sharing the bundle install path while the old binary is running can corrupt the install.

3. **The first v2 launch will run migrations on every project DB** the user opens. This is the irreversible step (§7). Confirm step §11.0 (DB backups) was done before opening any project.

4. **If rollback is required (`git revert -m 1` per runbook §10a):** the running v1 binary will still fail to open v2-migrated DBs. Recovery requires restoring `.bak` files per project from §11.0:
   ```bash
   cd ~/Library/Application\ Support/lucode/projects/<hash>
   mv sessions.db sessions.db.v2-corrupt
   cp sessions.db.pre-v2-YYYYMMDD.bak sessions.db
   ```

### 11.C — Amendments to the post-merge runbook

The current runbook (`plans/2026-05-03-post-merge-runbook.md`) should be amended:

1. **§1 (Pre-merge sanity check)** — add step 5: "Back up every per-project `sessions.db` before merging. Once v2 runs, v1 cannot reopen these DBs." Reference §7 of this risk audit. Per-project backup snippet from §11.0 above.

2. **§7 (Production data cutover)** — flip the ordering note. Currently reads "no urgency"; this is true for sidebar visibility but **not** for rollback safety. Add: "Option A (archive) is recommended *before first v2 open* if rollback is a possible outcome. Running v2 once is irreversible without `.bak` files." Reference §7 of this risk audit.

3. **§10 (Rollback recipes)** — add a §10e for "Rolled back the code but cannot reopen a project." Tell the user where the `.bak` files live and how to restore.

4. **New §11 (or appendix)** — "If you choose Scenario A (sidecar coexistence) instead of merging immediately": copy §11.A here so the user has both paths in one runbook. The current runbook only covers the merge-to-main path.

---

## 12. Severity counts

Each finding is counted once; §1 is the umbrella diagnosis whose distinct failure modes are §3 (MCP port) and §5 (tmux socket), and whose secondary symptoms are §8 (recents file) and §9 (log dir).

- **Critical:** 1 — §7, irreversible v1 incompatibility after v2 migrations; equally critical in both scenarios.
- **High:** 2 — §3 (MCP port collision, Scenario A); §5 (tmux socket sharing, Scenario A).
- **Medium:** 1 — §8 (recents-list / open-tabs cross-talk, Scenario A).
- **Low / verified:** 6 — §2 (settings serde permissive, verified); §4 (gh auth shared by design, verified); §6 (cleanup scope safe, verified); §9 (log dir shared but per-launch files don't collide); §10 (no LaunchAgents / global services, verified); permissions re-prompt on first sidecar launch (cosmetic).

**Tally:** 1 critical, 2 high, 1 medium, 6 low/verified.

**Code change required pre-merge:** none. All risks are addressable via runbook amendments and user-side workflow constraints.

**Code change recommended post-merge** (separate task, lower priority):
- Include `dev_flavor()` in `calculate_project_port` (§3).
- Include `dev_flavor()` in the tmux socket prefix (§1).
- Route `projects.rs` through `app_paths` to flavor-isolate `project_history.json` and `open_tabs.json` (§8).
- Route the log directory through `app_paths::app_support_dir().join("logs")` (§9).

These are all Scenario-A-only issues; Scenario B does not need them.
