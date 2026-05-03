// Phase 8 W.6 — three arch pins for the post-purge surface.
//
// These tests grep production source for patterns that would
// indicate a regression of the legacy v1 session-shape leak. The
// allowlist is the full set of modules + components that retired in
// Phase 8 W.1–W.4. Any new file (or restored old file) that
// references these names from production code fails the suite.
//
// Pattern: each forbidden symbol is searched verbatim across the
// `src/` tree (excluding tests, the style guide, the migration
// archive comment in `mod.rs`, and ourselves). Matches are reported
// as a single combined error so the user sees every leak in one
// pass.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(__dirname, '..', '..')

interface ForbiddenSymbol {
  symbol: string
  rationale: string
}

// Phase 8 retired surfaces. Production source must not reference them.
// `KeyboardShortcutAction.NewSession` and `.NewSpec` were collapsed to
// `.NewTask` in W.2; `lucode_task_capture_session` and friends went in
// W.3; `v1_to_v2_specs_to_tasks` is the W.4 retiree.
//
// Symbols are matched against non-comment lines only (single-line
// comments and block comments inside file headers are stripped before
// the scan), so explanatory headers like
// "// W.1 retired SidebarSessionList" do not trip the pin.
const RETIRED_FRONTEND_SYMBOLS: ForbiddenSymbol[] = [
  { symbol: 'KeyboardShortcutAction.NewSession', rationale: 'collapsed into NewTask in W.2' },
  { symbol: 'KeyboardShortcutAction.NewSpec', rationale: 'collapsed into NewTask in W.2' },
  { symbol: 'NewSessionRequest', rationale: 'replaced by NewTaskRequest in W.2' },
  { symbol: 'NewSpecRequest', rationale: 'replaced by NewTaskRequest in W.2' },
  { symbol: 'GlobalNewSessionShortcut', rationale: 'retired with the legacy modal in W.2' },
  { symbol: 'NewSessionModal', rationale: 'retired in W.2; use NewTaskModal' },
  { symbol: 'SidebarSessionList', rationale: 'retired in W.1; sidebar is task-driven' },
  { symbol: 'EpicGroupHeader', rationale: 'retired in W.1; tasks group via stage sections' },
  { symbol: 'CompactVersionRow', rationale: 'retired in W.1' },
  // Note: utils/sessionVersions.ts still exports a SessionVersionGroup
  // helper TYPE (not the retired React component). Cleaning that up is
  // out of W.6 scope; the component itself is deleted, which is what
  // matters for the dual-mount regression class.
  { symbol: 'KanbanView', rationale: 'retired in W.1' },
  { symbol: 'onCaptureAsTask', rationale: 'retired in W.3; tasks are top-level' },
  { symbol: 'captureSessionAsTask', rationale: 'retired in W.3' },
  { symbol: 'captureVersionGroupAsTask', rationale: 'retired in W.3' },
  { symbol: 'LucodeTaskCaptureSession', rationale: 'retired in W.3 (Tauri command enum)' },
  { symbol: 'LucodeTaskCaptureVersionGroup', rationale: 'retired in W.3' },
]

// Files we explicitly tolerate referencing the retired symbols.
// These are: the arch tests themselves, and any tests that pin the
// absence of the symbol (e.g., a test asserting the menu item does
// NOT render).
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  '__tests__/arch_no_v1_session_leakage.test.ts',
  'components/__tests__/arch_no_v1_session_leakage.test.ts',
  'components/sidebar/SessionCard.test.tsx',
  'components/sidebar/views/SidebarStageSectionsView.test.tsx',
  'components/sidebar/Sidebar.test.tsx',
  'style-guide/StyleGuide.test.tsx',
])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      yield* walk(full)
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts')
    ) {
      yield full
    }
  }
}

function isAllowed(relPath: string): boolean {
  if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) {
    return true
  }
  return ALLOWED_FILES.has(relPath)
}

// Strip line comments and block comments so symbol-in-comment hits
// (e.g., a file header explaining what was retired) don't trip the
// pin. Block comments are conservatively stripped at line granularity:
// a line that contains `/*` through to a `*/` on the same line gets
// the inner text removed; a multi-line block is approximated by
// stripping every line whose first non-whitespace token is `*`.
function stripComments(line: string): string {
  let stripped = line
  const blockMatch = stripped.match(/\/\*.*\*\//)
  if (blockMatch) {
    stripped = stripped.replace(/\/\*.*\*\//g, '')
  }
  const commentIdx = stripped.indexOf('//')
  if (commentIdx >= 0) {
    stripped = stripped.slice(0, commentIdx)
  }
  const trimmed = stripped.trim()
  if (trimmed.startsWith('*')) {
    return ''
  }
  return stripped
}

describe('arch_no_v1_session_leakage — Phase 8 retired symbols', () => {
  for (const { symbol, rationale } of RETIRED_FRONTEND_SYMBOLS) {
    it(`no production source references "${symbol}" (${rationale})`, () => {
      const violations: Array<{ file: string; line: number; text: string }> = []

      for (const path of walk(SRC_ROOT)) {
        const relPath = relative(SRC_ROOT, path)
        if (isAllowed(relPath)) continue

        const text = readFileSync(path, 'utf8')
        if (!text.includes(symbol)) continue

        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i += 1) {
          const codeOnly = stripComments(lines[i])
          if (codeOnly.includes(symbol)) {
            violations.push({ file: relPath, line: i + 1, text: lines[i].trim() })
          }
        }
      }

      if (violations.length > 0) {
        const detail = violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text.slice(0, 120)}`)
          .join('\n')
        throw new Error(
          `Found ${violations.length} reference(s) to retired symbol "${symbol}".\n` +
            `Reason: ${rationale}\n` +
            `If a test legitimately needs to reference this symbol to pin its absence, add the file to ALLOWED_FILES.\n` +
            detail,
        )
      }
      expect(violations).toEqual([])
    })
  }
})
