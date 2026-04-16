# Style Guide — Agents Sidebar Board Composed View

**Date:** 2026-04-16

## Problem

The Agents Sidebar's board/kanban mode (`sidebarViewMode === 'board'`) is implemented in
`src/components/sidebar/KanbanView.tsx` and renders six stacked collapsible stage sections
(Idea, Clarified, Working on, Judge review, Ready to merge, Archive) inside the standard
sidebar column. It uses a stripped `KanbanSessionRow` button that does not reuse the
`SessionCard` anatomy the list view uses, and there is no authoritative visual target for
it in `design/style-guide.pen`. The result is that future code alignment work has nothing
to match against.

## Goal

Add a new composed view frame ("Agents Sidebar — Board") to `Composed Views` (`p0uzk`)
in `design/style-guide.pen` that shows the board mode built from the style guide's
existing molecules: `component/SidebarSectionHeader` (`XOuQW`) for each stage and
`component/SessionCard` (`p09Tn`) for each row. The new frame sits next to the existing
list-mode view (`00g6Y`) — the list view is not reworked.

## Scope

### In scope

- One new composed-view frame inside `p0uzk`, after the list-mode `Agents Sidebar View`.
- A new uppercase label ("AGENTS SIDEBAR — BOARD") using the same typography as the
  existing `AGENTS SIDEBAR` label (`YWPYC`).
- A sidebar panel (reused `SidebarPanel` anatomy, width 400 to match the list-mode
  showcase) containing:
  - A simplified header strip with the `AGENTS` title and a `Board` mode pill mirroring
    the production toggle button.
  - The six stage sections in production order: Idea → Clarified → Working on →
    Judge review → Ready to merge → Archive.
  - Each stage uses a `SidebarSectionHeader` ref with correct count and the chevron in
    the expanded orientation (except `Archive`, which is shown collapsed per
    production defaults).
  - `Judge review` groups two cards inside a `pl-2 border-l border-border-subtle`
    indent rail keyed by `consolidation_round_id`, with one ungrouped card below.
- Two SessionCard treatments demonstrated inside `Working on`:
  - An **unselected** row — a plain `SessionCard` ref with no selection treatment.
  - A **selected** row — a `SessionCard` ref with a selection border treatment and a
    simple action-button strip rendered directly below it, representing the
    `SessionActions` row that appears when `showExpandedDetails` is true.
- `Ready to merge` uses the existing `SessionCard ready border treatment` (`dbZiO`) so
  the green border variant is represented.

### Out of scope

- Changes to `KanbanView.tsx` or `KanbanSessionRow.tsx` — repo convention updates
  design pen files in a separate spec from the code that aligns to them.
- A true horizontal-column kanban layout. The production feature is stacked sections
  inside the sidebar column, and the design mirrors that.
- Drag-and-drop, epic filtering inside board view.

## Placement

- Parent: `Composed Views` frame (`p0uzk`), vertical flow, `gap=32`, `padding=48`.
- Order inside parent: after `Agents Sidebar View` (`00g6Y`). Children are appended so
  auto-layout handles positioning; no absolute coordinates are required.
- New label ("AGENTS SIDEBAR — BOARD") is inserted just before the new frame, mirroring
  how `AGENTS SIDEBAR` precedes the list view.

## Frame Structure

```
Agents Sidebar — Board View           (frame, width=fill_container, padding=24)
└── SidebarPanel                       (frame, width=400, padding=16, gap=12)
    ├── Board Header Strip             (frame, row, AGENTS title + Board pill + toggle handle)
    ├── Board Columns                  (frame, column, gap=10, full width)
    │   ├── Idea Section               (SidebarSectionHeader + 2 SessionCards)
    │   ├── Clarified Section          (SidebarSectionHeader + 1 SessionCard)
    │   ├── Working On Section         (SidebarSectionHeader + 2 SessionCards + Selected Row Cluster)
    │   ├── Judge Review Section       (SidebarSectionHeader + consolidation rail wrapping 2 cards + 1 ungrouped card)
    │   ├── Ready To Merge Section     (SidebarSectionHeader + 1 SessionCard using ready border)
    │   └── Archive Section            (SidebarSectionHeader only, chevron-right/collapsed state)
```

### Selected Row Cluster

A single vertical frame that groups:
1. A `SessionCard` ref whose `scAccentBar` fill uses `$accent-blue` (the default
   running accent) and whose wrapper border uses `$accent-blue` at higher opacity to
   signal selection.
2. A one-row action strip (frame, row, gap=6, padding=[6,12]) with 4–5 placeholder
   icon buttons (Play / Refresh / Convert / Cancel / Merge), rendered as circular
   icon tiles against `$bg-hover`. This strip is inside the selection wrapper, right
   below the card content — it represents `data-testid="session-card-actions"` in
   production.

The strip is shown only for the selected row to convey "action surface appears when
expanded". Other running rows in the mockup render without the strip.

### Consolidation Rail

A frame with `padding-left=8` and a 1-pixel left border in `$border-subtle`, children
flow vertically with `gap=6`. Two SessionCards sit inside it. A third `Judge review`
card sits outside (below) the rail to represent the ungrouped case.

### Archive Section

Rendered with `SidebarSectionHeader` only, chevron pointing right (collapsed) and a
representative count (e.g., `4`). The body is intentionally omitted to match the
production default.

## Acceptance Criteria

1. Opening `design/style-guide.pen` shows a new `Agents Sidebar — Board` frame beneath
   the existing `Agents Sidebar View` frame in the `Composed Views` frame.
2. The new frame contains the six stage sections in the documented order with the
   documented counts, each using `SidebarSectionHeader` refs (not bespoke text).
3. Judge review shows a visually distinct indent rail grouping two cards, with one
   ungrouped card below.
4. Working on shows a selected row cluster where the card has a selection border and
   an action-button strip is visible directly below the card body; a separate
   unselected row shows the same card without the strip.
5. Ready to merge uses `SessionCard ready border treatment` so the green border is
   present.
6. Archive header shows the collapsed chevron orientation and no body.
7. A screenshot export of the new frame renders without overlap or clipping and is
   legible at typical review zoom.
8. No changes to any React/TypeScript/Rust source files — only `design/style-guide.pen`
   and the design doc are modified.
