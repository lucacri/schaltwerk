# GitLab Integration Design

## Overview

Add self-hosted GitLab integration to Schaltwerk, mirroring the existing GitHub integration pattern. Wraps the `glab` CLI tool. Supports multiple GitLab project sources per Schaltwerk project (e.g., a public issues repo and a private monorepo), with full MR lifecycle management.

## Architecture

**Approach:** Mirror the GitHub pattern — `glab` CLI wrapper in Rust, Tauri commands, React hook + Jotai atoms, right-panel UI tabs.

## Backend

### `src-tauri/src/domains/git/gitlab_cli.rs`

Wraps `glab` CLI via `GitLabCli<R: CommandRunner>`.

**Types:**
- `GitLabAuthStatus` — `authenticated: bool, user_login: Option<String>`
- `GitLabProjectInfo` — `path_with_namespace, default_branch, web_url`
- `GitLabIssueSummary` — `iid, title, state, labels, author, assignees, web_url, created_at, updated_at`
- `GitLabIssueDetails` — full issue + `description`, `comments: Vec<GitLabIssueComment>`, `related_mrs`
- `GitLabMrSummary` — `iid, title, state, source_branch, target_branch, author, labels, pipeline_status, approvals_required, approvals_given, web_url`
- `GitLabMrDetails` — full MR + `description`, `comments`, `reviewers`, `diff_stats`, `pipeline`
- `GitLabPipelineStatus` — `running | success | failed | canceled | pending`
- `GitLabMrReview` — approval info
- `GitLabCliError` — error enum

**Methods:**
- `ensure_installed()` — checks `glab` exists
- `auth_status(hostname?)` — `glab auth status`
- `view_project(path)` — project metadata
- `search_issues(project, query?, state?)` — `glab issue list`
- `get_issue_details(project, iid)` — `glab issue view`
- `search_mrs(project, query?, state?)` — `glab mr list`
- `get_mr_details(project, iid)` — `glab mr view`
- `get_mr_pipeline_status(project, iid)` — head pipeline status for an MR
- `create_mr(project, source, target, title, description)` — `glab mr create`
- `approve_mr(project, iid)` — `glab mr approve`
- `merge_mr(project, iid, squash?)` — `glab mr merge`
- `add_mr_comment(project, iid, body)` — `glab mr note`

### `src-tauri/src/commands/gitlab.rs`

**Configuration model** (stored in SQLite per project):

```
ProjectGitlabConfig {
    hostname: String,              // e.g. "gitlab.yourcompany.com"
    sources: Vec<GitLabSource>
}

GitLabSource {
    project_path: String,  // e.g. "group/issues-repo"
    label: String,         // e.g. "Public Issues", "Monorepo"
    features: Vec<Feature> // [Issues, MRs, Pipelines]
}
```

**Tauri commands:**
- `gitlab_get_status()` → installed, authenticated, configured sources
- `gitlab_authenticate()` → triggers `glab auth login`, emits `GitLabStatusChanged`
- `gitlab_configure_project(sources)` → saves config to DB, emits `GitLabStatusChanged`
- `gitlab_search_issues(source_label?, query?, state?)` → issues from configured source(s)
- `gitlab_get_issue_details(project_path, iid)` → full issue with comments
- `gitlab_search_mrs(query?, state?)` → MRs from the code repo source
- `gitlab_get_mr_details(iid)` → full MR with pipeline, approvals, comments
- `gitlab_get_mr_pipeline_status(iid)` → `{ status, web_url, updated_at }`
- `gitlab_create_mr(source_branch, target_branch, title, description)` → creates MR
- `gitlab_approve_mr(iid)` → approves
- `gitlab_merge_mr(iid, squash?)` → merges
- `gitlab_add_mr_comment(iid, body)` → adds comment
- `gitlab_preview_mr(session_name)` → branch info, commit count, diff stats

**Events:**
- `SchaltEvent::GitLabStatusChanged` — auth/connection changes
- `SchaltEvent::SessionsRefreshed` — reused after MR creation from session

## Frontend

### `src/hooks/useGitlabIntegration.ts`

```typescript
interface GitlabIntegrationValue {
  status: GitLabStatusPayload | null
  loading: boolean
  sources: GitLabSource[]

  // Auth/config
  authenticate: () => Promise<void>
  configureProject: (sources: GitLabSource[]) => Promise<void>
  refreshStatus: () => Promise<void>

  // Issues (multi-source)
  searchIssues: (sourceLabel?, query?, state?) => Promise<GitLabIssueSummary[]>
  getIssueDetails: (projectPath, iid) => Promise<GitLabIssueDetails>

  // MRs (code repo only)
  searchMrs: (query?, state?) => Promise<GitLabMrSummary[]>
  getMrDetails: (iid) => Promise<GitLabMrDetails>
  getMrPipelineStatus: (iid) => Promise<GitLabPipelineStatusPayload>
  createMr: (args) => Promise<GitLabMrPayload>
  approveMr: (iid) => Promise<void>
  mergeMr: (iid, squash?) => Promise<void>
  addMrComment: (iid, body) => Promise<void>

  // Derived
  canCreateMr: boolean
  isGlabMissing: boolean
  hasCodeSource: boolean
}
```

**Jotai atoms:**
- `gitlabStatusAtom` — connection status
- `gitlabIssuesAtom` — cached issue list
- `gitlabMrsAtom` — cached MR list
- `gitlabActiveSourceAtom` — selected source filter in Issues tab

**Event listener:** `SchaltEvent.GitLabStatusChanged` → refresh status atom

### UI Components

**TopBar — `GitlabMenuButton.tsx`:**
- Connection state indicator (green/red/amber dot)
- Dropdown: auth status, configured sources, actions (Configure, Refresh)
- "Configure Sources" opens modal to add/remove project sources with labels and feature toggles

**Right Panel — two new tabs:**

**Issues tab (`GitlabIssuesPanel.tsx`):**
- Source filter dropdown (All / specific source labels)
- State filter (Open / Closed / All)
- Search input
- List rows: `#iid Title`, state badge, label chips, assignee, age
- Click to expand: full description (rendered markdown), comments thread, linked MRs
- Refresh button

**MRs tab (`GitlabMrsPanel.tsx`):**
- State filter (Open / Merged / Closed / All)
- Search input
- List rows: `!iid Title`, state badge, source→target branches, pipeline status badge (via `getMrPipelineStatus`), approvals (e.g. "1/2"), author
- Click to expand: description, comments, reviewers, diff stats, pipeline details
- Action buttons: Approve, Merge (squash toggle), Add Comment
- "New MR from session" button when session selected — pre-fills with session branch

**Pipeline badges** refresh on detail view open; manual refresh, no polling.

## Implementation Phases

1. **Backend foundation:** `gitlab_cli.rs` + `commands/gitlab.rs` + DB schema for `ProjectGitlabConfig`
2. **Auth & config:** `gitlab_get_status`, `gitlab_authenticate`, `gitlab_configure_project` + `GitlabMenuButton`
3. **Issues (read-only):** search + detail commands, Issues right-panel tab
4. **MRs (read-only):** search + detail + pipeline status commands, MRs right-panel tab
5. **MR lifecycle:** create, approve, merge, comment commands + action buttons in MR detail view
6. **Session integration:** "New MR from session" flow + `gitlab_preview_mr`
