# Show Author & Assignee Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display issue author and assignee(s) in forge issue list and detail views for both GitHub and GitLab.

**Architecture:** Add `assignees: Vec<String>` to `ForgeIssueSummary` (Rust + TS), parse from both forge CLIs, and render in `IssueRow` and `ForgeIssueDetail` UI components using labeled segments format (`by @author · @assignee1, @assignee2`).

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), vitest (frontend tests), cargo nextest (Rust tests)

---

### Task 1: Add `assignees` to Rust `ForgeIssueSummary`

**Files:**
- Modify: `src-tauri/src/domains/git/forge.rs:35-43`

**Step 1: Add the field**

In `ForgeIssueSummary`, add `assignees` after `author`:

```rust
pub struct ForgeIssueSummary {
    pub id: String,
    pub title: String,
    pub state: String,
    pub updated_at: Option<String>,
    pub author: Option<String>,
    pub assignees: Vec<String>,       // NEW
    pub labels: Vec<ForgeLabel>,
    pub url: Option<String>,
}
```

**Step 2: Fix all compilation errors**

Adding a new field to `ForgeIssueSummary` will cause compilation errors at every construction site. Add `assignees: vec![]` to each:

- `src-tauri/src/domains/git/github_cli.rs:2533` (search_issues mapping)
- `src-tauri/src/domains/git/github_cli.rs:2570` (get_issue_details mapping)
- `src-tauri/src/domains/git/gitlab_cli.rs:1550` (search_issues mapping)
- `src-tauri/src/domains/git/gitlab_cli.rs:1589` (get_issue_details mapping)

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | head -30`
Expected: no errors related to `ForgeIssueSummary`

**Step 4: Commit**

```bash
git add src-tauri/src/domains/git/forge.rs src-tauri/src/domains/git/github_cli.rs src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat: add assignees field to ForgeIssueSummary"
```

---

### Task 2: Parse assignees from GitHub CLI

**Files:**
- Modify: `src-tauri/src/domains/git/github_cli.rs`

**Step 1: Write failing test**

Add a new test in the `#[cfg(test)] mod tests` block (after line ~3026):

```rust
#[test]
fn search_issues_parses_assignees() {
    let runner = MockRunner::default();
    runner.push_response(Ok(CommandOutput {
        status: Some(0),
        stdout: r#"[{"number":99,"title":"Assigned issue","state":"OPEN","updatedAt":"2024-03-01T00:00:00Z","author":{"login":"alice"},"assignees":[{"login":"bob"},{"login":"carol"}],"labels":[],"url":"https://github.com/example/repo/issues/99"}]"#.to_string(),
        stderr: String::new(),
    }));
    let cli = GitHubCli::with_runner(runner);

    let temp = TempDir::new().unwrap();
    let repo_path = temp.path();
    let repo = git2::Repository::init(repo_path).unwrap();
    repo.remote("origin", "https://github.com/example/repo").unwrap();

    let results = cli
        .search_issues(repo_path, "", 50, Some("example/repo"))
        .expect("issue search results");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].assignee_logins, vec!["bob", "carol"]);
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test search_issues_parses_assignees -- --nocapture 2>&1 | tail -10`
Expected: FAIL — `assignee_logins` field doesn't exist on `GitHubIssueSummary`

**Step 3: Implement assignee parsing**

3a. Add `assignees` to `IssueListResponse` (line ~2114):

```rust
#[derive(Debug, Deserialize)]
struct IssueListResponse {
    number: u64,
    title: String,
    state: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    author: Option<IssueActor>,
    #[serde(default)]
    assignees: Vec<IssueActor>,       // NEW
    #[serde(default)]
    labels: Vec<IssueLabel>,
    url: String,
}
```

3b. Add `assignee_logins` to `GitHubIssueSummary` (line ~85):

```rust
pub struct GitHubIssueSummary {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author_login: Option<String>,
    pub assignee_logins: Vec<String>,   // NEW
    pub labels: Vec<GitHubIssueLabel>,
    pub url: String,
}
```

3c. Map assignees in `search_issues` (line ~624):

```rust
GitHubIssueSummary {
    // ...existing fields...
    author_login: issue.author.and_then(|actor| actor.login),
    assignee_logins: issue.assignees.into_iter().filter_map(|a| a.login).collect(),
    // ...
}
```

3d. Add `"assignees"` to the `--json` field list (line ~576):

Change:
```
"number,title,state,updatedAt,author,labels,url"
```
To:
```
"number,title,state,updatedAt,author,assignees,labels,url"
```

3e. Map to `ForgeIssueSummary` (line ~2533):

Change `assignees: vec![]` to:
```rust
assignees: i.assignee_logins,
```

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test search_issues_parses_assignees -- --nocapture 2>&1 | tail -10`
Expected: PASS

**Step 5: Fix existing tests**

The existing `search_issues_parses_results_and_builds_arguments` test JSON (line ~2984) doesn't include `assignees`, but `#[serde(default)]` handles that. However, `GitHubIssueSummary` now has `assignee_logins` — any tests checking `--json` args string need the updated value. Verify:

Run: `cd src-tauri && cargo test search_issues -- --nocapture 2>&1 | tail -30`
Expected: all search_issues tests pass (the `--json` field list is checked via `args.contains(&"--json".to_string())` which doesn't check the value)

**Step 6: Commit**

```bash
git add src-tauri/src/domains/git/github_cli.rs
git commit -m "feat: parse assignees from GitHub CLI issue response"
```

---

### Task 3: Parse assignees from GitLab CLI

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write failing test**

Add after the existing `search_issues_parses_json_response` test (line ~2207):

```rust
#[test]
fn search_issues_parses_assignees() {
    let runner = MockRunner::default();
    let json = r#"[
        {
            "iid": 50,
            "title": "Assigned issue",
            "state": "opened",
            "updated_at": "2024-02-01T00:00:00Z",
            "author": {"username": "alice", "name": "Alice"},
            "assignees": [
                {"username": "bob", "name": "Bob"},
                {"username": "carol", "name": "Carol"}
            ],
            "labels": [],
            "web_url": "https://gitlab.com/group/project/-/issues/50"
        }
    ]"#;
    runner.push_response(Ok(CommandOutput {
        status: Some(0),
        stdout: json.to_string(),
        stderr: String::new(),
    }));
    let cli = GitlabCli::with_runner(runner);

    let issues = cli
        .search_issues(Path::new("/tmp/repo"), "", 10, "group/project", None)
        .unwrap();

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].assignees.len(), 2);
    assert_eq!(issues[0].assignees[0].username, "bob");
    assert_eq!(issues[0].assignees[1].username, "carol");
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test -p lucode -- search_issues_parses_assignees --nocapture 2>&1 | tail -10`
Expected: FAIL — `assignees` field doesn't exist on `GitlabIssueSummary`

**Step 3: Implement assignee parsing**

3a. Add `assignees` to `GitlabIssueSummary` (line ~118):

```rust
pub struct GitlabIssueSummary {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<GitlabUser>,
    #[serde(default)]
    pub assignees: Vec<GitlabUser>,    // NEW
    #[serde(default)]
    pub labels: Vec<String>,
    pub web_url: String,
}
```

3b. Add `assignees` to `GitlabIssueDetails` (line ~130):

```rust
pub struct GitlabIssueDetails {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub description: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub state: String,
    pub author: Option<GitlabUser>,
    #[serde(default)]
    pub assignees: Vec<GitlabUser>,    // NEW
    #[serde(default)]
    pub notes: Vec<GitlabNote>,
}
```

3c. Map assignees in search_issues ForgeIssueSummary mapping (line ~1550):

Change `assignees: vec![]` to:
```rust
assignees: i.assignees.iter().map(|a| a.username.clone()).collect(),
```

3d. Map assignees in get_issue_details ForgeIssueSummary mapping (line ~1589):

Change `assignees: vec![]` to:
```rust
assignees: details.assignees.iter().map(|a| a.username.clone()).collect(),
```

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test -p lucode -- search_issues_parses_assignees --nocapture 2>&1 | tail -10`
Expected: PASS

**Step 5: Run all Rust tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -10`
Expected: all pass

**Step 6: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat: parse assignees from GitLab CLI issue response"
```

---

### Task 4: Add `assignees` to TypeScript types and i18n

**Files:**
- Modify: `src/types/forgeTypes.ts:29-37`
- Modify: `src/locales/en.json:1295-1317`

**Step 1: Add field to TypeScript interface**

In `ForgeIssueSummary`, add after `author`:

```typescript
export interface ForgeIssueSummary {
  id: string
  title: string
  state: string
  updatedAt?: string
  author?: string
  assignees?: string[]    // NEW
  labels: ForgeLabel[]
  url?: string
}
```

**Step 2: Add i18n keys**

Add to the `forgeIssueTab` section in `en.json`:

```json
"openedBy": "by {author}",
"assignedTo": "assigned to {assignees}"
```

**Step 3: Run TypeScript lint**

Run: `bun run lint 2>&1 | tail -10`
Expected: PASS

**Step 4: Commit**

```bash
git add src/types/forgeTypes.ts src/locales/en.json
git commit -m "feat: add assignees type and i18n keys"
```

---

### Task 5: Display author and assignees in IssueRow

**Files:**
- Modify: `src/components/forge/ForgeIssuesTab.tsx:22-101`
- Modify: `src/components/forge/ForgeIssuesTab.test.tsx`

**Step 1: Write failing tests**

Add tests in `ForgeIssuesTab.test.tsx`:

```typescript
it('renders author in issue row', async () => {
  const searchIssues = vi.fn().mockResolvedValue([
    makeSummary({ id: '10', title: 'Test issue', author: 'alice' }),
  ])

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      searchIssues,
      sources: [testSource],
    },
  })

  await waitFor(() => {
    expect(screen.getByText('by @alice')).toBeTruthy()
  })
})

it('renders assignees in issue row', async () => {
  const searchIssues = vi.fn().mockResolvedValue([
    makeSummary({ id: '11', title: 'Assigned issue', assignees: ['bob', 'carol'] }),
  ])

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      searchIssues,
      sources: [testSource],
    },
  })

  await waitFor(() => {
    expect(screen.getByText('@bob, @carol')).toBeTruthy()
  })
})

it('hides author segment when author is missing', async () => {
  const searchIssues = vi.fn().mockResolvedValue([
    makeSummary({ id: '12', title: 'No author', author: undefined }),
  ])

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      searchIssues,
      sources: [testSource],
    },
  })

  await waitFor(() => {
    expect(screen.getByText('No author')).toBeTruthy()
  })
  expect(screen.queryByText(/^by @/)).toBeNull()
})
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/components/forge/ForgeIssuesTab.test.tsx 2>&1 | tail -15`
Expected: FAIL

**Step 3: Implement author/assignee display in IssueRow**

In `IssueRow`, after the updated time `<span>` (line ~80), add author and assignee segments inside the same top row `<div>`:

```tsx
{issue.author && (
  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
    {t.forgeIssueTab.openedBy.replace('{author}', `@${issue.author}`)}
  </span>
)}
{issue.assignees && issue.assignees.length > 0 && (
  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
    @{issue.assignees.join(', @')}
  </span>
)}
```

Add a separator dot between updated time and author. Use `·` as the separator (matching the design). Wrap the updated time + author + assignees group with appropriate separators:

```tsx
{issue.updatedAt && (
  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
    {t.forgeIssueTab.updated.replace('{time}', formatRelativeDate(issue.updatedAt))}
  </span>
)}
{issue.author && (
  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
    · {t.forgeIssueTab.openedBy.replace('{author}', `@${issue.author}`)}
  </span>
)}
{issue.assignees && issue.assignees.length > 0 && (
  <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
    · @{issue.assignees.join(', @')}
  </span>
)}
```

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/components/forge/ForgeIssuesTab.test.tsx 2>&1 | tail -15`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/forge/ForgeIssuesTab.tsx src/components/forge/ForgeIssuesTab.test.tsx
git commit -m "feat: display author and assignees in issue list rows"
```

---

### Task 6: Display author and assignees in ForgeIssueDetail

**Files:**
- Modify: `src/components/forge/ForgeIssueDetail.tsx:59-254`
- Modify: `src/components/forge/ForgeIssueDetail.test.tsx`

**Step 1: Write failing tests**

Add tests in `ForgeIssueDetail.test.tsx`:

```typescript
it('renders metadata line with author', () => {
  renderWithProviders(
    <ForgeIssueDetail
      details={makeDetails({ summary: { ...makeDetails().summary, author: 'alice' } })}
      onBack={onBack}
      forgeType="github"
    />,
    { forgeOverrides: { hasRepository: true } }
  )

  expect(screen.getByText(/opened by/i)).toBeTruthy()
  expect(screen.getByText(/@alice/)).toBeTruthy()
})

it('renders metadata line with assignees', () => {
  const details = makeDetails()
  details.summary.assignees = ['bob', 'carol']

  renderWithProviders(
    <ForgeIssueDetail details={details} onBack={onBack} forgeType="github" />,
    { forgeOverrides: { hasRepository: true } }
  )

  expect(screen.getByText(/assigned to/i)).toBeTruthy()
  expect(screen.getByText(/@bob, @carol/)).toBeTruthy()
})

it('hides assigned-to segment when no assignees', () => {
  const details = makeDetails()
  details.summary.assignees = []

  renderWithProviders(
    <ForgeIssueDetail details={details} onBack={onBack} forgeType="github" />,
    { forgeOverrides: { hasRepository: true } }
  )

  expect(screen.queryByText(/assigned to/i)).toBeNull()
})
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/components/forge/ForgeIssueDetail.test.tsx 2>&1 | tail -15`
Expected: FAIL

**Step 3: Implement metadata line**

After the title `<h3>` (line ~161) and before labels, add a metadata line:

```tsx
{(summary.author || (summary.assignees && summary.assignees.length > 0) || summary.updatedAt) && (
  <div
    className="flex flex-wrap items-center gap-1 mb-2"
    style={{
      fontSize: theme.fontSize.caption,
      color: 'var(--color-text-muted)',
    }}
  >
    {summary.author && (
      <span>
        {t.forgeIssueTab.openedBy.replace('{author}', `@${summary.author}`)}
      </span>
    )}
    {summary.assignees && summary.assignees.length > 0 && (
      <>
        {summary.author && <span>·</span>}
        <span>
          {t.forgeIssueTab.assignedTo.replace('{assignees}', `@${summary.assignees.join(', @')}`)}
        </span>
      </>
    )}
    {summary.updatedAt && (
      <>
        {(summary.author || (summary.assignees && summary.assignees.length > 0)) && <span>·</span>}
        <span>{t.forgeIssueTab.updated.replace('{time}', formatRelativeDate(summary.updatedAt))}</span>
      </>
    )}
  </div>
)}
```

**Step 4: Add assignees to ContextualActionButton variables**

In the `variables` prop of `ContextualActionButton` (line ~120), add:

```typescript
'issue.assignees': summary.assignees?.join(', ') ?? '',
```

**Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/components/forge/ForgeIssueDetail.test.tsx 2>&1 | tail -15`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/forge/ForgeIssueDetail.tsx src/components/forge/ForgeIssueDetail.test.tsx
git commit -m "feat: display author and assignees in issue detail view"
```

---

### Task 7: Update test fixtures and run full validation

**Files:**
- Modify: `src/components/forge/ForgeIssuesTab.test.tsx` (update `makeSummary`)
- Modify: `src/components/forge/ForgeIssueDetail.test.tsx` (update `makeDetails`)
- Modify: `src/components/forge/ForgeIssueDetail.contextualActions.test.tsx` (if it has `makeSummary`/`makeDetails`)

**Step 1: Add `assignees` to test fixture factories**

In each test file's `makeSummary`/`makeDetails` factory, ensure `assignees` is included in the default fixture to match the updated type.

**Step 2: Run full validation**

Run: `just test`
Expected: ALL checks pass (TypeScript lint, Rust clippy, cargo shear, knip, vitest, cargo nextest)

**Step 3: Commit if any fixture updates were needed**

```bash
git add -A
git commit -m "test: update fixtures with assignees field"
```
