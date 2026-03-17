# Fix Forge Issue Click Resetting to List

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where clicking a GitLab issue in the forge issues tab refreshes and returns to the list instead of showing the issue detail view.

**Architecture:** Two root causes are addressed: (1) when `fetchDetails` returns null (CLI error), the view silently falls through to the list - add explicit error handling; (2) the `ForgeIntegrationContext` can cause `ForgeIssuesTab` to unmount/remount (losing local state) when GitLab sources re-fetch fails - stabilize sources by preserving previous value on re-fetch failure.

**Tech Stack:** React, TypeScript, Vitest, Tauri

---

### Task 1: Add failing test for null detail fetch in ForgeIssuesTab

**Files:**
- Modify: `src/components/forge/ForgeIssuesTab.test.tsx`

**Step 1: Write the failing test**

Add test after existing "clicking issue fetches and shows detail view" test:

```typescript
it('shows error state when detail fetch returns null', async () => {
  const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
  const getIssueDetails = vi.fn().mockResolvedValue(null)

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      sources: [testSource],
      searchIssues,
      getIssueDetails,
    },
  })

  await waitFor(() => {
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  fireEvent.click(screen.getByText('Fix login bug'))

  await waitFor(() => {
    expect(screen.getByText('Failed to load details')).toBeTruthy()
  })
})

it('can retry after detail fetch failure', async () => {
  const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
  const getIssueDetails = vi.fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(makeDetails())

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      sources: [testSource],
      searchIssues,
      getIssueDetails,
    },
  })

  await waitFor(() => {
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  fireEvent.click(screen.getByText('Fix login bug'))

  await waitFor(() => {
    expect(screen.getByText('Failed to load details')).toBeTruthy()
  })

  fireEvent.click(screen.getByText('Retry'))

  await waitFor(() => {
    expect(screen.getByText('The login form crashes on submit.')).toBeTruthy()
  })
})

it('can go back to list after detail fetch failure', async () => {
  const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
  const getIssueDetails = vi.fn().mockResolvedValue(null)

  renderWithProviders(<ForgeIssuesTab />, {
    forgeOverrides: {
      hasSources: true,
      sources: [testSource],
      searchIssues,
      getIssueDetails,
    },
  })

  await waitFor(() => {
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  fireEvent.click(screen.getByText('Fix login bug'))

  await waitFor(() => {
    expect(screen.getByText('Failed to load details')).toBeTruthy()
  })

  fireEvent.click(screen.getByText('Back to list'))

  await waitFor(() => {
    expect(screen.getByText('Fix login bug')).toBeTruthy()
    expect(screen.queryByText('Failed to load details')).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && bunx vitest run src/components/forge/ForgeIssuesTab.test.tsx`
Expected: FAIL - "Failed to load details" text not found

### Task 2: Implement error handling for null details in ForgeIssuesTab

**Files:**
- Modify: `src/components/forge/ForgeIssuesTab.tsx`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`
- Modify: `src/common/i18n/types.ts`

**Step 1: Add i18n keys**

In `src/locales/en.json`, add to `forgeIssueTab`:
```json
"failedToLoadDetails": "Failed to load details",
"retry": "Retry"
```

In `src/locales/zh.json`, add equivalent keys.

In `src/common/i18n/types.ts`, add to `forgeIssueTab`:
```typescript
failedToLoadDetails: string
retry: string
```

**Step 2: Add error state and retry logic to ForgeIssuesTab**

In `src/components/forge/ForgeIssuesTab.tsx`:

1. Add `detailError` state:
```typescript
const [detailError, setDetailError] = useState(false)
```

2. Update `handleSelect` to detect null:
```typescript
const handleSelect = useCallback(
  (issue: ForgeIssueSummary) => {
    setSelectedId(issue.id)
    setLoadingDetails(true)
    setDetailError(false)
    setDetails(null)

    void search.fetchDetails(issue.id).then((d) => {
      if (!d) {
        setDetailError(true)
      } else {
        setDetails(d)
      }
      setLoadingDetails(false)
    }).catch((err) => {
      logger.error('[ForgeIssuesTab] Failed to fetch issue details', err)
      setDetailError(true)
      setLoadingDetails(false)
    })

    setSelectedSource(forge.sources.length > 1 ? forge.sources[0] : undefined)
  },
  [search, forge.sources]
)
```

3. Add `handleRetry` callback:
```typescript
const handleRetry = useCallback(() => {
  if (!selectedId) return
  setLoadingDetails(true)
  setDetailError(false)

  void search.fetchDetails(selectedId).then((d) => {
    if (!d) {
      setDetailError(true)
    } else {
      setDetails(d)
    }
    setLoadingDetails(false)
  }).catch((err) => {
    logger.error('[ForgeIssuesTab] Retry failed', err)
    setDetailError(true)
    setLoadingDetails(false)
  })
}, [selectedId, search])
```

4. Update `handleBack` to clear error:
```typescript
const handleBack = useCallback(() => {
  setSelectedId(null)
  setDetails(null)
  setDetailError(false)
  setSelectedSource(undefined)
}, [])
```

5. Add error view between loading and detail conditionals:
```typescript
if (selectedId && detailError) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2">
      <span style={{ fontSize: theme.fontSize.body, color: 'var(--color-text-muted)' }}>
        {t.forgeIssueTab.failedToLoadDetails}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="px-3 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
          }}
        >
          {t.forgeIssueTab.retry}
        </button>
        <button
          type="button"
          onClick={handleBack}
          className="px-3 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border-default)',
          }}
        >
          {t.forgeIssueTab.back}
        </button>
      </div>
    </div>
  )
}
```

**Step 3: Run test to verify it passes**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && bunx vitest run src/components/forge/ForgeIssuesTab.test.tsx`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/components/forge/ForgeIssuesTab.tsx src/components/forge/ForgeIssuesTab.test.tsx src/locales/en.json src/locales/zh.json src/common/i18n/types.ts
git commit -m "fix: show error state when forge issue detail fetch fails"
```

### Task 3: Apply same fix to ForgePrsTab

**Files:**
- Modify: `src/components/forge/ForgePrsTab.tsx`
- Modify: `src/locales/en.json` (forgePrTab section)
- Modify: `src/locales/zh.json` (forgePrTab section)
- Modify: `src/common/i18n/types.ts` (forgePrTab section)

Apply the identical pattern: add `detailError` state, update `handleSelect`, add `handleRetry`, add error view. Use `forgePrTab` i18n keys.

**Step 1: Run existing tests to verify baseline**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && bunx vitest run src/components/forge/ForgePrsTab.test.tsx`

**Step 2: Implement the same pattern in ForgePrsTab**

Follow identical changes as Task 2 but for PR tab.

**Step 3: Run tests**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && bunx vitest run src/components/forge/ForgePrsTab.test.tsx`

**Step 4: Commit**

```bash
git add src/components/forge/ForgePrsTab.tsx src/locales/en.json src/locales/zh.json src/common/i18n/types.ts
git commit -m "fix: show error state when forge PR detail fetch fails"
```

### Task 4: Stabilize ForgeIntegrationContext sources

**Files:**
- Modify: `src/contexts/ForgeIntegrationContext.tsx`
- Modify: `src/hooks/useForgeIntegration.ts`

**Step 1: Stabilize GitLab sources re-fetch**

In `src/contexts/ForgeIntegrationContext.tsx`, change the GitLab `.catch` handler to preserve previous sources instead of clearing them:

```typescript
useEffect(() => {
  if (!status) {
    setSources([])
    return
  }

  if (status.forgeType === 'github' && status.authenticated) {
    setSources([
      {
        projectIdentifier: '',
        hostname: status.hostname,
        label: 'GitHub',
        forgeType: 'github',
      },
    ])
  } else if (status.forgeType === 'gitlab' && status.authenticated) {
    invoke<GitlabSource[]>(TauriCommands.GitLabGetSources)
      .then((result) => {
        setSources(mapGitlabSourcesToForgeConfigs(result ?? []))
      })
      .catch((error) => {
        logger.error('[ForgeIntegrationContext] Failed to load GitLab sources', error)
        // Keep previous sources on re-fetch failure to prevent UI flicker
      })
  } else {
    setSources([])
  }
}, [status])
```

**Step 2: Memoize useForgeIntegration return value**

In `src/hooks/useForgeIntegration.ts`, memoize the return value to prevent unnecessary context updates:

```typescript
return useMemo(() => ({
  status,
  loading,
  refreshStatus,
  searchIssues,
  getIssueDetails,
  searchPrs,
  getPrDetails,
  createSessionPr,
  getReviewComments,
  approvePr,
  mergePr,
  commentOnPr,
}), [status, loading, refreshStatus, searchIssues, getIssueDetails, searchPrs, getPrDetails, createSessionPr, getReviewComments, approvePr, mergePr, commentOnPr])
```

**Step 3: Run full test suite**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && just test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/contexts/ForgeIntegrationContext.tsx src/hooks/useForgeIntegration.ts
git commit -m "fix: stabilize forge context to prevent issue tab remounts"
```

### Task 5: Final validation

**Step 1: Run full test suite**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/in_a_gitlab_repository && just test`
Expected: ALL PASS
