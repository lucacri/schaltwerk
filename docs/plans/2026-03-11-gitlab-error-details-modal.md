# GitLab Error Details Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface raw per-source error details behind a "Details" button in the GitLab Issues/MRs error banner so users can debug why a specific source fails.

**Architecture:** Extend the search hooks to capture raw error messages per-source alongside the summary error string. Add a shared modal component that displays these per-source errors. Wire the modal into both GitlabIssuesTab and GitlabMrsTab error banners.

**Tech Stack:** React, TypeScript, Vitest, existing theme system, existing i18n system

---

## Root Cause Analysis

The `.catch()` handlers in `useGitlabIssueSearch` and `useGitlabMrSearch` discard the raw backend error — they only push `source.label` into `failedSources[]`. The actual error from `invoke()` (which contains the `glab` CLI error message, auth failures, project path errors, etc.) is logged via `logger.warn()` but never exposed to the UI.

---

### Task 1: Extend useGitlabIssueSearch to capture per-source errors

**Files:**
- Modify: `src/hooks/useGitlabIssueSearch.ts`
- Test: `src/hooks/__tests__/useGitlabIssueSearch.test.tsx`

**Step 1: Write the failing test**

Add a test that verifies `errorDetails` is populated with per-source error info when a source fails:

```typescript
it('exposes per-source error details on partial failure', async () => {
  const sourceA = makeSource('1', 'Project A', 'group/project-a')
  const sourceB = makeSource('2', 'Project B', 'group/project-b')
  const issuesA = [makeIssue(1, 'Project A')]

  mockInvoke.mockImplementation((_cmd: string, args?: Record<string, unknown>) => {
    if (args?.sourceProject === 'group/project-a') return Promise.resolve(issuesA)
    if (args?.sourceProject === 'group/project-b') return Promise.reject('glab command failed (api list): 403 Forbidden')
    return Promise.resolve([])
  })

  const { result } = renderHook(() => useGitlabIssueSearch({ sources: [sourceA, sourceB] }))

  await waitFor(() => { expect(result.current.loading).toBe(false) })

  expect(result.current.errorDetails).toHaveLength(1)
  expect(result.current.errorDetails![0].source).toBe('Project B')
  expect(result.current.errorDetails![0].message).toContain('403 Forbidden')
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/hooks/__tests__/useGitlabIssueSearch.test.tsx`
Expected: FAIL — `errorDetails` property does not exist

**Step 3: Implement — add errorDetails to the hook**

In `src/hooks/useGitlabIssueSearch.ts`:

1. Add `SourceError` type and export it:
```typescript
export interface SourceError {
  source: string
  message: string
}
```

2. Add to `UseGitlabIssueSearchResult`:
```typescript
errorDetails: SourceError[] | null
```

3. Add state:
```typescript
const [errorDetails, setErrorDetails] = useState<SourceError[] | null>(null)
```

4. In `executeSearch`, change `failedSources` from `string[]` to `SourceError[]`:
```typescript
const failedSources: SourceError[] = []
```

5. In the `.catch()` handler:
```typescript
.catch(err => {
  failedSources.push({ source: source.label, message: resolveErrorMessage(err) })
  logger.warn(`Failed to search GitLab issues for source ${source.label}`, err)
  return [] as GitlabIssueSummary[]
})
```

6. After the `Promise.all`, update both error and errorDetails:
```typescript
if (failedSources.length > 0) {
  setError(`Failed to fetch issues from ${failedSources.map(f => f.source).join(', ')}`)
  setErrorDetails(failedSources)
} else {
  setError(null)
  setErrorDetails(null)
}
```

7. In the outer `catch`:
```typescript
setErrorDetails(null)
```

8. In `clearError`:
```typescript
const clearError = useCallback(() => {
  setError(null)
  setErrorDetails(null)
}, [])
```

9. Add `errorDetails` to the return object.

**Step 4: Run test to verify it passes**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/hooks/__tests__/useGitlabIssueSearch.test.tsx`
Expected: ALL PASS

**Step 5: Also add a test for clearError clearing errorDetails**

```typescript
it('clearError clears errorDetails', async () => {
  const sourceA = makeSource('1', 'Project A', 'group/project-a')

  mockInvoke.mockImplementation(() => Promise.reject('network error'))

  const { result } = renderHook(() => useGitlabIssueSearch({ sources: [sourceA] }))

  await waitFor(() => { expect(result.current.loading).toBe(false) })
  expect(result.current.errorDetails).toHaveLength(1)

  act(() => { result.current.clearError() })

  expect(result.current.error).toBeNull()
  expect(result.current.errorDetails).toBeNull()
})
```

**Step 6: Run full hook tests**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/hooks/__tests__/useGitlabIssueSearch.test.tsx`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/hooks/useGitlabIssueSearch.ts src/hooks/__tests__/useGitlabIssueSearch.test.tsx
git commit -m "feat: expose per-source error details in useGitlabIssueSearch hook"
```

---

### Task 2: Extend useGitlabMrSearch with the same pattern

**Files:**
- Modify: `src/hooks/useGitlabMrSearch.ts`

**Step 1: Apply the identical pattern from Task 1 to useGitlabMrSearch**

The changes mirror Task 1 exactly but for the MR hook:

1. Import `SourceError` from `useGitlabIssueSearch` (shared type) — or better, define the type in a shared location. Since both hooks live in the same directory, export `SourceError` from `useGitlabIssueSearch.ts` and import it in `useGitlabMrSearch.ts`.

2. Add `errorDetails: SourceError[] | null` to `UseGitlabMrSearchResult`
3. Add `errorDetails` state
4. Change `failedSources` to `SourceError[]` in `executeSearch`
5. Capture raw error in `.catch()`
6. Set `errorDetails` alongside `error`
7. Clear `errorDetails` in `clearError` and outer catch
8. Return `errorDetails`

**Step 2: Run lint to verify no type errors**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hooks/useGitlabMrSearch.ts
git commit -m "feat: expose per-source error details in useGitlabMrSearch hook"
```

---

### Task 3: Add i18n key for "Details" button

**Files:**
- Modify: `src/common/i18n/types.ts`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json` (if it exists)

**Step 1: Add i18n key**

In `src/common/i18n/types.ts`, add to `gitlabIssueTab`:
```typescript
errorDetails: string
```

And to `gitlabMrTab`:
```typescript
errorDetails: string
```

In `src/locales/en.json`, add to `gitlabIssueTab`:
```json
"errorDetails": "Details"
```

And to `gitlabMrTab`:
```json
"errorDetails": "Details"
```

Do the same for `zh.json` with appropriate translation.

**Step 2: Run lint**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/common/i18n/types.ts src/locales/en.json src/locales/zh.json
git commit -m "feat: add i18n keys for GitLab error details button"
```

---

### Task 4: Create GitlabErrorDetailsModal component

**Files:**
- Create: `src/components/gitlab/GitlabErrorDetailsModal.tsx`
- Create: `src/components/gitlab/__tests__/GitlabErrorDetailsModal.test.tsx`

**Step 1: Write the failing test**

```typescript
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabErrorDetailsModal } from '../GitlabErrorDetailsModal'
import { describe, it, expect, vi } from 'vitest'

describe('GitlabErrorDetailsModal', () => {
  it('renders per-source errors', () => {
    const errors = [
      { source: 'Backend', message: 'glab command failed: 403 Forbidden' },
      { source: 'Frontend', message: 'glab command failed: network timeout' },
    ]
    renderWithProviders(
      <GitlabErrorDetailsModal errors={errors} onClose={vi.fn()} />
    )

    expect(screen.getByText('Backend')).toBeInTheDocument()
    expect(screen.getByText('glab command failed: 403 Forbidden')).toBeInTheDocument()
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('glab command failed: network timeout')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <GitlabErrorDetailsModal
        errors={[{ source: 'Test', message: 'error' }]}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <GitlabErrorDetailsModal
        errors={[{ source: 'Test', message: 'error' }]}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/components/gitlab/__tests__/GitlabErrorDetailsModal.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement the modal**

Create `src/components/gitlab/GitlabErrorDetailsModal.tsx`:

```typescript
import { useEffect } from 'react'
import { VscClose } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import type { SourceError } from '../../hooks/useGitlabIssueSearch'

interface GitlabErrorDetailsModalProps {
  errors: SourceError[]
  onClose: () => void
}

export function GitlabErrorDetailsModal({ errors, onClose }: GitlabErrorDetailsModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: theme.layers.modalOverlay, backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-3 rounded-lg shadow-xl"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          maxWidth: 520,
          width: '90%',
          maxHeight: '70vh',
          padding: 16,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span style={{ fontSize: theme.fontSize.bodyLarge, color: 'var(--color-text-primary)', fontWeight: 600 }}>
            Error Details
          </span>
          <button type="button" onClick={onClose} aria-label="close" style={{ color: 'var(--color-text-muted)' }}>
            <VscClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '55vh' }}>
          {errors.map((err) => (
            <div
              key={err.source}
              className="flex flex-col gap-1 rounded"
              style={{
                padding: '8px 10px',
                backgroundColor: 'var(--color-accent-red-bg)',
                border: '1px solid var(--color-accent-red-border)',
              }}
            >
              <span style={{ fontSize: theme.fontSize.body, fontWeight: 600, color: 'var(--color-accent-red)' }}>
                {err.source}
              </span>
              <pre
                style={{
                  fontSize: theme.fontSize.caption,
                  fontFamily: theme.fontFamily.mono,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}
              >
                {err.message}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/components/gitlab/__tests__/GitlabErrorDetailsModal.test.tsx`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/components/gitlab/GitlabErrorDetailsModal.tsx src/components/gitlab/__tests__/GitlabErrorDetailsModal.test.tsx
git commit -m "feat: add GitlabErrorDetailsModal component for per-source error display"
```

---

### Task 5: Wire error details into GitlabIssuesTab

**Files:**
- Modify: `src/components/right-panel/GitlabIssuesTab.tsx`
- Test: `src/components/right-panel/__tests__/GitlabIssuesTab.test.tsx`

**Step 1: Write the failing test**

Add to `GitlabIssuesTab.test.tsx`:

```typescript
it('shows error details modal when Details button is clicked', async () => {
  mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
    if (args?.sourceProject === 'group/backend') return backendIssues
    if (args?.sourceProject === 'group/frontend') return Promise.reject('403 Forbidden')
    return []
  })

  renderWithProviders(<GitlabIssuesTab />, {
    gitlabOverrides: {
      sources: [backendSource, frontendSource],
      hasSources: true,
      status: { installed: true, authenticated: true },
    },
  })

  await waitFor(() => {
    expect(screen.getByText(/Failed to fetch issues/)).toBeInTheDocument()
  })

  fireEvent.click(screen.getByText('Details'))

  await waitFor(() => {
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/components/right-panel/__tests__/GitlabIssuesTab.test.tsx`
Expected: FAIL — no "Details" button found

**Step 3: Implement — add Details button and modal to GitlabIssuesTab**

In `src/components/right-panel/GitlabIssuesTab.tsx`:

1. Add imports:
```typescript
import { GitlabErrorDetailsModal } from '../gitlab/GitlabErrorDetailsModal'
```

2. Add state for modal visibility:
```typescript
const [showErrorDetails, setShowErrorDetails] = useState(false)
```

3. Modify the error banner (lines 89-107) to add a Details button between the error text and the close button:
```typescript
{search.error && (
  <div
    className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
    style={{
      fontSize: theme.fontSize.caption,
      color: 'var(--color-accent-red)',
      backgroundColor: 'var(--color-accent-red-bg)',
    }}
  >
    <span className="truncate">{search.error}</span>
    <div className="flex items-center gap-1 flex-shrink-0">
      {search.errorDetails && (
        <button
          type="button"
          onClick={() => setShowErrorDetails(true)}
          style={{
            color: 'var(--color-accent-red)',
            textDecoration: 'underline',
            fontSize: theme.fontSize.caption,
          }}
        >
          {t.gitlabIssueTab.errorDetails}
        </button>
      )}
      <button
        type="button"
        onClick={search.clearError}
        style={{ color: 'var(--color-accent-red)' }}
      >
        <VscClose className="w-3 h-3" />
      </button>
    </div>
  </div>
)}
```

4. Add the modal render at the end of the component return, just before the closing `</div>`:
```typescript
{showErrorDetails && search.errorDetails && (
  <GitlabErrorDetailsModal
    errors={search.errorDetails}
    onClose={() => setShowErrorDetails(false)}
  />
)}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bunx vitest run src/components/right-panel/__tests__/GitlabIssuesTab.test.tsx`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/components/right-panel/GitlabIssuesTab.tsx src/components/right-panel/__tests__/GitlabIssuesTab.test.tsx
git commit -m "feat: add error details button and modal to GitlabIssuesTab"
```

---

### Task 6: Wire error details into GitlabMrsTab

**Files:**
- Modify: `src/components/right-panel/GitlabMrsTab.tsx`

**Step 1: Apply identical pattern from Task 5 to GitlabMrsTab**

1. Add imports: `GitlabErrorDetailsModal`
2. Add `showErrorDetails` state
3. Add Details button to error banner
4. Add modal render
5. Use `t.gitlabMrTab.errorDetails` for the button text

**Step 2: Run lint**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/right-panel/GitlabMrsTab.tsx
git commit -m "feat: add error details button and modal to GitlabMrsTab"
```

---

### Task 7: Run full validation suite

**Step 1: Run full test suite**

Run: `cd /Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/debug-issue-fetch && just test`
Expected: ALL PASS

**Step 2: Fix any failures if present**

If any test or lint failures, fix them and re-run.
