import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMPONENTS_DIR = join(__dirname, '..')
const HARD_CAP_LINES = 500

// Ratchet allowlist: components that currently exceed the cap. New
// additions are PROHIBITED. When a file on this list is split below
// the cap, REMOVE it from the list — the third sub-test below will
// then enforce the cap on it permanently.
//
// Sidebar.tsx came off this list in Phase 6 (task-flow v2 §10).
const LEGACY_OVERSIZED_ALLOWLIST: ReadonlySet<string> = new Set([
    'diff/UnifiedDiffView.tsx',
    'diff/DiffFileList.tsx',
    'diff/PierreDiffViewer.tsx',
    'diff/SimpleDiffPanel.tsx',
    'forge/ForgePrDetail.tsx',
    'git-graph/GitGraphPanel.tsx',
    'home/AsciiBuilderLogo.tsx',
    'modals/GitHubPrPromptSection.tsx',
    'modals/MergeSessionModal.tsx',
    'modals/NewSessionModal.tsx',
    'modals/PrSessionModal.tsx',
    'modals/SettingsModal.tsx',
    'modals/UnifiedSearchModal.tsx',
    'right-panel/CopyContextBar.tsx',
    'right-panel/RightPanelTabs.tsx',
    'shared/SessionConfigurationPanel.tsx',
    'sidebar/CompactVersionRow.tsx',
    'sidebar/SessionCard.tsx',
    'sidebar/SessionVersionGroup.tsx',
    'specs/SpecEditor.tsx',
    'terminal/Terminal.tsx',
    'terminal/TerminalGrid.tsx',
])

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        if (entry === '__tests__' || entry === 'node_modules') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            yield* walk(full)
        } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
            yield full
        }
    }
}

function lineCountOf(path: string): number {
    return readFileSync(path, 'utf8').split('\n').length
}

describe('component file size cap', () => {
    it(`no .tsx component exceeds ${HARD_CAP_LINES} lines (with grandfathered allowlist)`, () => {
        const violations: Array<{ file: string; lines: number }> = []
        for (const path of walk(COMPONENTS_DIR)) {
            const lineCount = lineCountOf(path)
            const relPath = relative(COMPONENTS_DIR, path)
            if (lineCount > HARD_CAP_LINES && !LEGACY_OVERSIZED_ALLOWLIST.has(relPath)) {
                violations.push({ file: relPath, lines: lineCount })
            }
        }
        if (violations.length > 0) {
            const detail = violations.map(v => `  ${v.file}: ${v.lines} lines`).join('\n')
            throw new Error(
                `Found ${violations.length} .tsx component(s) exceeding ${HARD_CAP_LINES} lines.\n` +
                `Either split the file or, if legitimately needed, add to LEGACY_OVERSIZED_ALLOWLIST with a justification comment.\n` +
                detail
            )
        }
        expect(violations).toEqual([])
    })

    it(`Sidebar.tsx is at or below the cap (Phase 6 DoD)`, () => {
        const path = join(COMPONENTS_DIR, 'sidebar', 'Sidebar.tsx')
        const lineCount = lineCountOf(path)
        expect(lineCount).toBeLessThanOrEqual(HARD_CAP_LINES)
    })

    it('LEGACY_OVERSIZED_ALLOWLIST does not contain stale entries', () => {
        const stale: string[] = []
        for (const relPath of LEGACY_OVERSIZED_ALLOWLIST) {
            const full = join(COMPONENTS_DIR, relPath)
            const lineCount = lineCountOf(full)
            if (lineCount <= HARD_CAP_LINES) {
                stale.push(`${relPath}: ${lineCount} lines (now under cap; remove from allowlist)`)
            }
        }
        if (stale.length > 0) {
            throw new Error(
                `Found ${stale.length} stale allowlist entries. Remove them so the cap is enforced going forward.\n` +
                stale.join('\n')
            )
        }
        expect(stale).toEqual([])
    })
})
