# Persist Spec Review Comments — Design

## Problem

Spec review comments live only in React `useState` inside `SpecEditor.tsx`. They are wiped on every exit path (Escape, Cancel Review, Exit button, successful Finish Review, session switch, crash, reload). If the review is not delivered, the user loses all of their work with no recovery path.

## Goal

Persist a spec's review comments to the per-project database so they survive every exit path — including a successful Finish Review. The stored draft is only discarded through an explicit user choice the next time review mode is opened.

## Scope

- Persist per-spec review comments across all exits.
- On review re-entry, detect stored drafts and prompt Clear vs Continue.
- No new edit/delete UX, no cross-spec features, no versioning/history.

## Data Model

New table `spec_review_comments` in `sessions.db` (per-project), created alongside `specs`:

```sql
CREATE TABLE IF NOT EXISTS spec_review_comments (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    selected_text TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(spec_id) REFERENCES specs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spec_review_comments_spec ON spec_review_comments(spec_id, created_at);
```

Notes:
- `spec_id` matches `specs.id` (UUID-ish string). The frontend addresses specs by `session_name`; the backend resolves name → id as other spec commands already do.
- `id` is the client-generated UUID from the existing `SpecReviewComment.id` so tests can round-trip it.
- Cascade-delete keeps us clean if a spec is deleted.

## Backend

### 1. Schema (`db_schema.rs`)
- Create table + index inside `initialize_schema`.
- Add an idempotent migration helper.

### 2. Repo methods (`db_spec_review_comments.rs` — new file)
A fresh module alongside `db_specs.rs`:

```rust
pub struct PersistedSpecReviewComment {
    pub id: String,
    pub spec_id: String,
    pub line_start: i64,
    pub line_end: i64,
    pub selected_text: String,
    pub comment: String,
    pub created_at: i64,
}

pub trait SpecReviewCommentMethods {
    fn list_spec_review_comments(&self, spec_id: &str) -> Result<Vec<PersistedSpecReviewComment>>;
    fn replace_spec_review_comments(&self, spec_id: &str, comments: &[PersistedSpecReviewComment]) -> Result<()>;
    fn clear_spec_review_comments(&self, spec_id: &str) -> Result<()>;
}
```

`replace_spec_review_comments` wraps a transaction: `DELETE WHERE spec_id = ?` followed by batch `INSERT`. Using a full replace keeps the API small and avoids reconciling deltas on every autosave — the list is short (handful of comments) and the write is cheap.

### 3. Service layer (`domains/sessions/service.rs`)
Extend `SessionManager`:

```rust
pub fn list_spec_review_comments(&self, spec_name: &str) -> Result<Vec<PersistedSpecReviewComment>>;
pub fn save_spec_review_comments(&self, spec_name: &str, comments: &[PersistedSpecReviewComment]) -> Result<()>;
pub fn clear_spec_review_comments(&self, spec_name: &str) -> Result<()>;
```

Each resolves `spec_name -> spec.id` via the existing `get_spec_by_name`, then delegates to the repo.

### 4. Tauri commands (`commands/schaltwerk_core.rs`)
Three new commands, project-scoped like `schaltwerk_core_get_spec`:

- `schaltwerk_core_list_spec_review_comments(name, project_path?) -> Vec<PersistedSpecReviewComment>`
- `schaltwerk_core_save_spec_review_comments(name, comments, project_path?) -> ()`
- `schaltwerk_core_clear_spec_review_comments(name, project_path?) -> ()`

Register in `main.rs` invoke handler and `commands/mod.rs` pub-use list. Add enum entries in `src/common/tauriCommands.ts`.

### 5. Events
No new event kinds — this is per-spec local state, only the editor cares. Avoid bumping global sessions-refreshed on every write.

## Frontend

### 1. Types
Extend `src/types/specReview.ts` to keep the existing shape; add a serializer to the persisted shape (snake_case + i64 timestamps).

### 2. Persistence hook (`src/hooks/useSpecReviewCommentStore.ts` — new)
Wraps the three Tauri commands, returning:
```ts
{
  load(): Promise<SpecReviewComment[]>
  save(comments: SpecReviewComment[]): Promise<void>
  clear(): Promise<void>
}
```
Scoped by `sessionName` + `projectPath` (follow the `projectPath ? { projectPath } : {}` pattern used elsewhere in `SpecEditor`).

### 3. `SpecEditor.tsx` integration

- **On entering review mode (`handleEnterReviewMode`)**:
  - Call `store.load()`.
  - If the result is non-empty: open a modal with two actions — **Clear** (calls `store.clear()`, resets local state, enters review with empty comments) and **Continue** (hydrates `reviewComments` with the loaded list, enters review).
  - If empty: enter review with empty comments (current behavior).
- **On `handleSubmitComment`**: after pushing into local state, call `store.save(next)`. This keeps the DB the source of truth on every add; if the app crashes between add and next action, the comment survives.
- **On `handleFinishReview`**: after the paste succeeds, **do not** call `clear`. Just reset local state and exit.
- **On `handleExitReviewMode` (button, Escape, Cancel Review)**: **do not** call `clear`. Reset local state only.
- **Prompt UI**: a lightweight modal — headline "Continue your pending review?", body "You have N stored comments for this spec.", buttons **Clear & start fresh** / **Continue**.

### 4. i18n
Add 4 new `specEditor` keys:
- `resumeReviewTitle`
- `resumeReviewMessage` (with `{count}` placeholder)
- `resumeReviewContinue`
- `resumeReviewClear`

Only `en` and `zh` locales currently exist; both are updated.

## Testing

### Rust
- `db_spec_review_comments` tests: insert, list, replace (dedup / overwrite), clear, cascade-on-spec-delete.
- Schema tests: table + index created idempotently.
- Service tests: resolve-by-name wiring, returns stored rows, empty for unknown spec.

### Frontend (Vitest)
- `SpecEditor`:
  - Entering review mode when DB is empty shows no prompt and starts empty.
  - Entering review mode when DB has comments shows the prompt. **Clear** calls `clear` and starts empty. **Continue** hydrates the list.
  - Submitting a comment persists via `save`.
  - Exiting via Cancel Review, Escape, Exit Review button, and Finish Review all leave `clear` uncalled.
- `useSpecReviewCommentStore`: maps the invoke payloads correctly.

## Migration / Rollout

- New table only; no column changes on existing tables.
- Idempotent migration — reinstalling an older build just ignores the table.

## Out of Scope

- Editing or deleting individual stored comments.
- Snapshotting spec content at comment time beyond the existing `selectedText`.
- Multi-machine sync.
