# Show Author & Assignee on Forge Issues

## Summary

Display issue author and assignee(s) in both the forge issue list (`ForgeIssuesTab`) and detail view (`ForgeIssueDetail`) for GitHub and GitLab.

## Current State

- `ForgeIssueSummary` has `author: Option<String>` but it's not rendered in the list or detail header
- No assignee data exists anywhere (types, parsing, or UI)
- Both GitHub and GitLab APIs provide assignee data; we just don't query/parse it

## Design

### Backend: Add `assignees` field

Add `assignees: Vec<String>` to `ForgeIssueSummary` (Rust) and parse from both forges:

- **GitHub**: Add `"assignees"` to `--json` fields in `search_issues`, add `assignees: Vec<IssueActor>` to `IssueListResponse`, map logins to strings
- **GitLab**: Add `assignees: Vec<GitlabUser>` with `#[serde(default)]` to `GitlabIssueSummary`, map usernames to strings

### Frontend: Types

Add `assignees?: string[]` to `ForgeIssueSummary` in `forgeTypes.ts`.

### UI: Issue List Row

In `IssueRow`, append author and assignees after the updated timestamp using labeled segments:

```
Open  #42                     updated 2h ago · by @alice · @bob, @carol
```

- "by @author" shown when author exists
- "@assignee1, @assignee2" shown when assignees exist
- Either segment omitted when data is missing

### UI: Issue Detail

Add metadata line below the title:

```
opened by @alice · assigned to @bob, @carol · updated 2h ago
```

- "assigned to" segment only shown when assignees exist

### Contextual Actions

Add `issue.assignees` template variable to `ContextualActionButton` in `ForgeIssueDetail`.

### i18n

Add keys to `forgeIssueTab` in `en.json`:
- `openedBy`: `"by {author}"`
- `assignedTo`: `"assigned to {assignees}"`

## Files to Modify

- `src-tauri/src/domains/git/forge.rs`
- `src-tauri/src/domains/git/github_cli.rs`
- `src-tauri/src/domains/git/gitlab_cli.rs`
- `src/types/forgeTypes.ts`
- `src/components/forge/ForgeIssuesTab.tsx`
- `src/components/forge/ForgeIssueDetail.tsx`
- `src/locales/en.json`

## Testing

- Rust tests for assignee field serialization
- Rust tests for GitHub/GitLab assignee parsing
- Frontend component tests for rendering author/assignees
- Edge cases: no author, no assignees, multiple assignees
