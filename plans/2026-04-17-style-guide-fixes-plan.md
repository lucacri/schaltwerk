# Style Guide — Consolidated Fix Plan

Execution plan derived from `plans/style-guide-audit.md`. Focused on code-side work; pen-side fabrications were already stripped in commits `cf516d9a` + `129466de` (pen cleanup passes 1+2).

## Guiding rules

- **Batch token fixes first.** Many per-component drifts collapse to a single token change (e.g., `--control-height-md`). Do those before touching individual components.
- **Extract missing primitives next.** Shared `Badge`, `Chip`, `DropdownMenu`, `CountBadge` block downstream work. Extracting them once lets every call site migrate without re-arguing the design.
- **Reconcile semantic disagreements explicitly.** Running-badge blue-vs-green, danger/warning/success default-vs-hover — these need a product decision before code moves. Flag, don't guess.
- **Test after every change.** `just test` per CLAUDE.md. No leaving the suite red.
- **Bump the pen version marker** after each pen edit batch (`cleanup 3`, `cleanup 4`, …) so the design ↔ code handshake stays legible.

## Phase 3A — Semantic decisions (non-code, needs product input)

These gate downstream work. Resolve before starting the tranches below.

| # | Question | Options | Source |
|---|---|---|---|
| D1 | Running badge at group level — green or blue? | Pen says green (matches `dbZiO` ready-green convention per treatment view); React uses blue `tone: 'blue'`. | QNpSD, xzyG4 |
| D2 | Danger/Warning/Success button default — solid or tinted? | Pen documents solid (with inverse text). React ships tinted (accent text) and flips to solid on hover. | 6hdj9 |
| D3 | Primary button text color — `#ffffff` or `text-inverse` (`#0e0e12`)? | Pen says white. React uses `text-inverse`. `--color-accent-blue-text: #ffffff` token exists but is unused. | 6hdj9 |
| D4 | Default control height — 30 or 32? | Pen 32 across Button/TextInput/Textarea/Select. Token is 30. | Phase 1 |
| D5 | Control font size — 13 or 14? | Pen 13. Token `--font-input` resolves to 14 at default UI size. | Phase 1 |
| D6 | Section-header title size — 13 or 14? | Pen 13 (bold). React reuses `controlTextStyle` = 14. | Phase 1 |
| D7 | Top-nav model in the app | Pen documented Sessions/Specs/Settings/Forge tabs (since deleted). If we want a primary tab bar, re-author; otherwise accept "no top nav". | E63Gg |
| D8 | Sidebar search shape — pill or flush bar? | Pen now flush bar (cleanup 1). Real is flush bar. Keep. | 00g6Y |

## Phase 3B — Global token updates (one change, many wins)

After D4/D5/D6 are decided:

| # | Change | File | Effect |
|---|---|---|---|
| T1 | Bump `--control-height-md` 30 → 32 (if D4=32) | `src/styles/themes/base.css` | Fixes Button, TextInput, Textarea, Select heights |
| T2 | Retune `--font-input` / `--font-button` (if D5=13) | `src/styles/themes/base.css` | Fixes control text sizes across components |
| T3 | Introduce 13px section-title token `--font-section-title` (if D6=13) | `base.css` + `SectionHeader.tsx` | Fixes SectionHeader only |
| T4 | Add `--color-accent-violet-bg-subtle` (5%) and a `-bg-nested` tier (8%) | `islands-dark.css` + others | Unlocks nested consolidation hierarchy (sR597) |
| T5 | Add `accent-yellow` swatch row to `ColorReferenceSection` | `src/style-guide/sections/ColorReferenceSection.tsx` | Closes Color Palette audit item |
| T6 | Remove always-transparent `--icon-button-*-border` tokens | `islands-dark.css`, `IconButton.tsx` | Drops dead tokens; clears bDSQ0 audit item |

## Phase 3C — Missing shared primitives

Block downstream work. Build in this order.

| # | Task | File(s) | Depends on |
|---|---|---|---|
| P1 | Extract `src/components/ui/DropdownMenu.tsx` + `MenuItem` matching pen `PnJAA` (panel + item + separator + destructive variant) | new | — |
| P2 | Add a11y to DropdownMenu — `role="menu"`/`menuitem`, arrow-key roving focus, `focus-visible` ring | P1 | P1 |
| P3 | Retrofit `GitGraphPanel.tsx:814` context menu to use the new DropdownMenu | P1 | P1, P2 |
| P4 | Wire a session-card right-click menu using DropdownMenu — Copy Name / Copy Branch / Open in Editor / Delete Session (destructive) | `SessionCard.tsx`, `KanbanSessionRow.tsx`, `SessionRailCard.tsx` | P1, P2 |
| P5 | Extract `src/components/ui/Badge.tsx` with variants `info` / `success` / `warning` / `error` (tinted bg + border + optional leading dot) | new | — |
| P6 | Refactor `PipelineStatusBadge` to consume `Badge` internally | `PipelineStatusBadge.tsx` | P5 |
| P7 | Extract `src/components/ui/Chip.tsx` — neutral (bg-tertiary/border-subtle) and `accent` (solid) variants | new | — |
| P8 | Extract `src/components/ui/CountBadge.tsx` for numeric badges; migrate `Tab.tsx` attention/running badges | new + `Tab.tsx` | — |

## Phase 3D — Per-component fixes (visual drift)

Sort by impact × cost. Each row = one small PR-sized change.

### SessionCard (`p09Tn`) — sidebar/SessionCard.tsx

- [ ] Drop left border (use `border-y border-r`) so the accent bar owns the left edge
- [ ] Change `rounded-md` to `rounded-r-md`
- [ ] Remove `rounded-l-md` from the accent strip
- [ ] Render accent strip unconditionally (fall back to `--color-border-subtle` when no status)
- [ ] Change content left padding `pl-4` → `pl-3`
- [ ] Add `h-4` to status badge pill spans, `h-[15px]` to shortcut badge
- [ ] Revert background to solid `--color-bg-tertiary` (drop `/0.4` alpha) for default + running states

### CompactVersionRow (`RgQVf`) — sidebar/CompactVersionRow.tsx

- [ ] Use `colorScheme.DEFAULT` instead of `colorScheme.light` for v-index text
- [ ] Remove border on shortcut chip (`border-[var(--color-bg-subtle)]`)
- [ ] **Decide** whether running state should render spinner (current) or "Running" pill (pen) — biggest semantic delta
- [ ] Consolidate badge typography (12/600 everywhere vs pen's 10/500 — pick one, propagate)

### Button (`m04tr`) — ui/Button.tsx

- Driven by D2/D3/D4/D5 decisions.
- [ ] After D2: either switch danger/warning/success defaults to solid fill, or update pen to document tinted default
- [ ] After D3: swap `text-text-inverse` for `--color-accent-blue-text` on primary
- [ ] Add `active:` pressed state if pen keeps Active column, else drop from pen
- [ ] Add `font-medium` to match pen's weight 500 (or drop 500 in pen)

### Checkbox / Toggle / FormGroup — ui/

- [ ] Checkbox: `gap-2.5` → `gap-2`; `items-start + mt-0.5` → `items-center`
- [ ] Toggle md: shrink knob to `h-3.5 w-3.5` (14) with `p-[2px]` inset; wrapper gap `gap-3` → `gap-2`; translate-x review for on-state travel (18px target)
- [ ] Toggle sm: give own translate (currently reuses md's `translate-x-4`)
- [ ] FormGroup: outer gap `space-y-2` → `space-y-1.5`; help text `text-text-muted` → `text-text-tertiary`; Label `gap-1` → `gap-0.5`; add `font-medium` to Label
- [ ] Textarea: add `error` prop mirroring TextInput; OR have TextInput/Textarea read `aria-invalid` so FormGroup's error propagates

### Select / SectionHeader / Sidebar headers — ui/ + sidebar/

- [ ] Select: replace inline chevron SVG with lucide `ChevronDown`; `h-4 w-4` → `h-3.5 w-3.5`; chevron color token → text-tertiary
- [ ] SidebarSectionHeader: badge bg `bg-elevated` → `bg-tertiary`, badge text `text-muted` → `text-tertiary`, add inner grey dot before count, chevron `w-3 h-3` → `w-3.5 h-3.5`, letter-spacing to `tracking-[0.1em]`
- [ ] EpicGroupHeader: set explicit `h-10`; `px-2` → `px-3`; remove `py-1.5`; `rounded` → `rounded-md`; border → `border-subtle`; chevron color → text-muted; count color → text-tertiary; title size/weight → `typography.body` + `font-medium`
- [ ] FavoriteCard: caller width 160 → 180; `min-h-[72px]` → `min-h-[82px]`; `min-w-[140px]` → `min-w-[180px]`; default border 2px → 1px

### Agents Sidebar board (`jwCvs`) — sidebar/KanbanSessionRow.tsx + KanbanView.tsx

- [ ] Add stage accent bar / colored stripe per column
- [ ] Render status pill inside card with stage color tint
- [ ] Add agent color chip
- [ ] Add shortcut hint (⌘N)
- [ ] Add selected-card cluster wrapper + Action Strip matching pen `xRhQi`/`QNAzc`
- [ ] Add Board/List toggle as bordered pill (1px, radius 4, padding 2/8)

### SessionVersionGroup (`QNpSD`, `sR597`, `xzyG4`) — sidebar/SessionVersionGroup.tsx

- [ ] Apply D1 decision (green vs blue running badge)
- [ ] Row grouping: decide fused-rows (pen) vs stacked-with-gap (current); update one
- [ ] sR597 post-judge: add `isMergeCandidateWinner` styling (full opacity + top-rounded) vs faded siblings
- [ ] sR597 post-judge: hide Re-run Judge button once `latestJudge` exists (if pen is canonical)
- [ ] QNpSD action buttons: tint icons per action (Judge amber, Confirm green, Terminate red)

### Typography (`lANM9`) — src/style-guide/

- [ ] Add `src/style-guide/sections/TypographySection.tsx` rendering `theme.fontSize` + `typography` samples so the pen page has a real counterpart
- [ ] After D5/D6: align type-scale multipliers so Heading / Body LG / Body / Label match pen (or update pen to match React)

## Phase 3E — Pen follow-ups

After the code stabilises:

- [ ] Rename "Navigation" page to "Search" (it only holds SearchBox now) or re-fold into Form Controls
- [ ] Add `accent-yellow` swatch to Color Palette page
- [ ] Document active/focus/disabled states as additional frames where missing
- [ ] Consider adding a Typography section frame that mirrors the real implementation once D5/D6 are settled
- [ ] Bump marker to `cleanup 3`

## Suggested execution order

1. **Decisions first** — D1–D8 as a product/design thread. No code until resolved.
2. **Token pass** — T1–T6. Single commit per token; `just test` between.
3. **Primitives pass** — P1 → P2 → (P3, P4, P5–P8 in parallel). Ship with tests.
4. **SessionCard tranche** — highest-volume drift (Phase 1 + Phase 2).
5. **Board view tranche** — biggest Phase 2 gap.
6. **Remaining per-component polishing**.
7. **Typography section** — last, since it depends on type-scale decisions.
8. **Pen follow-ups** + cleanup 3.

## Out of scope

- Renaming themes / changing islands-dark token semantics beyond the specific deltas above.
- Cross-theme audit (Phase 1/2 were both islands-dark only).
- Spec / plan / sessionsdb schema work.
