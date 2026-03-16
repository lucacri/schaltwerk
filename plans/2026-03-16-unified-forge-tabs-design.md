# Unified Forge Tabs Design

**Date:** 2026-03-16
**Status:** Approved

## Goal

Unify the GitHub and GitLab issue/PR/MR tab implementations into a single set of forge-agnostic components. Provider-specific features (GitLab merge/approve/comment, GitHub review decisions) render conditionally based on provider capabilities.

## Context

The codebase already has a unified forge abstraction layer:
- **Types:** `ForgeSourceConfig`, `ForgePrDetails`, `ForgeIssueDetails`, `ForgeProviderData` in `src/types/forgeTypes.ts`
- **Tauri commands:** `ForgeSearchIssues`, `ForgeSearchPrs`, `ForgeGetIssueDetails`, `ForgeGetPrDetails`, `ForgeApprovePr`, `ForgeMergePr`, `ForgeCommentOnPr`
- **Hook:** `useForgeIntegration()` with generic methods

The UI layer hasn't caught up — there are separate GitHub and GitLab components for tabs, detail views, search hooks, label chips, and integration contexts. This refactor connects the UI to the existing unified backend.

## Design

### 1. Unified Search Hook: `useForgeSearch<TSummary, TDetails>`

Generic hook replacing all 4 search hooks (useGithub{Issue,Pr}Search, useGitlab{Issue,Mr}Search).

**Parameters:**
- `searchCommand`: TauriCommand (ForgeSearchIssues or ForgeSearchPrs)
- `detailsCommand`: TauriCommand (ForgeGetIssueDetails or ForgeGetPrDetails)
- `sources`: ForgeSourceConfig[]

**Behavior:**
- On mount / empty query: fetch all items from API, cache locally
- On keystroke: immediately filter cached list (no debounce)
- On debounce (300ms): fire API search with query to catch items not in cache
- Merge: combine locally-filtered + API results, deduplicate by id
- Multi-source: iterate sources, merge + sort by updatedAt
- Per-source error tracking (array of failed sources)
- Version-based race condition prevention

**Numeric ID search:**
- If query matches `/^\d+$/`, after normal search completes:
  - Check if any result has matching id/number/iid
  - If not found: call `forge_get_*_details(id)` directly
  - If that returns a result, prepend it to the list
- This naturally covers closed items since detail fetch isn't state-filtered

### 2. Unified Components

**`ForgeIssuesTab` / `ForgePrsTab`** — replace all 4 tab components.
- Gets sources from ForgeIntegrationContext
- Uses `useForgeSearch` with appropriate commands
- Renders list items generically:
  - `#id` prefix, state badge (normalizes OPEN/opened), title, updated date
  - Labels via `ForgeLabelChip`
  - For PRs: branch name display
  - For GitLab multi-source: source badge indicator
- Detail view via `ForgeIssueDetail` / `ForgePrDetail`

**`ForgeIssueDetail` / `ForgePrDetail`** — replace all 4 detail components.

Common sections (always rendered):
- Header: back button, "Open in [forge]" link, ContextualActionButton
- State badge, title, labels, description, comments (with empty-body filtering)

PR-specific conditional sections (based on ForgeProviderData fields, not forge type string):
- GitHub: ReviewDecisionBadge, StatusCheckIndicator, ReviewStateBadge list
- GitLab: PipelineIndicator (with refresh), reviewers list, merge/approve/comment actions (only when state is open)

**`ForgeLabelChip`** — replaces both label chips.
- Accepts `ForgeLabel { name: string, color?: string | null }`
- If color present: background color + contrast text calculation
- If no color: theme default styling
- Architecture exception for dynamic colors (already documented)

### 3. State & Context Unification

**`ForgeIntegrationContext`** — replaces both GitHub and GitLab integration contexts.

Exposes:
- `forgeType`: `'github' | 'gitlab' | 'unknown'`
- `status`: `{ installed, authenticated, userLogin, hasRepository }`
- `sources`: `ForgeSourceConfig[]` (GitHub: single implicit source; GitLab: explicit list)
- `loading`: boolean
- Actions: `authenticate()`, `connectProject()`
- PR actions: `createReviewedPr()`, `approvePr()`, `mergePr()`, `commentOnPr()`

Internally:
- Listens to `SchaltEvent.ForgeStatusChanged`
- Uses unified `Forge*` Tauri commands

**Tab routing in RightPanelTabs** simplifies:
- From: 4 tab keys (`gitlab-issues`, `gitlab-mrs`, `github-issues`, `github-prs`) with forge-specific visibility
- To: 2 tab keys (`forge-issues`, `forge-prs`) visible when `forgeType !== 'unknown'` and connected

### 4. i18n Consolidation

Merge translation keys:
- `githubIssueTab` + `gitlabIssueTab` → `forgeIssueTab`
- `githubPrTab` + `gitlabMrTab` → `forgePrTab`
- Terminology: use "PR" for both (or contextual label from forge type)

## File Changes

**New files (~8):**
- `src/contexts/ForgeIntegrationContext.tsx`
- `src/hooks/useForgeSearch.ts`
- `src/components/forge/ForgeIssuesTab.tsx`
- `src/components/forge/ForgePrsTab.tsx`
- `src/components/forge/ForgeIssueDetail.tsx`
- `src/components/forge/ForgePrDetail.tsx`
- `src/components/forge/ForgeLabelChip.tsx`
- Extend `src/types/forgeTypes.ts` with `ForgeLabel`

**Deleted files (~16):**
- `src/contexts/GithubIntegrationContext.tsx`, `GitlabIntegrationContext.tsx`
- `src/hooks/useGithubIntegration.ts`, `useGitlabIntegration.ts`
- `src/hooks/useGithub{Issue,Pr}Search.ts` (2)
- `src/hooks/useGitlab{Issue,Mr}Search.ts` (2)
- `src/components/github/{IssueDetail,PrDetail,LabelChip,IssuesTab,PrsTab}.tsx` (5)
- `src/components/gitlab/{IssueDetail,MrDetail,LabelChip,IssuesTab,MrsTab}.tsx` (5)

**Modified files:**
- `RightPanelTabs.tsx` — 2 forge tab renders instead of 4
- `RightPanelTabsHeader.tsx` — 2 tab buttons instead of 4
- `RightPanelTabs.types.ts` — `TabKey` drops 4 keys, adds 2
- `src/main.tsx` — one `ForgeIntegrationProvider` instead of two
- `src/common/i18n/types.ts` — merge translation key groups
- Locale files (en.json, zh.json)
- `ContextualActionButton.tsx` — move from `gitlab/` to `forge/` or `common/`
- Tests — consolidate into `forge/` equivalents
