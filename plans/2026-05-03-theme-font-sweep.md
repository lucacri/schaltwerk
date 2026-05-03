# Theme & Font-Size Hardcoding Sweep — Phase 7+8 Audit

**Tier 3.8 audit. Doc-only — no code modified.**

CLAUDE.md mandates:
- "NEVER use hardcoded colors. The app supports 10 themes — all colors must come from the theme system."
- "NEVER use hardcoded font sizes. Use theme system."

This sweep walks every production `.tsx` / `.ts` file modified by Phase 7 (Wave A.1 → E.2 close-out) and Phase 8 (W.1 → patch 3 + overnight harden) and looks for theme/font violations introduced by those phases.

## Audit scope

- **Phase 7 boundary:** `1c00aa20` (Phase 7 plan) → `c4f07b6d^` (parent of Phase 8 plan).
- **Phase 8 boundary:** `c4f07b6d` (Phase 8 plan) → `HEAD` (`c6c83e89` overnight harden: atom dependency graph).
- **Scope filter:** `git diff --name-only <start>..HEAD -- '*.tsx' '*.ts'`, excluding `__tests__/`, `__mocks__/`, `*.test.*`, `*.spec.*`.
- **File counts:** 30 files changed in Phase 7, 81 in Phase 8, 91 unique across both phases (40 still extant after Phase 8 deletions).
- **Patterns probed:**
  - Hex literals: `#rgb`, `#rrggbb`, `#rrggbbaa`.
  - `rgb()`/`rgba()`/`hsl()`/`hsla()` literals (non-`var()`).
  - Tailwind arbitrary color: `text-[#…]`, `bg-[#…]`, `border-[rgb(…)]`, etc.
  - Tailwind palette colors: `text-blue-500`, `bg-amber-300`, `ring-pink-500`, etc.
  - Inline `style={{ color | background | backgroundColor | borderColor | fill | stroke }}` with non-`var()` strings.
  - Inline `fontSize: <number|string-with-unit>`.
  - Tailwind raw text-N: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, etc.
  - Tailwind arbitrary text size: `text-[Npx]`, `text-[N%]`.

Each suspect line was blamed and classified into one of three buckets:
- **Phase 7 introduction** (commit between `1c00aa20` and `c4f07b6d^`).
- **Phase 8 introduction** (commit between `c4f07b6d` and `HEAD`).
- **Pre-Phase-7** (commit already in `main`, or Phase 6 extract that just relocated existing main-branch code).

## 1. Phase 7+8 hardcoded-color violations

| File:Line | Snippet | Should use | Phase | Commit |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | — |

Zero color violations introduced by Phase 7 or Phase 8.

Notes:
- Every `rgba(var(--color-…-rgb), …)` and `rgb(var(--color-…-rgb) / …)` call in modified files (`App.tsx`, `TerminalGrid.tsx`, `SessionCard.tsx`) references theme tokens — these are the intended theme-aware alpha pattern.
- Two hits for `color: 'blue'` (`SessionPrimitivesSection.tsx:38`) and `color: 'slate'` (`SettingsModal.tsx:1830`) are domain field assignments on `Epic` / `HeaderActionConfig` objects — not CSS values. Not violations.
- The Tailwind palette colors flagged (`text-amber-300`, `text-green-400`, `border-cyan-400/60`, `ring-blue-500/70`, `ring-pink-500/50`, `bg-blue-600/20`) all blame to commits already in `main` or to Phase 6 extracts of pre-existing main code — see "Pre-existing tech debt" below.

## 2. Phase 7+8 hardcoded font-size violations

| File:Line | Snippet | Should use | Phase | Commit |
| --- | --- | --- | --- | --- |
| `src/components/sidebar/views/SidebarHeaderBar.tsx:50` | `className="… text-[11px] uppercase tracking-wider opacity-60 cursor-not-allowed"` | Tailwind class `text-caption` (or inline `theme.fontSize.caption` / `var(--font-caption)`) — `text-caption` matches `font-size: 11px` per the theme system. | Phase 7 | `3f2ff6e3` (`feat(taskflow-v2): visibly disable kanban view for v2 cutover`) |

One Phase 7 font-size hit — and even this is a **preserved** violation, not a fresh one. The commit reshaped a button that already had `text-[11px]` in `main` (line 1647 of pre-extract `Sidebar.tsx`). The kanban-disable patch rewrote the button's className but left `text-[11px]` in place. Strictly speaking, the violation is recreated rather than newly authored, but for scoring purposes it counts as a Phase 7 line in the current tree.

Zero Phase 8 font-size violations.

## 3. Pre-existing tech debt

These are violations that exist on this branch but were authored either before the Phase 7 plan landed or as part of Phase 6 extract refactors that simply moved already-on-main code into new files. Not in scope to fix as part of the v2 merge — they exist identically on `main`.

**Repo-wide baseline (production `src/`, theme-system files excluded):**
- 393 raw `text-N` Tailwind utility lines across 65 files.
- 60 `text-[Npx]` arbitrary-size lines across 23 files.
- 3 files contain hex literals — and all 3 are theme-system definition files (allowed): `src/common/themes/presets.ts`, `src/common/theme.ts`, `src/components/settings/ThemeSettings.tsx`.

**Pre-existing violations surfaced inside Phase 7+8-touched files (counts only, not catalogued):**

| File | text-N | text-[Npx] | Tailwind palette |
| --- | --- | --- | --- |
| `src/App.tsx` | 2 | 1 | 0 |
| `src/components/terminal/Terminal.tsx` | 2 | 0 | 0 |
| `src/components/terminal/TerminalGrid.tsx` | 2 | 3 | 0 |
| `src/components/sidebar/views/SidebarHeaderBar.tsx` | 1 | 1 | 0 |
| `src/components/sidebar/views/OrchestratorEntry.tsx` | 2 | 1 | 3 |
| `src/components/right-panel/RightPanelTabs.tsx` | 0 | 0 | 1 |
| `src/components/modals/SettingsModal.tsx` | 0 | 0 | 5 |

All entries above blame to commits in `main` (e.g., `f4903718f`, `1cb451b85`, `1452aad97`, `7e3203fcf`, `567ed6f4b`, `f1c7f9209`, `d063e41d6`, `e2bc5ebec`, `e15c94e2f`, `bd63afc99`, `950b24b52`, `a1a83186c`) **or** to Phase 6 extract commits that copied already-in-main code into new files (`4c90ed359`, `8aac82369`).

Phase 6 extracts are doubly clean from a v2-merge standpoint: they preserve byte-for-byte the className strings already on `main`. They surface in the audit only because the file path moved.

## 4. Style-guide exceptions

The brief allows lenience on `src/style-guide/sections/*` (style-guide intentionally renders sample primitives). Phase 7+8 modified one such file:

- `src/style-guide/sections/SessionPrimitivesSection.tsx` — clean. No raw `text-N`, no `text-[Npx]`, no hex literals, no inline color/font literals. The only pattern hit is `color: 'blue'` at line 38, which is an `Epic` domain object literal (epic color name, not a CSS color).

No style-guide leniency was needed.

## 5. Recommendations

| Item | Phase | Action | Rationale |
| --- | --- | --- | --- |
| `SidebarHeaderBar.tsx:50` `text-[11px]` | Phase 7 (preserved violation) | **No-action / post-merge** | The original button on `main` already used `text-[11px]`. Switching to `text-caption` here would be a fix to pre-existing tech debt, not a Phase 7 regression. Address as part of a focused class-token sweep, not as a v2 merge gate. |
| Pre-existing pre-Phase-7 violations (393 + 60) | n/a | **Post-merge / no-action** | Identical to `main`. Out of v2 scope. |
| Style-guide exceptions | n/a | **No-action** | None needed. |

## Pre-merge fix queue

Empty.

Phase 7 introduced one preserved (not new) `text-[11px]` literal that already existed on `main`. Phase 8 introduced none. There are no Phase-7- or Phase-8-authored hardcoded color or font-size violations that warrant blocking the v2 merge.
