// Phase 8 pre-smoke arch pin (Gap 5).
//
// `Selection.kind` is a 5-variant discriminated union (see
// `src/store/atoms/selection.ts`):
//   'session' | 'orchestrator' | 'task' | 'task-run' | 'task-slot'
//
// `selectionHelpers.ts` provides the canonical exhaustive matcher
// (`matchSelection`) and the `assertNeverKind` helper. All four
// `switch (selection.kind)` blocks in the codebase live inside that
// helper file and end with a `default: assertNeverKind(selection)`
// arm. Other consumers must NOT open-code their own `switch
// (selection.kind)`; they should call into the helpers (or use
// `matchSelection`) so adding a new variant fails-to-compile rather
// than silently coercing.
//
// This pin walks `src/` and fails if any file outside
// `selectionHelpers.ts` (and tests) contains a `switch
// (selection.kind)` block.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(__dirname, '..', '..')

const ALLOWED_FILES: ReadonlySet<string> = new Set([
  // Canonical home of the kind dispatch and `assertNeverKind`.
  'store/atoms/selectionHelpers.ts',
])

const SWITCH_PATTERN = /switch\s*\(\s*selection\.kind\s*\)/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      yield* walk(full)
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      yield full
    }
  }
}

interface KindSwitchHit {
  file: string
  line: number
  text: string
}

describe('arch_selection_kind_exhaustiveness — kind dispatch lives in helpers only', () => {
  it('no file other than selectionHelpers.ts contains `switch (selection.kind)`', () => {
    const violations: KindSwitchHit[] = []

    for (const path of walk(SRC_ROOT)) {
      const relPath = relative(SRC_ROOT, path)
      if (ALLOWED_FILES.has(relPath)) continue

      const text = readFileSync(path, 'utf8')
      if (!SWITCH_PATTERN.test(text)) continue

      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (SWITCH_PATTERN.test(lines[i])) {
          violations.push({ file: relPath, line: i + 1, text: lines[i].trim() })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.text.slice(0, 120)}`)
        .join('\n')
      throw new Error(
        `Found ${violations.length} open-coded \`switch (selection.kind)\` block(s).\n` +
          `Route the dispatch through \`matchSelection\` / \`selectionTo*\`\n` +
          `helpers in src/store/atoms/selectionHelpers.ts so adding a new\n` +
          `variant fails to compile rather than silently coercing.\n` +
          detail,
      )
    }
    expect(violations).toEqual([])
  })

  it('regex catches the documented switch shapes', () => {
    expect(SWITCH_PATTERN.test('switch (selection.kind) {')).toBe(true)
    expect(SWITCH_PATTERN.test('switch( selection.kind ){')).toBe(true)
    expect(SWITCH_PATTERN.test('switch  (\tselection.kind\t)')).toBe(true)
  })

  it('regex ignores unrelated switch shapes', () => {
    expect(SWITCH_PATTERN.test('switch (other.kind)')).toBe(false)
    expect(SWITCH_PATTERN.test('switch (selection.payload)')).toBe(false)
    expect(SWITCH_PATTERN.test('switch (sel.kind)')).toBe(false)
  })
})
