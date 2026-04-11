# Style Guide Composed Views Design

**Context**

`design/style-guide.pen` currently documents primitives and a few isolated molecules, but it does not show how the two densest Lucode surfaces assemble in practice. The live UI work happens in `src/components/modals/NewSessionModal.tsx`, `src/components/sidebar/Sidebar.tsx`, `src/components/sidebar/SessionCard.tsx`, `src/components/sidebar/SessionVersionGroup.tsx`, `src/components/sidebar/EpicGroupHeader.tsx`, and `src/components/shared/FavoriteCard.tsx`. The goal is to turn those implementation details into durable design references inside the style guide without inventing a separate visual language.

**Approaches**

1. **Compose the views directly from today’s primitives only**
   Reuse `FormGroup`, `TextInput`, `Badge`, `SessionCard`, `DropdownMenu`, and ad hoc frames for the rest.
   Trade-off: fastest path, but it leaves the style guide missing the new shared molecules the app now depends on, especially favorite cards and grouped sidebar headers.

2. **Add a small set of missing reusable molecules, then compose the two full views** (recommended)
   Add reusable `FavoriteCard`, `SidebarSectionHeader`, `EpicGroupHeader`, and `CompactVersionRow` components beside the existing primitives, then build the New Session Modal and Agents Sidebar examples from those pieces plus the existing components.
   Trade-off: slightly more setup, but the resulting guide is useful both as a component catalog and as a screen reference.

3. **Copy the existing `design/new-session-modal.pen` screen and sketch the sidebar beside it**
   Trade-off: can get visually close faster, but it weakens the style guide because the composed views would not be built from the guide’s own reusable building blocks.

**Decision**

Take approach 2. The style guide should stay self-contained: reusable pieces on the component rail, then composed views that demonstrate them in context. The new reusable molecules stay small and obvious, while the composed views document real product surfaces instead of standalone parts.

**Design Shape**

- Add four reusable molecules in the component column:
  - `component/FavoriteCard`
  - `component/SidebarSectionHeader`
  - `component/EpicGroupHeader`
  - `component/CompactVersionRow`
- Add one new top-level section frame, `Composed Views`, under the current `Cards & Overlays` section.
- Inside `Composed Views`, add two labeled examples:
  - `New Session Modal` showing only the primary creation flow:
    - name field and epic dropdown
    - horizontal favorite card row
    - prompt/editor area with `Start From`
    - footer with version selector and primary create button
  - `Agents Sidebar` in expanded mode showing:
    - section headers with counts
    - epic groups with accent bars and collapse chevrons
    - a version group with compact rows
    - all requested session states
    - an open context menu attached to a representative session card

**Sidebar Parity Pass**

The first sidebar mockup covered the session states and grouping, but it still underrepresented the surface that ships in `Sidebar.tsx`. The live sidebar also carries:

- the top utility bar with the hide-sidebar control and shortcut hint
- the orchestrator entry with model/reset icon buttons, running indicator, shortcut badge, and branch badge
- the filter/search rail plus the active search input row with result count and close action
- the ungrouped divider shown when sessions exist outside epic groups
- richer version-group chrome: a dedicated header row, action icons, and the consolidation candidate lane
- the epic header overflow menu in addition to the session card context menu

This pass keeps the existing molecules, but updates the composed `Agents Sidebar View` so the guide documents the current product surface instead of a simplified subset.

**Session Card Parity Pass**

The sidebar review exposed a second stale layer: the reusable `component/SessionCard` and the standalone session-card examples were still modeling the old name/branch/stats stub, including a `Reviewed` state that no longer exists in the product. The live `SessionCard.tsx` now centers around:

- top-row name plus inline stage/status text
- a shortcut badge on the right
- a task/description line
- chip-style dirty, ahead, and diff stats
- a lower metadata row with the agent badge and branch

The style guide should reflect that shared anatomy directly, then let the composed sidebar reuse it for spec, running, idle, blocked, and ready examples. Any exact `Reviewed` label in the asset should be treated as stale and removed.

**Testing and Verification**

- Add a narrow Vitest regression that parses `design/style-guide.pen` and asserts the new reusable molecules and composed view section exist.
- Use Pencil screenshots after the design edits to verify the modal and sidebar read correctly, have no clipped text, and match the existing Islands Dark spacing and color rules.
- Finish with the repo validation suite and a review pass before committing a single squashed change.
