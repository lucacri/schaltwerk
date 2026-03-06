# Forge Per-Project Settings Design

## Problem

Three related bugs when switching between projects with different forge types (GitLab vs GitHub):

1. **Settings modal shows both integration cards** regardless of detected forge type
2. **GitLab MR/Issue data persists** after switching to a non-GitLab project (stale sources)
3. **Right panel tabs don't hide** for non-GitLab projects when stale sources remain
4. **Session action button shows GitHub** even when forge is unknown

## Approach

Reactive forge-driven filtering: wire `projectForgeAtom` into every consumer, re-fetch sources on project switch, clear stale data immediately.

## Changes

### 1. Settings Modal — Forge-Conditional Integration Cards

**File**: `src/components/modals/SettingsModal.tsx`

- Read `projectForgeAtom`
- Show `GithubProjectIntegrationCard` when `forge !== 'gitlab'` (visible for `github` and `unknown`)
- Show `GitlabProjectIntegrationCard` when `forge !== 'github'` (visible for `gitlab` and `unknown`)
- When `unknown`, both cards appear so the user can configure either

### 2. Session Actions — Hide Forge Button When Unknown

**File**: `src/components/session/SessionActions.tsx`

- When `forge === 'unknown'`: hide the PR/MR button completely
- When `forge === 'github'`: show GitHub PR button
- When `forge === 'gitlab'`: show GitLab MR button

### 3. GitLab Sources — Re-fetch on Project Switch

**File**: `src/hooks/useGitlabIntegration.ts`

- Add `projectPath` as a dependency to the sources-loading effect
- Immediately clear sources (`setSources([])`) before fetching new ones
- Prevents stale data from previous project appearing during async fetch

### 4. Right Panel Tabs — Forge-Aware Visibility

**File**: `src/components/right-panel/RightPanelTabs.tsx`

- Read `projectForgeAtom`
- Add `forge !== 'github'` guard to GitLab tab visibility conditions
- Auto-fallback active tab to `changes` when current tab becomes hidden

## Tests

- Update `RightPanelTabs` tests for forge-conditional tab visibility
- Update `SessionActions` tests for hidden button when forge unknown
- Update `SettingsModal` tests for conditional card rendering
- Add test for `useGitlabIntegration` source clearing on project switch
