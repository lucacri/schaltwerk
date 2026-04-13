# Session Version Sidebar Redesign

## Context

The sidebar version group components need to match the updated `style-guide.pen` nodes:

- `QNpSD`, `xzyG4`, `sR597` for version group header and consolidation states.
- `RgQVf` for the compact version row structure.
- `9lVX6` and `4CEpM` for the consolidation candidate lane and judge recommendation banner.

## Recommended Approach

Use the existing `SessionVersionGroup` and `CompactVersionRow` boundaries, and reshape their markup/styles to match the design nodes. This keeps the existing selection, shortcuts, actions, and consolidation callbacks intact while replacing the visual structure.

Alternatives considered:

- Replace the components with a new shared primitive: rejected because the existing components already hold the required behavior and test coverage.
- Add CSS modules for the redesign: rejected because this area already relies on inline theme-variable styles plus utility classes.
- Make only CSS tweaks: rejected because `CompactVersionRow` needs a structural change, not just visual tuning.

## Design

`SessionVersionGroup` keeps a clickable header, but renders it as a horizontal row: `VscChevronRight`, title, count badge, and a right-aligned dot/text status badge. The chevron rotates with a transition when expanded. Header actions use `react-icons/vsc` instead of inline SVG.

`CompactVersionRow` becomes a 52px row with a 4px agent accent bar, a 52px version index column, a body with an agent chip and stat chips, and a right stack for status plus shortcut. Selected rows use the blue accent border and a subtle blue background. Rows that are not consolidation candidates are dimmed to opacity `0.55` when a judge is running or a recommendation exists.

`SessionVersionGroup` renders a violet consolidation lane only when a judge recommendation exists. The lane includes the `CONSOLIDATION` label and a judge recommendation banner with text plus a `VscCheck` confirm button. Candidate membership is derived from the recommending judge's `consolidation_sources` when a recommendation exists, or the active judge's sources while judging is still in progress. The recommended winner is `consolidation_recommended_session_id`.

## Testing

Add tests first:

- `CompactVersionRow.test.tsx`: assert the accent bar, version index column, agent chip, stat chips, selected border/background, and dimmed opacity.
- `SessionVersionGroup.status.test.tsx`: assert the VSC-style chevron/button structure, violet recommendation lane/banner, confirm callback, and source candidate dimming props.
