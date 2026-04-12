# Stabilize Style Guide Primitives Design

## Goal

Lock one shared primitive contract for the sidebar and new-session modal so follow-up composition work can reuse those pieces without reopening their slot structure, status treatment, badge placement, shortcut presentation, or overlay behavior.

## Context

The repo now has two valid-but-not-identical sources of truth:

- the Pencil asset in [`design/style-guide.pen`](/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/stabilize-style-guide-primitives_v3/design/style-guide.pen), which already documents reusable session-oriented molecules and composed sidebar/modal references;
- the running React primitives in [`src/components/ui`](/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/stabilize-style-guide-primitives_v3/src/components/ui), [`src/components/shared`](/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/stabilize-style-guide-primitives_v3/src/components/shared), and [`src/components/sidebar`](/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/stabilize-style-guide-primitives_v3/src/components/sidebar), which already drive the real UI and existing tests.

The missing contract is in the standalone browser style guide. It still catalogs generic controls, but it does not clearly present the session-oriented shared primitives that downstream work depends on. That gap makes the `.pen` asset and the live UI feel adjacent rather than converged.

## Approaches

1. Treat the Pencil asset as the contract and leave the browser style guide mostly generic.
   Fast, but it leaves the running UI contract implicit and weakens testable parity.

2. Treat the current React primitives as the contract and only update tests.
   Safer than redesigning, but downstream design work still lacks a visible, shared reference in the style guide.

3. Add a dedicated primitive-contract section to the browser style guide, keep the existing React primitives as the implementation source of truth, and tighten tests around the anatomy and overlay behavior that the Pencil asset already describes.
   This gives one visible contract and lets the `.pen` guide and the app UI converge on the same anatomy without redesigning the composed surfaces.

## Decision

Take approach 3.

The stable contract should be expressed in three places that agree with each other:

- live reusable React primitives;
- the standalone browser style guide gallery built from those same React primitives;
- narrow regression tests guarding the anatomy and overlay treatment that later sidebar and modal work assumes.

## Contract

### Included primitives

The contract covers the shared pieces directly reused by the sidebar or new-session modal:

- `Button`, `Select`, `TextInput`, `Textarea`, `Checkbox`, `Toggle`, `FormGroup`, `SectionHeader`
- `FavoriteCard`
- `EpicGroupHeader`
- `SessionCard`
- `CompactVersionRow`
- anchored dropdown and popup menu treatments used by `Dropdown`, `Select`, `EpicSelect`, and the multi-agent allocation menu

### Structural expectations

- Session-oriented primitives keep the live app anatomy that downstream surfaces already depend on.
- `SessionCard` remains the full-width row primitive with:
  - accent strip
  - top row with display name and inline stage/status treatment
  - shortcut badge
  - task/description line
  - dirty/ahead/diff stat chips
  - lower metadata row
- `CompactVersionRow` remains the grouped-session row with:
  - compact title chip
  - diff stats
  - status treatment
  - shortcut presentation
  - separate selected-actions row
- `FavoriteCard`, `SectionHeader`, and `EpicGroupHeader` stay as small shared building blocks instead of being redefined inside each composed surface.

### Visual expectations

- All primitives keep theme-token colors and existing typography helpers.
- The browser style guide should read as Islands Dark because it renders the real components under the normal theme system.
- No primitive-specific color or typography hardcoding should be introduced outside the existing token system.

### Menu behavior

- Dropdowns and popup menus are anchored overlays rendered out of normal layout flow.
- The contract is the current portal-based behavior: fixed positioning against viewport geometry, overlay scrim, and escape/outside-click dismissal.
- Inline layout rows inside style-guide previews are descriptive wrappers only; they are not the menu primitive contract.

## Testing strategy

- Extend the standalone style guide test to assert a dedicated primitive-contract section exists and includes the session-oriented building blocks.
- Add or extend focused component tests where anatomy matters:
  - `FavoriteCard`
  - `EpicGroupHeader`
  - dropdown / popup overlay behavior
- Keep the existing `.pen` regression test as the design-asset parity backstop.

## Out of scope

- Full sidebar redesign
- Full new-session modal redesign
- New states or workflows beyond what is already required to stabilize the shared primitives
