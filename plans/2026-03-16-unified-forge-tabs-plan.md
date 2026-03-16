# Unified Forge Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate GitHub/GitLab issue and PR/MR tab implementations with unified forge-agnostic components.

**Architecture:** The backend already has unified `Forge*` Tauri commands and types (`ForgeSourceConfig`, `ForgePrDetails`, etc.) in `src/types/forgeTypes.ts` and a `useForgeIntegration()` hook. This plan connects the UI layer to that existing abstraction, replacing 16+ forge-specific files with ~8 unified ones. Provider-specific features (GitLab merge/approve/comment, GitHub review decisions) render conditionally based on `ForgeProviderData` capabilities.

**Tech Stack:** React, TypeScript, Jotai, Tauri, Vitest

**Design doc:** `plans/2026-03-16-unified-forge-tabs-design.md`

---

### Task 1: ForgeLabelChip Component

**Files:**
- Create: `src/components/forge/ForgeLabelChip.tsx`
- Create: `src/components/forge/ForgeLabelChip.test.tsx`
- Modify: `src/test/architecture-exceptions.ts` — update exception path

**Context:**
- Replaces `src/components/github/GithubLabelChip.tsx` and `src/components/gitlab/GitlabLabelChip.tsx`
- Uses `ForgeLabel` from `src/types/forgeTypes.ts` (already has `{ name: string, color?: string }`)
- If `color` is present: render with that background + contrast text. If not: use theme defaults
- The existing `GithubLabelChip` has the contrast calculation logic — reuse it
- Architecture exception needed for dynamic colors (already exists for `GithubLabelChip`, just update path)

**Step 1: Write the failing test**

Read `src/components/github/GithubLabelChip.test.tsx` for the test pattern. Create `src/components/forge/ForgeLabelChip.test.tsx` that imports from `./ForgeLabelChip` instead, uses `ForgeLabel` type from `../../types/forgeTypes`. Keep all 6 test cases (renders name, colored bg, default theme, hash prefix, light text on dark, dark text on light).

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/forge/ForgeLabelChip.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement ForgeLabelChip**

Copy `src/components/github/GithubLabelChip.tsx` to `src/components/forge/ForgeLabelChip.tsx`. Change import from `GithubIssueLabel` to `ForgeLabel` from `../../types/forgeTypes`. Rename component to `ForgeLabelChip`. The `color` field in `ForgeLabel` is `string | undefined` (not `string | null`), so adjust the null check to `label.color ? ...` (works for both).

**Step 4: Update architecture exception**

In `src/test/architecture-exceptions.ts`, change the `THEME_EXCEPTIONS` entry from `src/components/github/GithubLabelChip.tsx` to `src/components/forge/ForgeLabelChip.tsx`.

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/forge/ForgeLabelChip.test.tsx`
Expected: PASS (6 tests)

**Step 6: Commit**

```bash
git add src/components/forge/ForgeLabelChip.tsx src/components/forge/ForgeLabelChip.test.tsx src/test/architecture-exceptions.ts
git commit -m "feat: add ForgeLabelChip unifying GitHub/GitLab label chips"
```

---

### Task 2: useForgeSearch Generic Hook

**Files:**
- Create: `src/hooks/useForgeSearch.ts`
- Create: `src/hooks/useForgeSearch.test.ts`

**Context:**
- Replaces `useGithubIssueSearch`, `useGithubPrSearch`, `useGitlabIssueSearch`, `useGitlabMrSearch`
- Generic over `TSummary` (issue or PR summary type) — both extend `ForgeIssueSummary` or `ForgePrSummary`
- Uses `useForgeIntegration()` methods (`searchIssues`/`searchPrs`/`getIssueDetails`/`getPrDetails`)

**Interface:**

```typescript
interface UseForgeSearchOptions<TSummary, TDetails> {
  searchFn: (source: ForgeSourceConfig, query?: string) => Promise<TSummary[]>
  detailsFn: (source: ForgeSourceConfig, id: string) => Promise<TDetails>
  sources: ForgeSourceConfig[]
  enabled: boolean
  debounceMs?: number  // default 300, 0 for tests
}

interface UseForgeSearchResult<TSummary, TDetails> {
  query: string
  setQuery: (q: string) => void
  results: TSummary[]
  loading: boolean
  error: string | null
  errorDetails: SourceError[]
  clearError: () => void
  fetchDetails: (id: string, source?: ForgeSourceConfig) => Promise<TDetails | null>
}
```

**Behavior to implement:**

1. On mount (when `enabled` becomes true): fetch all items from API with no query, store in `cachedItems` ref
2. On `setQuery` keystroke: immediately filter `cachedItems` by checking if `item.title` or `item.id` contains the query (case-insensitive). Set `results` synchronously
3. On debounce (300ms after last `setQuery`): fire API search with query string. Merge with filtered cache, deduplicate by `id`, sort by `updatedAt` descending
4. Numeric ID search: if query matches `/^\d+$/` and no result has `item.id === query`, call `detailsFn(source, query)` for each source. If found, construct a summary-like object and prepend to results
5. Multi-source: iterate `sources`, accumulate results and errors per source. Partial failures don't block other sources
6. Version ref for race condition prevention (increment on each search, ignore stale results)

**Step 1: Write failing tests**

Test cases:
- Returns empty results initially when disabled
- Fetches all items on enable (mount)
- Filters cached items immediately on query change (no debounce)
- Fires debounced API search after delay
- Merges API results with cached, deduplicates by id
- Numeric query triggers direct detail fetch when not in results
- Multi-source merges results from all sources
- Tracks per-source errors without blocking other sources
- Race condition: ignores stale results

Mock `invoke` from `@tauri-apps/api/core`. Use `vi.useFakeTimers()` for debounce testing.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useForgeSearch.test.ts`

**Step 3: Implement useForgeSearch**

Key implementation details:
- `cachedItemsRef = useRef<TSummary[]>([])` for the local cache
- `versionRef = useRef(0)` for race conditions
- `setQuery` updates state AND immediately filters cache (synchronous)
- `useEffect` with debounce timer on query changes fires API search
- For numeric queries: after API search completes, check if ID is in results. If not, try `detailsFn` for each source. The detail response has a `summary` field — use that to prepend
- Sort all results by `updatedAt` descending (if present)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useForgeSearch.test.ts`

**Step 5: Commit**

```bash
git add src/hooks/useForgeSearch.ts src/hooks/useForgeSearch.test.ts
git commit -m "feat: add useForgeSearch generic hook with local cache and numeric ID lookup"
```

---

### Task 3: ForgeIntegrationContext

**Files:**
- Create: `src/contexts/ForgeIntegrationContext.tsx`
- Modify: `src/tests/test-utils.tsx` — replace GitHub/GitLab test providers with Forge provider

**Context:**
- Replaces `GithubIntegrationContext` and `GitlabIntegrationContext`
- Wraps the existing `useForgeIntegration()` hook from `src/hooks/useForgeIntegration.ts`
- Adds `sources` resolution: for GitHub, derive a single `ForgeSourceConfig` from status. For GitLab, use configured sources
- The existing `useForgeIntegration` already has all the methods (`searchIssues`, `getPrDetails`, `approvePr`, `mergePr`, `commentOnPr`, etc.)

**Interface:**

```typescript
interface ForgeIntegrationContextValue extends ForgeIntegrationValue {
  forgeType: ForgeType
  sources: ForgeSourceConfig[]
  hasRepository: boolean
  hasSources: boolean
}
```

**Step 1: Create ForgeIntegrationContext**

- Create provider that calls `useForgeIntegration()` and enriches with:
  - `forgeType`: derived from `status.forgeType` (or `'unknown'` if null)
  - `sources`: for GitHub, create a single `ForgeSourceConfig` with `projectIdentifier` from status. For GitLab, fetch sources via existing `GitLabGetSources` command (or use `ForgeGetStatus` which may include them)
  - `hasRepository`: `status?.authenticated === true && sources.length > 0`
  - `hasSources`: `sources.length > 0`
- Export `ForgeIntegrationProvider` and `useForgeIntegrationContext()`

**Step 2: Update test-utils.tsx**

Replace `GithubIntegrationTestProvider` and `GitlabIntegrationTestProvider` in `src/tests/test-utils.tsx` with a single `ForgeIntegrationTestProvider`. The `renderWithProviders` options change from `{ githubOverrides, gitlabOverrides }` to `{ forgeOverrides }`.

Important: Check ALL existing test files that use `githubOverrides` or `gitlabOverrides` — they'll need updating in later tasks.

**Step 3: Run lints to verify no type errors**

Run: `npx tsc --noEmit`
Expected: Will have errors from existing files still importing old contexts — that's expected at this stage.

**Step 4: Commit**

```bash
git add src/contexts/ForgeIntegrationContext.tsx src/tests/test-utils.tsx
git commit -m "feat: add ForgeIntegrationContext replacing GitHub/GitLab contexts"
```

---

### Task 4: i18n Consolidation

**Files:**
- Modify: `src/common/i18n/types.ts`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`

**Context:**
- Merge `githubIssueTab` + `gitlabIssueTab` → `forgeIssueTab`
- Merge `githubPrTab` + `gitlabMrTab` → `forgePrTab`
- Merge `rightPanelTabs.githubIssues` + `rightPanelTabs.gitlabIssues` → `rightPanelTabs.forgeIssues` (similarly for PRs/MRs)
- The unified keys should be a superset of both (all GitHub + all GitLab keys)
- Keep old keys temporarily (remove when old components are deleted in Task 9)

**Step 1: Add forgeIssueTab type**

In `src/common/i18n/types.ts`, add `forgeIssueTab` combining all keys from both:

```typescript
forgeIssueTab: {
  searchPlaceholder: string
  loading: string
  noIssuesFound: string
  adjustSearch: string
  back: string
  openInForge: string  // was openInGithub/openInGitlab
  opened: string
  closed: string
  updated: string
  description: string
  comments: string
  noComments: string
  labels: string
  // GitLab-specific
  notes: string
  noNotes: string
  source: string
}
```

**Step 2: Add forgePrTab type**

```typescript
forgePrTab: {
  searchPlaceholder: string
  loading: string
  noPrsFound: string
  adjustSearch: string
  back: string
  openInForge: string
  opened: string
  closed: string
  merged: string
  updated: string
  description: string
  comments: string
  noComments: string
  labels: string
  headBranch: string
  sourceBranch: string
  targetBranch: string
  // Reviews
  reviews: string
  noReviews: string
  reviewDecision: string
  statusChecks: string
  // GitLab interactive
  approve: string
  merge: string
  comment: string
  squash: string
  deleteSourceBranch: string
  mergeStatus: string
  reviewers: string
  pipeline: string
  refreshPipeline: string
}
```

**Step 3: Add forgeIssues/forgePrs to rightPanelTabs type**

**Step 4: Add English translations in en.json**

**Step 5: Add Chinese translations in zh.json**

**Step 6: Run type check**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/common/i18n/types.ts src/locales/en.json src/locales/zh.json
git commit -m "feat: add unified forge i18n keys for issues and PRs"
```

---

### Task 5: ForgeIssueDetail Component

**Files:**
- Create: `src/components/forge/ForgeIssueDetail.tsx`
- Create: `src/components/forge/ForgeIssueDetail.test.tsx`

**Context:**
- Replaces `GithubIssueDetail` and `GitlabIssueDetail`
- Uses `ForgeIssueDetails` from `src/types/forgeTypes.ts`:
  ```typescript
  { summary: ForgeIssueSummary, body?: string, comments: ForgeComment[] }
  ```
  Where `ForgeIssueSummary` has `{ id, title, state, updatedAt?, author?, labels: ForgeLabel[], url? }`
- State normalization: GitHub uses `OPEN/CLOSED`, GitLab uses `opened/closed`. Normalize in display: treat `OPEN` and `opened` as open
- Comment filtering: filter out comments with empty/whitespace bodies (from sp branch)
- Uses `ContextualActionButton` from `../gitlab/ContextualActionButton` (will move in Task 8)
- For GitLab multi-source: optionally show source badge (pass via prop or context)

**Props:**

```typescript
interface ForgeIssueDetailProps {
  details: ForgeIssueDetails
  onBack: () => void
  sourceLabel?: string  // for GitLab multi-source badge
  forgeType: ForgeType  // for "Open in GitHub/GitLab" label
}
```

**Step 1: Write failing tests**

Test cases adapted from `GithubIssueDetail.test.tsx`:
- Renders issue title with `#id` format
- Shows open/closed state badge with correct styling
- Shows labels via ForgeLabelChip
- Shows description
- Shows comments with author and date
- Filters empty comments
- Shows "No comments" when empty
- Back button calls onBack
- Open in forge button invokes OpenExternalUrl

**Step 2: Implement ForgeIssueDetail**

State normalization helper:
```typescript
function isOpen(state: string): boolean {
  return state === 'OPEN' || state === 'opened'
}
```

**Step 3: Run tests**

Run: `npx vitest run src/components/forge/ForgeIssueDetail.test.tsx`

**Step 4: Commit**

```bash
git add src/components/forge/ForgeIssueDetail.tsx src/components/forge/ForgeIssueDetail.test.tsx
git commit -m "feat: add ForgeIssueDetail unifying GitHub/GitLab issue detail views"
```

---

### Task 6: ForgePrDetail Component

**Files:**
- Create: `src/components/forge/ForgePrDetail.tsx`
- Create: `src/components/forge/ForgePrDetail.test.tsx`

**Context:**
- Replaces `GithubPrDetail` and `GitlabMrDetail`
- Uses `ForgePrDetails` from `src/types/forgeTypes.ts`:
  ```typescript
  {
    summary: ForgePrSummary,
    body?: string,
    ciStatus?: ForgeCiStatus,
    reviews: ForgeReview[],
    reviewComments: ForgeReviewComment[],
    providerData: ForgeProviderData
  }
  ```
- `ForgeProviderData` is a discriminated union:
  - `{ type: 'GitHub', reviewDecision?, statusChecks, isFork }`
  - `{ type: 'GitLab', mergeStatus?, pipelineStatus?, pipelineUrl?, reviewers }`
  - `{ type: 'None' }`

**Conditional sections based on providerData.type:**

GitHub-only:
- `ReviewDecisionBadge` — shows APPROVED/CHANGES_REQUESTED/REVIEW_REQUIRED
- `StatusCheckIndicator` — shows SUCCESS/FAILURE/PENDING with colored dot
- `ReviewStateBadge` for each review in `reviews` array

GitLab-only:
- Pipeline status indicator with refresh button
- Reviewers list
- Approve button (calls `forgeIntegration.approvePr`)
- Merge button with squash/deleteSourceBranch options (calls `forgeIntegration.mergePr`)
- Comment textarea + submit (calls `forgeIntegration.commentOnPr`)
- These interactive actions only show when state is open

Common:
- Header with back, "Open in [forge]", ContextualActionButton
- State badge (OPEN/CLOSED/MERGED, normalized)
- Branch info (sourceBranch display)
- Labels via ForgeLabelChip
- Description
- Comments (filtered)

**Props:**

```typescript
interface ForgePrDetailProps {
  details: ForgePrDetails
  onBack: () => void
  sourceLabel?: string
  forgeType: ForgeType
  onRefreshPipeline?: () => Promise<void>  // GitLab only
}
```

**Step 1: Write failing tests**

Comprehensive tests covering:
- Common: title, state badges (open/closed/merged), branch, labels, description, comments, back, external link
- GitHub provider data: review decision badges, status checks, review list
- GitLab provider data: pipeline indicator, reviewers, action buttons visibility
- Comment filtering

**Step 2: Implement ForgePrDetail**

Use the componentized approach from the sp branch (ReviewDecisionBadge, StatusCheckIndicator, ReviewStateBadge, BranchPill, SectionLabel). Add GitLab-specific sections conditionally:

```typescript
{providerData.type === 'GitLab' && providerData.pipelineStatus && (
  <PipelineSection ... />
)}
{providerData.type === 'GitHub' && providerData.reviewDecision && (
  <ReviewDecisionSection ... />
)}
```

**Step 3: Run tests**

Run: `npx vitest run src/components/forge/ForgePrDetail.test.tsx`

**Step 4: Commit**

```bash
git add src/components/forge/ForgePrDetail.tsx src/components/forge/ForgePrDetail.test.tsx
git commit -m "feat: add ForgePrDetail unifying GitHub/GitLab PR/MR detail views"
```

---

### Task 7: ForgeIssuesTab and ForgePrsTab

**Files:**
- Create: `src/components/forge/ForgeIssuesTab.tsx`
- Create: `src/components/forge/ForgePrsTab.tsx`
- Create: `src/components/forge/__tests__/ForgeIssuesTab.test.tsx`
- Create: `src/components/forge/__tests__/ForgePrsTab.test.tsx`

**Context:**
- Replaces `GithubIssuesTab`, `GitlabIssuesTab`, `GithubPrsTab`, `GitlabMrsTab`
- Uses `useForgeSearch` from Task 2
- Uses `useForgeIntegrationContext()` from Task 3 to get `sources`, `forgeType`, and forge methods
- Renders list of items, clicking navigates to detail view (ForgeIssueDetail/ForgePrDetail)

**ForgeIssuesTab behavior:**
- Search bar with immediate local filtering + debounced API search
- List rows showing: state badge, `#id`, title, labels (via ForgeLabelChip), updated date
- For GitLab multi-source: source label badge per row
- Click row → fetch details via `useForgeSearch.fetchDetails(id)` → render `ForgeIssueDetail`
- Error banner with per-source error details (GitLab pattern)

**ForgePrsTab behavior:**
- Same as issues tab, plus: branch name in row, MERGED state badge (violet)
- Detail view: `ForgePrDetail` with provider-specific sections
- For GitLab: pass `onRefreshPipeline` callback to detail view

**Step 1: Write failing tests for ForgeIssuesTab**

Test cases:
- Renders issues from search results
- Shows `#id` prefix
- Shows state badges
- Search input filters immediately (no debounce)
- Shows empty state
- Shows error banner
- Clicking issue fetches and shows detail view

**Step 2: Implement ForgeIssuesTab**

**Step 3: Write failing tests for ForgePrsTab**

**Step 4: Implement ForgePrsTab**

**Step 5: Run all tests**

Run: `npx vitest run src/components/forge/`

**Step 6: Commit**

```bash
git add src/components/forge/
git commit -m "feat: add ForgeIssuesTab and ForgePrsTab unifying all forge tabs"
```

---

### Task 8: Wire Up RightPanelTabs and Header

**Files:**
- Modify: `src/components/right-panel/RightPanelTabs.types.ts`
- Modify: `src/components/right-panel/RightPanelTabsHeader.tsx`
- Modify: `src/components/right-panel/RightPanelTabs.tsx`
- Modify: `src/store/atoms/rightPanelTab.ts` (if tab key migration needed)

**Context:**
- Replace 4 forge-specific tab keys with 2: `'forge-issues'` | `'forge-prs'`
- Replace 4 conditional visibility checks with 2
- Replace 4 tab button renders in header with 2
- Replace 4 tab content renders with 2

**Step 1: Update TabKey type**

In `RightPanelTabs.types.ts`:
```typescript
// Remove: 'gitlab-issues' | 'gitlab-mrs' | 'github-issues' | 'github-prs'
// Add: 'forge-issues' | 'forge-prs'
export type TabKey = 'changes' | 'agent' | 'info' | 'history' | 'specs' | 'preview' | 'forge-issues' | 'forge-prs'
```

**Step 2: Update RightPanelTabsHeader**

Remove 4 GitHub/GitLab tab button conditionals. Add 2 forge tab buttons:
- `showForgeIssuesTab` → Issues icon (VscIssues)
- `showForgePrsTab` → PR icon (VscGitPullRequest)

**Step 3: Update RightPanelTabs**

- Replace `useGithubIntegrationContext()` and `useGitlabIntegrationContext()` with `useForgeIntegrationContext()`
- Simplify visibility:
  ```typescript
  const showForgeIssuesTab = forgeIntegration.forgeType !== 'unknown' && (isCommander || isRunningSession) && forgeIntegration.hasSources
  const showForgePrsTab = showForgeIssuesTab
  ```
- Replace 4 tab content divs with 2: `<ForgeIssuesTab />` and `<ForgePrsTab />`
- Update tab fallback logic (if selected tab becomes invisible, fall back to 'changes')

**Step 4: Update main.tsx**

Replace:
```typescript
<GithubIntegrationProvider>
  <GitlabIntegrationProvider>
```
With:
```typescript
<ForgeIntegrationProvider>
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`

**Step 6: Run existing RightPanelTabs tests**

Run: `npx vitest run src/components/right-panel/RightPanelTabs.test.tsx src/components/right-panel/RightPanelTabsHeader.test.tsx`

Fix any test updates needed for new tab key names and context provider changes.

**Step 7: Commit**

```bash
git add src/components/right-panel/ src/main.tsx src/store/atoms/rightPanelTab.ts
git commit -m "feat: wire ForgeIssuesTab and ForgePrsTab into RightPanelTabs"
```

---

### Task 9: Move ContextualActionButton and Clean Up Old Files

**Files:**
- Move: `src/components/gitlab/ContextualActionButton.tsx` → `src/components/forge/ContextualActionButton.tsx`
- Delete: `src/components/github/GithubIssueDetail.tsx` (and test)
- Delete: `src/components/github/GithubPrDetail.tsx` (and test)
- Delete: `src/components/github/GithubLabelChip.tsx` (and test)
- Delete: `src/components/right-panel/GithubIssuesTab.tsx`
- Delete: `src/components/right-panel/GithubPrsTab.tsx`
- Delete: `src/components/right-panel/__tests__/GithubIssuesTab.test.tsx`
- Delete: `src/components/right-panel/__tests__/GithubPrsTab.test.tsx`
- Delete: `src/components/gitlab/GitlabIssueDetail.tsx`
- Delete: `src/components/gitlab/GitlabMrDetail.tsx`
- Delete: `src/components/gitlab/GitlabLabelChip.tsx`
- Delete: `src/components/right-panel/GitlabIssuesTab.tsx`
- Delete: `src/components/right-panel/GitlabMrsTab.tsx`
- Delete: `src/components/right-panel/__tests__/GitlabIssuesTab.test.tsx`
- Delete: `src/contexts/GithubIntegrationContext.tsx`
- Delete: `src/contexts/GitlabIntegrationContext.tsx`
- Delete: `src/hooks/useGithubIntegration.ts`
- Delete: `src/hooks/useGitlabIntegration.ts`
- Delete: `src/hooks/useGithubIssueSearch.ts`
- Delete: `src/hooks/useGithubPrSearch.ts`
- Delete: `src/hooks/useGitlabIssueSearch.ts`
- Delete: `src/hooks/useGitlabMrSearch.ts`
- Delete: `src/hooks/useForgeType.ts` (replaced by ForgeIntegrationContext)
- Modify: `src/types/githubIssues.ts` — check if anything still uses it, delete if not
- Modify: `src/common/i18n/types.ts` — remove old githubIssueTab/githubPrTab/gitlabIssueTab/gitlabMrTab keys
- Modify: `src/locales/en.json` and `zh.json` — remove old keys

**Step 1: Move ContextualActionButton**

Move file. Update all imports (use grep to find them). The new path is `../forge/ContextualActionButton` from detail components (already in `forge/` so just `./ContextualActionButton`).

**Step 2: Delete old forge-specific component files**

Delete all files listed above. Use `git rm` for each.

**Step 3: Update remaining imports**

Grep for any remaining imports of deleted modules. Fix them. Key files to check:
- `src/App.tsx` — may import GitHub/GitLab hooks or contexts
- `src/components/right-panel/RightPanelTabs.tsx` — should already be updated from Task 8
- Any other component importing from `../github/` or `../gitlab/`

**Step 4: Remove old i18n keys**

Remove `githubIssueTab`, `githubPrTab`, `gitlabIssueTab`, `gitlabMrTab` from types.ts, en.json, zh.json. Remove `rightPanelTabs.githubIssues`, `githubPrs`, `gitlabIssues`, `gitlabMrs`.

**Step 5: Run full validation**

Run: `just test`

This is the critical checkpoint — everything must pass. Fix any remaining broken imports, test references, or type errors.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove old GitHub/GitLab-specific tab components and contexts"
```

---

### Task 10: Final Validation and Cleanup

**Files:**
- Verify: All files in `src/components/forge/`
- Verify: `src/components/right-panel/RightPanelTabs.tsx`
- Verify: `src/main.tsx`

**Step 1: Run full validation suite**

Run: `just test`

All must pass:
- TypeScript lint + type check
- ESLint
- Rust clippy + build + tests
- Frontend vitest (all tests)
- knip (dead code detection) — verify no new unused exports
- cargo shear

**Step 2: Verify knip output**

Check that deleted files don't show as unused (they're gone). Check that new forge files are all properly imported. If knip reports unused exports in forge files, fix them.

**Step 3: Verify no hardcoded forge references leak through**

Run: `grep -r "useGithubIntegrationContext\|useGitlabIntegrationContext\|GithubIssuesTab\|GitlabIssuesTab\|GithubPrsTab\|GitlabMrsTab" src/ --include="*.ts" --include="*.tsx"`

Expected: No results (or only in test mocks that are acceptable).

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final cleanup after forge tab unification"
```
