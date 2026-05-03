// Phase 8 pre-smoke arch pin (Gap 4).
//
// CLAUDE.md mandates: every Tauri `invoke()` call routes through the
// `TauriCommands` enum at `src/common/tauriCommands.ts`. Raw string
// literals (or template literals, or backtick strings) for command
// names are forbidden — they bypass the single source of truth and
// cannot be type-checked when commands are renamed.
//
// This pin walks `src/` and fails if any production source contains:
//   invoke('...')  | invoke("...")  | invoke(`...`)
//   core.invoke('...')  | tauri.invoke('...')  ...
//
// The verified-clean alternates (template literals, prefixed call
// shapes) are all included. Comment lines are stripped before the
// scan to allow explanatory headers ("// historically called via
// invoke('foo'), now routed through TauriCommands").

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(__dirname, '..', '..')

// Match `[prefix.]invoke(<quote>...<quote>` where <quote> is `'`, `"`,
// or backtick. Whitespace tolerated between `invoke` and `(`. The
// optional prefix tolerates `core.`, `tauri.`, or any identifier path
// (e.g. `coreModule.invoke('x')`).
const RAW_INVOKE_PATTERN = /(?:[A-Za-z_$][\w$]*\.)?invoke\s*\(\s*['"`]/g

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

// Strip line comments (and conservatively, lines that are obviously
// inside a block-comment continuation — start with `*`). The scan does
// NOT need to handle in-line block comments; a developer adding a
// raw `invoke()` call alongside a `/* … */` is still violating.
function stripCommentLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//')) return ''
      if (trimmed.startsWith('*')) return ''
      const commentIdx = line.indexOf('//')
      if (commentIdx >= 0) {
        return line.slice(0, commentIdx)
      }
      return line
    })
    .join('\n')
}

interface RawInvokeHit {
  file: string
  line: number
  text: string
}

describe('arch_no_raw_invoke — Tauri command enum is single source of truth', () => {
  it('no production source uses raw string literal in invoke()', () => {
    const violations: RawInvokeHit[] = []

    for (const path of walk(SRC_ROOT)) {
      const relPath = relative(SRC_ROOT, path)
      const text = readFileSync(path, 'utf8')
      // Quick bail-out before the per-line walk.
      if (!/invoke\s*\(/.test(text)) continue

      const stripped = stripCommentLines(text)
      const lines = stripped.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (!line) continue
        RAW_INVOKE_PATTERN.lastIndex = 0
        if (RAW_INVOKE_PATTERN.test(line)) {
          violations.push({
            file: relPath,
            line: i + 1,
            text: line.trim(),
          })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.text.slice(0, 120)}`)
        .join('\n')
      throw new Error(
        `Found ${violations.length} raw invoke() call(s) using a string literal command name.\n` +
          `CLAUDE.md mandates routing through the TauriCommands enum at\n` +
          `src/common/tauriCommands.ts — add the entry to the enum and replace\n` +
          `the literal with the enum member.\n` +
          detail,
      )
    }
    expect(violations).toEqual([])
  })

  it('regex catches every documented invoke shape', () => {
    const samples = [
      `invoke('lucode_x')`,
      `invoke("lucode_x")`,
      'invoke(`lucode_x`)',
      `core.invoke('lucode_x')`,
      `tauri.invoke("lucode_x")`,
      `someModule.invoke(\`lucode_x\`)`,
      `invoke (  'lucode_x' )`,
    ]
    for (const sample of samples) {
      RAW_INVOKE_PATTERN.lastIndex = 0
      expect(RAW_INVOKE_PATTERN.test(sample)).toBe(true)
    }
  })

  it('regex ignores enum-routed invoke() calls', () => {
    const samples = [
      `invoke(TauriCommands.LucodeX, args)`,
      `invoke(commandName, args)`,
      `core.invoke(TauriCommands.LucodeX)`,
      `await invoke<RawSession>(TauriCommands.GetSession, { name })`,
    ]
    for (const sample of samples) {
      RAW_INVOKE_PATTERN.lastIndex = 0
      expect(RAW_INVOKE_PATTERN.test(sample)).toBe(false)
    }
  })
})
