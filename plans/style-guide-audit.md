# Style Guide Pen File Audit

Audit of `design/style-guide.pen` against the live React implementation in `src/`. This report documents mismatches per component; no fixes are applied here.

Legend:
- **Severity:** `critical` (wrong structure / missing state) · `visual` (wrong color/size/radius/spacing) · `cosmetic` (rounding, label wording)
- **Verdict:** `matches` · `minor drift` · `major drift`

Pen tokens reference (resolved values):
- Text: primary `#c4c6cc`, secondary `#a8abb4`, tertiary `#8f939b`, muted `#757980`, inverse `#0e0e12`
- Bg: primary `#181a1d`, secondary `#0e0e12`, tertiary `#272a2e`, hover `#2a2d31`, elevated `#2f3236`, active `#43464a`
- Border: default `#484b4f`, strong `#5a5e62`, subtle `#383b3f`, focus `#548af7`
- Accent: blue `#548af7`, green `#6aab73`, amber `#be8f38`, red `#f75464`, cyan `#2aacb8`, purple `#c77dbb`, violet `#b07cd8`, yellow `#bbb529`
- Fonts: sans `Inter`, mono `JetBrains Mono`

---

## Phase 1 — Reusable components

### component/ColorSwatch (`7d5p7`)

- Screenshot: `plans/style-guide-audit/screenshots/7d5p7.png`
- React file(s): `src/style-guide/sections/ColorReferenceSection.tsx:102-120, 148-159`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Container layout | vertical frame, width 120, gap 8, no padding | vertical card `rounded-xl border bg-bg-elevated p-4`, width fills grid column, inner `space-y-1` ~4px gap, swatch wrapped in `mt-4` | Add card padding (`p-4`), `rounded-xl`, `bg-bg-elevated` fill; let width fill grid cell | visual |
| Card background | transparent | `bg-bg-elevated` = `#2f3236` | Add elevated fill behind swatch card | visual |
| Color rectangle height | 56px | `h-14` = 56px | — | — |
| Color rectangle corner radius | 6px | `rounded-lg` = 8px | Change pen to 8px (or update React to 6px — prefer 8px) | cosmetic |
| Color rectangle border | `#383b3f` 1px | `border border-border-subtle` `#383b3f` 1px | — | — |
| Color rectangle fill | `#181a1d` (static) | dynamic `var(--cssVariable)` per swatch | Pen illustrates bg-primary only — note that real preview varies per token | cosmetic |
| Label text | Inter 11/500/`#c4c6cc` | `text-body font-medium text-text-primary` ~14/500/`#c4c6cc` | Bump pen label to 14px (token body) | visual |
| Hex text font-family | JetBrains Mono | `font-mono` (SFMono-Regular/Menlo/Consolas) | Accept mono stack or swap pen to generic mono | cosmetic |
| Hex text size/weight/color | 10px / normal / `#8f939b` | `text-caption` ~11px / 400 / `text-text-secondary` = `#a8abb4` | Update pen hex to 11px / `#a8abb4` | visual |
| Extra metadata row | absent | React renders the CSS variable name (`font-mono text-caption text-text-muted` `#757980`) between label and hex | Add third text line for CSS variable name in pen | visual |
| Hover/focus/active states | none | none (static preview card) | — | — |

**Verdict:** minor drift

**Notes:** Real "swatch" is a full card (elevated bg, padding, rounded-xl) with label + CSS var name + resolved hex + preview block. Pen models only label + hex + bare rectangle at 120px wide — missing card chrome and CSS-variable metadata row; font sizes also undershoot token-driven values.

### component/Button (`m04tr`)

- Screenshot: `plans/style-guide-audit/screenshots/m04tr.png`
- React file(s): `src/components/ui/Button.tsx:16-29,40-85`; tokens in `src/components/ui/styles.ts:16-38`, `src/styles/themes/base.css:10-69`, `src/styles/themes/islands-dark.css:18-62`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Height | 32px | 30px (`--control-height-md`) | Raise pen to 30 or bump `--control-height-md` to 32 | visual |
| Horizontal padding | 12px | `px-3` = 12px | — | — |
| Corner radius | 4px | `--radius-default` = 0.25rem (4px) | — | — |
| Background | `#272a2e` (`--color-bg-tertiary`) | `#2f3236` (`--color-bg-elevated`) via `bg-bg-elevated` | Switch pen to `--color-bg-elevated` or repoint default variant to `bg-bg-tertiary` | visual |
| Border color | `#383b3f` (`--color-border-subtle`) | `#484b4f` (`--control-border` → `--color-border-default`) | Pen says subtle, React resolves to default — reconcile (likely pen should use `--color-border-default`) | visual |
| Border thickness | 1px | 1px | — | — |
| Text color | `#c4c6cc` (`--color-text-primary`) | `#a8abb4` (`text-text-secondary`) | Pen brighter than real default; switch pen to secondary or raise React contrast | visual |
| Font family | Inter | system sans stack (no Inter in CSS) | Treat pen Inter as visual proxy; no code change | cosmetic |
| Font size | 13px | 14px (`--font-button` → `--ui-font-size`) | Bump pen to 14px | visual |
| Font weight | 500 | unset (inherits 400) | Add `font-medium` to Button or drop weight 500 in pen | visual |
| Gap (icon↔text) | 6px | `gap-2` = 8px on md (`gap-1.5` only on sm) | Set pen gap to 8 or scope pen to `sm` | visual |
| Hover state | absent | `hover:border-border-strong hover:bg-[var(--control-bg-hover)] hover:text-text-primary` | Add hover spec to pen | cosmetic (missing state) |
| Focus-visible | absent | `focus-visible:border-[var(--control-border-focus)]` | Add focus spec to pen | cosmetic (missing state) |
| Disabled / loading | absent | `disabled:cursor-not-allowed disabled:opacity-50` + loading spinner | Add disabled + loading specs to pen | cosmetic (missing state) |
| Variants | single neutral button | 7 variants (default / primary / danger / ghost / dashed / warning / success) + sm/md sizes + icons | Extend pen or scope explicitly to `default`+`md` | cosmetic |

**Verdict:** minor drift

**Notes:** Pen targets `bg-tertiary`/`border-subtle`/`text-primary` but real `default` variant resolves to `bg-elevated`/`border-default`/`text-secondary` in islands-dark; height/font-size/weight/gap all one step off `md` size.

### component/TextInput (`Hpak8`)

- Screenshot: `plans/style-guide-audit/screenshots/Hpak8.png`
- React file(s): `src/components/ui/TextInput.tsx:18-43`; tokens in `src/components/ui/styles.ts:4-38` and `src/styles/themes/base.css:20-69`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Height | 32px | 30px (`--control-height-md`) | Update pen to 30 or promote token to 32 (align with Button md) | visual |
| Horizontal padding | 10px | 10px (`0.625rem` via `--control-padding-x`) | — | — |
| Corner radius | 4px | 4px (`--radius-default`) | — | — |
| Gap (icon↔input) | 8px | `gap-2` = 8px | — | — |
| Background fill | `#181a1d` (`--control-bg`) | `var(--control-bg)` = `#181a1d` | — | — |
| Border color | `#484b4f` (`--color-border-default`) | `var(--control-border)` = `#484b4f` | — | — |
| Border thickness | 1px | 1px | — | — |
| Text color (value) | `#c4c6cc` | `text-text-primary` = `#c4c6cc` | — | — |
| Placeholder color | not specified | `text-text-muted` = `#757980` | Add explicit placeholder swatch to pen | cosmetic |
| Font family | Inter | system sans stack | Swap pen to system / SF Pro Text | cosmetic |
| Font size | 13px | 14px (`--font-input` → `--ui-font-size`) | Bump pen to 14px | visual |
| Font weight | normal | normal | — | — |
| Focus state | absent | `focus-within:border-[--control-border-focus]` (`#548af7`) | Add focused variant to pen | visual |
| Error state | absent | red border via `--control-border-error` + caption error text | Add error variant to pen | visual |
| Disabled state | absent | `cursor-not-allowed opacity-50` | Add disabled variant to pen | cosmetic |
| Hover state | absent | `hover:bg-[--control-bg-hover]` | Add hover variant to pen | cosmetic |
| Icon slots | not represented | `leftIcon`, `rightElement` props supported | Optionally add icon variant | cosmetic |

**Verdict:** minor drift

**Notes:** Container geometry and color tokens line up cleanly; drift is concentrated in text sizing (13 vs 14) and height (32 vs 30). Pen also omits focus/error/disabled/hover states that React ships.

### component/Textarea (`wdp4L`)

- Screenshot: `plans/style-guide-audit/screenshots/wdp4L.png`
- React file(s): `src/components/ui/Textarea.tsx:12-31`; tokens in `src/styles/themes/base.css:49-56` and `src/styles/themes/islands-dark.css:58-62`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Height | 80px (fixed) | dynamic, user-resizable (`resize: vertical`) | Phantom state — pen's fixed 80px is frame default. No fix. | cosmetic |
| Width | 240px | `w-full` (container-driven) | Phantom state — pen's 240px is frame sizing. No fix. | cosmetic |
| Padding Y | 8px | `--control-padding-y: 0.375rem` = 6px | Align — either bump token to `0.5rem` or update pen to 6px | visual |
| Padding X | 10px | `--control-padding-x: 0.625rem` = 10px | — | — |
| Corner radius | 4px | `--radius-default` = 4px | — | — |
| Background | `#181a1d` | `--control-bg` = `#181a1d` | — | — |
| Border | 1px `#484b4f` | 1px `--control-border` = `#484b4f` | — | — |
| Text color | `#c4c6cc` | `text-text-primary` | — | — |
| Font size | 13px | `--font-input` = 14px | Bump pen to 14px | visual |
| Font weight | normal | normal | — | — |
| Line height | 1.4 | `theme.lineHeight.body` = 1.35 | Align pen to 1.35 | cosmetic |
| Font family | Inter | system sans stack | Switch pen to system stack | cosmetic |
| Placeholder color | not specified | `placeholder:text-text-muted` | Add muted placeholder to pen | cosmetic |
| Focus state | absent | `focus:border-[--control-border-focus]` (blue) | Add focused variant | visual |
| Hover state | absent | `hover:bg-[--control-bg-hover]` | Add hover variant | cosmetic |
| Disabled state | absent | `cursor-not-allowed opacity-50` | Add disabled variant | visual |
| Error state | absent | `--control-border-error` token exists but not wired into `Textarea.tsx` | Add error in pen AND wire `error`/`invalid` prop in React | visual |
| Resize affordance | not shown | `resize: vertical` (CSS grip visible) | Add corner resize grip in pen | cosmetic |
| Monospace variant | absent | `monospace` prop swaps to `--font-code` + mono stack | Add mono variant frame | cosmetic |

**Verdict:** minor drift

**Notes:** Colors, radius, horizontal padding, structure all match. Drift in vertical padding, font size, line-height; pen lacks focus/hover/disabled/error/resize/monospace variants that React exposes.

### component/Checkbox (`lg17I`)

- Screenshot: `plans/style-guide-audit/screenshots/lg17I.png`
- React file(s): `src/components/ui/Checkbox.tsx:35`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Box size | 14×14 | `h-[14px] w-[14px]` | — | — |
| Box radius | 2 | `rounded-[2px]` | — | — |
| Box fill | `#181a1d` (`--control-bg`) | `var(--control-bg)` = `#181a1d` | — | — |
| Box border | `#484b4f` 1px (`--control-border`) | `var(--control-border)` 1px | — | — |
| Label font size | 13 (Inter proxy) | `--font-label` ≈ 13px (system sans) | — | — |
| Label font weight | normal | inherit normal | — | — |
| Label color | `#c4c6cc` | `text-text-primary` | — | — |
| Row gap | 8px | 10px (`gap-2.5`) | Change React to `gap-2` (8px) | cosmetic |
| Cross-axis alignment | center | `items-start` + `mt-0.5` on box | Switch to `items-center` and drop `mt-0.5` | cosmetic |

**Verdict:** minor drift

**Notes:** Box geometry, fill, border, label typography all match. Only drift is gap and alignment. Checked/focus/disabled/indeterminate exist in React.

### component/Toggle (`uFnTD`)

- Screenshot: `plans/style-guide-audit/screenshots/uFnTD.png`
- React file(s): `src/components/ui/Toggle.tsx:15-26` (sizes), `:42-57` (markup)

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Track width | 36 | `w-9` = 36 | — | — |
| Track height | 20 | `h-5` = 20 | — | — |
| Track radius | 10 (pill) | `rounded-full` | — | — |
| Track fill (off) | `#181a1d` | `--control-bg` | — | — |
| Track border | 1px `#484b4f` | 1px `--control-border` | — | — |
| Knob size | 14×14 | 16×16 (`w-4 h-4`) | Change `md.knob` to `h-3.5 w-3.5` | visual |
| Knob inset (off) | 3px | 2px (1px border + `p-[1px]`) | Increase padding to `p-[2px]` | visual |
| Knob fill | `#ffffff` | `bg-text-inverse` | — | — |
| Label color | `#c4c6cc` | `text-text-primary` | — | — |
| Label size | 13 | `--font-label` ≈ 13 | — | — |
| Label weight | normal | inherit normal | — | — |
| Track → label gap | 8 | 12 (`gap-3`) | Change wrapper to `gap-2` | visual |
| ON state | not in pen | `bg-accent-blue` + `translate-x-4` | Pen lacks ON variant — flag for addition | cosmetic |
| Disabled | n/a | `opacity-50 cursor-not-allowed` | — | — |
| Focus | n/a | `focus-visible:border-[--control-border-focus]` | — | — |

**Verdict:** minor drift

**Notes:** Track geometry, colors, border, label typography all match. Drift is knob (16 vs 14, 2 vs 3 inset) and label gap.

### component/Select (`TQ8ZL`)

- Screenshot: `plans/style-guide-audit/screenshots/TQ8ZL.png`
- React file(s): `src/components/ui/Select.tsx:203`, `src/components/ui/styles.ts:34`, `src/styles/themes/base.css:46`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Container height | 32 | 30 (`--control-height-md`) | Bump `--control-height-md` to 32 (affects all md controls) | visual |
| Padding-x | 10 | 10 (`0.625rem`) | — | — |
| Corner radius | 4 | 4 (`--radius-default`) | — | — |
| Fill (islands-dark) | `#181a1d` | `#181a1d` (`--control-bg`) | — | — |
| Border | `#484b4f` 1px | `--color-border-default` 1px | — | — |
| Text size | 13 | 14 (`--font-input`) | Align to 14 | visual |
| Text color | `#c4c6cc` | `text-text-primary` | — | — |
| Font family | Inter | system sans stack | Proxy | — |
| Chevron icon | lucide `chevron-down` | custom inline `<svg>` | Replace with lucide `ChevronDown` | cosmetic |
| Chevron size | 14 | 16 (`h-4 w-4`) | Change to `h-3.5 w-3.5` | visual |
| Chevron color | `#8f939b` (text-tertiary) | `text-text-muted` | Swap to `text-text-tertiary` or verify mapping | cosmetic |
| Hover | not in pen | `hover:bg-[--control-bg-hover]` | — | — |
| Focus | not in pen | `focus-visible:border-[--control-border-focus]` | — | — |
| Disabled | not in pen | `opacity-50 cursor-not-allowed` | — | — |
| Open state | not in pen | chevron rotates 180° | — | — |

**Verdict:** minor drift

**Notes:** Height off by 2 affects every md control. Chevron is handrolled SVG at 16 instead of lucide at 14. Fill matches only in islands-dark (base default differs).

### component/IconButton (`bDSQ0`)

- Screenshot: `plans/style-guide-audit/screenshots/bDSQ0.png`
- React file(s): `src/components/common/IconButton.tsx:120-145`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Vertical padding | 6 symmetric | `py-1` = 4 | Use `p-1.5` instead of `px-1.5 py-1` | visual |
| Frame size | 28×28 | ~30×26 (asymmetric padding + 1px transparent border) | Enforce `w-7 h-7` or symmetric padding + no border | visual |
| Border | none | `border` with transparent color token | Remove border utility; drop always-transparent `--icon-button-*-border` tokens | cosmetic |
| Icon wrapper text size | n/a | `text-[12px]` on button | Remove — icon carries its own size | cosmetic |
| Background (default) | `#272a2e` | `--icon-button-default-bg` = `#272a2e` | — | — |
| Hover bg (default) | implied `#43464a` | `--icon-button-default-hover-bg` = `#43464a` | — | — |
| Icon color | `#c4c6cc` | `--icon-button-default-text` | — | — |
| Icon size | 16 | `w-4 h-4` = 16 | — | — |
| Corner radius | 4 | `rounded` = 4 | — | — |
| Focus | not in pen | no `:focus-visible` ring | Add focus-visible ring (a11y) | visual |
| Active/selected | not in pen | `aria-pressed` plumbed but no visual | Add pressed styling | visual |
| Disabled | not in pen | `opacity-50 cursor-not-allowed` | — | — |
| Variants | default only | success / danger / warning implemented | Pen omits variants | cosmetic |

**Verdict:** minor drift

**Notes:** Colors/radius match islands-dark exactly. Drift is dimensional (asymmetric padding + transparent border blow up the 28×28 frame).

### component/FormGroup (`5R6mj`)

- Screenshot: `plans/style-guide-audit/screenshots/5R6mj.png`
- React file(s): `src/components/ui/FormGroup.tsx:32`, `src/components/ui/Label.tsx:11`, `src/components/ui/styles.ts:22`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Vertical gap (label→input→help) | 6 | `space-y-2` = 8 | Use `space-y-1.5` (6) or `gap-1.5` | visual |
| Label font-size | 12 | `--font-label` ≈ 13 | Tighten `--font-label` to 0.857 (12px) or accept as token drift | cosmetic |
| Label font-weight | 500 | unset (inherits 400) | Add `font-medium` to Label | visual |
| Label color | `#a8abb4` | `text-text-secondary` = `#a8abb4` | — | — |
| Help text color | `#8f939b` (text-tertiary) | `text-text-muted` = `#757980` | Change help class to `text-text-tertiary` | visual |
| Help font-size | 11 | `--font-caption` ≈ 11 | — | — |
| Help font-weight | normal | normal | — | — |
| Label-row internal gap | 2 | Label uses `gap-1` = 4 (for required marker) | Change Label to `gap-0.5` | cosmetic |
| Container width | 280 (pen frame) | 100% parent-driven | Intentional; FormGroup fluid | — |
| Error state | — | `error` prop + red `<p>` | React extension; OK | — |
| Required indicator | implied (2px gap) | Red `*` via `required` prop | React extension; OK | — |

**Verdict:** minor drift

**Notes:** Shared `FormGroup` exists and is structurally correct. Drift: help text uses `text-muted` instead of `text-tertiary` (wrong hex), outer gap 8 vs 6, label missing 500 weight, label-row gap 4 vs 2. Label size drift (13 vs 12) is a global token issue.

### component/SectionHeader (`lJRyY`)

- Screenshot: `plans/style-guide-audit/screenshots/lJRyY.png`
- React file(s): `src/components/ui/SectionHeader.tsx:11`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Title font-size | 13 | 14 (`--font-input` via `controlTextStyle`) | Use a 13px token (or new `--font-section-title`) | visual |
| Title font-weight | 600 | `font-semibold` (600) | — | — |
| Title color | `#c4c6cc` | `text-text-primary` | — | — |
| Description font-size | 11 | `--font-caption` ≈ 11 | — | — |
| Description color | `#757980` | `text-text-muted` = `#757980` | — | — |
| Stack gap (title→desc) | 4 | `mt-1` = 4 | — | — |
| Bottom padding | 12 | `pb-3` = 12 | — | — |
| Divider | 1px rect `#383b3f` | `border-b border-border-subtle` (1px full width) | Semantically equivalent | — |
| Font family | Inter | system sans stack | Proxy per CLAUDE.md | cosmetic |

**Verdict:** minor drift

**Notes:** Only real drift is title size (13 vs 14) because `controlTextStyle` uses `--font-input`. No icon or action-button slot exists.

### component/Tab (`tGeUQ`)

- Screenshot: `plans/style-guide-audit/screenshots/tGeUQ.png`
- React file(s): `src/components/Tab.tsx:60`, `src/components/UnifiedTab.tsx:78`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Height | 36 | `h-full` (inherits tab bar) | Verify bar = 36 | cosmetic |
| Padding-x | 12 / 12 | 12 / 8 (right trimmed for close button) | Asymmetric by design | cosmetic |
| Inactive text color | `#8f939b` (`--color-tab-inactive-text`) | `var(--color-tab-inactive-text)` = `#8f939b` | — | — |
| Font size | 13 | `theme.fontSize.terminal` = `var(--terminal-font-size)` (user-configurable) | Pen should reference dynamic token, not fixed 13 | visual |
| Font weight | normal | 400 when inactive | — | — |
| Font family | Inter | system sans stack | Align pen with system stack | cosmetic |
| Hover bg | not in pen | `var(--color-tab-inactive-hover-bg)` = `rgba(42,45,49,0.5)` | Add hover state to pen | visual |
| Hover text | not in pen | `var(--color-tab-inactive-hover-text)` = `#a8abb4` | Add hover state | visual |
| Border-right separator | not in pen | `1px solid var(--color-border-subtle)` | Add divider between tabs | visual |
| Close button | not in pen | 20×20 `×` btn, `--color-tab-close-*` tokens | Add close-button variant | visual |
| Badges (attention/running) | not in pen | `--color-tab-badge-*` red + `--color-tab-running-badge-*` blue pill, 16px | Add badge slot | visual |
| Min-width | not in pen | `minWidth: 100px` | Add to pen frame | cosmetic |

**Verdict:** minor drift

**Notes:** Real Tab is richer than pen (close button, badges, hover/focus). Font uses system-sans + dynamic terminal size, not Inter@13.

### component/TabActive (`YLJ7o`)

- Screenshot: `plans/style-guide-audit/screenshots/YLJ7o.png`
- React file(s): `src/components/UnifiedTab.tsx:78` (active branch via `isActive`)

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Height | 36 | `h-full` | Verify bar = 36 | cosmetic |
| Padding-x | 12 / 12 | 12 / 8 | Asymmetric for close button | cosmetic |
| Background | `#181a1dcc` (rgba 0.8) | `var(--color-tab-active-bg)` = rgba(24,26,29,0.8) | — | — |
| Active text color | `#c4c6cc` | `var(--color-tab-active-text)` = `#c4c6cc` | — | — |
| Font size | 13 | `var(--font-terminal)` (dynamic) | Map pen to `--font-terminal` not hard 13 | visual |
| Font weight | normal (400) | 500 when active | Update pen to 500 (medium) | visual |
| Font family | Inter | system sans stack | Align pen stack | cosmetic |
| Indicator bar width | 60 (fixed) | `left-0 right-0` (full tab width) | Update pen to full width | visual |
| Indicator bar height | 2 | `h-[2px]` | — | — |
| Indicator color | `#548af7` | `var(--color-tab-active-indicator)` | — | — |
| Indicator y | 34 | `bottom: 0` | Matches (36h − 2) | — |
| Indicator transition | not in pen | `opacity` + `scaleX` 150ms ease-out | Add motion note | cosmetic |
| Running indicator variant | not in pen | Swaps to `--color-tab-running-indicator` + glow when `isRunTab && isRunning` | Add running variant | visual |
| Close button | not in pen | Always visible when active | Add to pen | visual |
| Badges | not in pen | Same tokens as Tab | Add to pen | visual |

**Verdict:** minor drift

**Notes:** Background, text, indicator tokens match. Main errors: active weight should be 500 (not 400) and indicator bar should span full tab width (not fixed 60).

### component/SearchBox (`dW8n0`)

- Screenshot: `plans/style-guide-audit/screenshots/dW8n0.png`
- React file(s): `src/components/sidebar/Sidebar.tsx:1825-1890`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Container shape | Rounded pill (radius 4, 1px full stroke, width 280) | Full-width bar (`border-b` only, no radius, no side/top border) | Structural divergence — either adopt pill or update pen to document the bar | visual |
| Background fill | `#2f3236` (bg-elevated) | `--color-bg-secondary` (`#0e0e12`) | Use `--color-bg-elevated` or reconcile pen to secondary | visual |
| Border | `#383b3f` 1px full | `--color-border-subtle` `border-b` only | Apply full 1px border + `rounded` if matching pen | visual |
| Corner radius | 4 | 0 | Add `rounded-[4px]` | visual |
| Horizontal padding | 10 | `px-3` = 12 | `px-[10px]` | cosmetic |
| Height | 32 | `h-8` = 32 | — | — |
| Gap between children | 8 | `gap-2` = 8 | — | — |
| Search icon size | 14 | `w-3 h-3` = 12 | Use `w-3.5 h-3.5` | cosmetic |
| Search icon source | lucide `search` | inline SVG | Swap to `lucide-react` `Search` | cosmetic |
| Icon color | `#757980` | `--color-text-muted` | — | — |
| Placeholder font size | 13 | `text-xs` = 12 | `text-[13px]` | cosmetic |
| Placeholder color | `#757980` | `placeholder:text-[var(--color-text-muted)]` | — | — |
| Placeholder weight | normal | normal | — | — |
| Result-count slot | 11 / 500, optional | `text-xs` (12), no pill | If enabling slot, size 11 + medium | cosmetic |
| Close button glyph | Text `×` 12/600 | SVG X (muted, hover→primary) | Normalize to one representation | cosmetic |
| Focus state | not specified | `outline-none`, no visible ring | Add `focus-visible` ring for a11y | visual |

**Verdict:** major drift

**Notes:** Pen shows a self-contained rounded pill; real sidebar search is a borderless full-width bar beneath the filter row.

### component/Badge (`O1LOu`)

- Screenshot: `plans/style-guide-audit/screenshots/O1LOu.png`
- React file(s): `src/components/forge/PipelineStatusBadge.tsx:14`, `src/components/forge/pipelineStatusVisual.ts:14`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Padding | 2/10 | tier 1/2: 2/10 | — | — |
| Border radius | 9999 (pill) | 9999 | — | — |
| Background (blue) | `--color-accent-blue-bg` (12%) | tier 1 uses bg; tier 2/3 transparent | Depends on tier | visual |
| Border (blue) | 1px 50% | tier 1/2: 1px; tier 3: none | Matches tiers 1–2 | — |
| Text color | accent-blue | pillText → accent | — | — |
| Font size | 11 | `--font-caption` ≈ 11 | — | — |
| Font weight | 500 | tier 1: 600; tier 2/3: 500 | Set tier 1 to 500 or pick tier 2 as canonical Badge | visual |
| Inner gap | 6 | `gap-1` = 4 | Change to `gap-1.5` | visual |
| Leading dot | 6×6 always | tier 1 hides dot; tier 2/3 show | Show dot for tier 1 OR adopt tier 2 as canonical | visual |
| Variants | blue only | blue/red/amber/green/gray × 3 tiers | Pen under-specified — extend or scope explicitly to Info | visual |
| Shared primitive | implied | none under `src/components/ui/`; `PipelineStatusBadge` is forge-specific | Extract shared `Badge`/`Pill` primitive | critical |

**Verdict:** minor drift

**Notes:** No single tier reproduces the pen exactly. Closest is hybrid of tier 1 fill/border + tier 2 dot/weight.

### component/SessionCard (`p09Tn`)

- Screenshot: `plans/style-guide-audit/screenshots/p09Tn.png`
- React file(s): `src/components/sidebar/SessionCard.tsx:342-368`, `src/components/sidebar/sessionCardStyles.tsx:9-72`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Card border sides | top/right/bottom only | full 4-side `border` | Use `border-y border-r` so accent bar owns left edge | visual |
| Card corner radius | right-only `[0, 6, 6, 0]` | `rounded-md` all 4 | Use `rounded-r-md` | visual |
| Card background | solid `#272a2e` | `rgb(var(--color-bg-tertiary-rgb) / 0.4)` (running uses elevated/0.5) | Use solid token | cosmetic |
| Accent bar presence | always, 6px full height | only when `shouldShowStatusStrip` | Render unconditionally; fall back to `--color-border-subtle` | visual |
| Accent bar corners | flat | `rounded-l-md` on strip | Remove `rounded-l-md` | cosmetic |
| Content left padding | 12 | `pl-4` = 16 | Change to `pl-3` | visual |
| Status badge height | 16, padding 1/8, radius 4 | `rounded px-2 py-[1px]`, no height | Add `h-4` to pill spans | cosmetic |
| Shortcut badge height | 15, padding 1/6, radius 4 | `rounded px-1.5 py-[1px]`, no height | Add `h-[15px]` | cosmetic |
| Task text size | 10 | `--font-session-task` var | — | — |
| Stack gap | 8 | `mt-2` between rows = 8 | — | — |
| Extra content | `enabled: false` action row | `<SessionActions>`, follow-up pulse, consolidation/PR/issue badges, auto-fix toggle | Expected divergence | — |

**Verdict:** minor drift

**Notes:** Chip/padding/typography tokens align. Structural drift is at outer shell — full border + rounded all corners + translucent bg in React vs. 3-side border + right-rounded + solid bg + always-on accent bar in pen.

### component/DropdownMenu (`PnJAA`)

- Screenshot: `plans/style-guide-audit/screenshots/PnJAA.png`
- React file(s): `src/components/git-graph/GitGraphPanel.tsx:814` — closest analog; no reusable DropdownMenu primitive exists.

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Reusable primitive | Shared `DropdownMenu` | None — ad-hoc menus inline (`GitGraphPanel`, plus unrelated Menu button components) | Extract `src/components/ui/DropdownMenu.tsx` + `MenuItem` | critical |
| Session-card menu | Copy Name / Copy Branch / Open in Editor / Delete Session | Not implemented on session cards | Add context menu to session cards | critical |
| Panel width | 200 fixed | `minWidth: 160` content-driven | Set width: 200 | visual |
| Panel padding-y | 4 | `py-0.5` = 2 | Change to `py-1` | visual |
| Corner radius | 6 | `rounded-md` = 6 | — | — |
| Fill | `--color-bg-elevated` | `--color-bg-elevated` | — | — |
| Border | 1px `--color-border-subtle` | 1px `--color-border-subtle` | — | — |
| Shadow | 0 4 16 rgba(0,0,0,0.375) | `shadow-lg` (Tailwind default) | Use explicit shadow matching token | cosmetic |
| Item height | 32 | `py-1` = ~22-24 | Set `h-8` | visual |
| Item padding-x | 12 | `px-3` | — | — |
| Item icon+label gap | 8 | no icon rendered | Add icon, `gap-2` | visual |
| Icon size / color | 14 / text-tertiary | no icons | Add 14px icons in text-tertiary | visual |
| Label size/weight | 13 / normal | `text-xs` = 12 | Use 13 | cosmetic |
| Label color | text-primary | default | Set `text-text-primary` | cosmetic |
| Hover bg | `--color-bg-hover` | custom `--hover-bg` var based on bg-secondary | Use `--color-bg-hover` | visual |
| Separator | 1px border-subtle | not rendered | Render separator between groups | visual |
| Destructive item | red icon + red label | not present | Add Delete Session with `--color-accent-red` | critical |
| Focus highlight | hover only | no `:focus-visible` | Add focus ring | visual |
| Keyboard nav | implied roving focus | only Escape-to-close | Add `role="menu"`/`menuitem` + arrow keys | critical |

**Verdict:** major drift

**Notes:** Pen documents a dedicated reusable dropdown that doesn't exist in the codebase. Recommend extracting `src/components/ui/DropdownMenu.tsx`.

### component/FavoriteCard (`8yVBg`)

- Screenshot: `plans/style-guide-audit/screenshots/8yVBg.png`
- React file(s): `src/components/shared/FavoriteCard.tsx:29`; consumer `src/components/modals/NewSessionModal.tsx:506`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Card width | 180 | 160 (forced at call site wrapper) | Bump NewSessionModal wrapper to 180 or drop the wrapper | visual |
| Card min-height | 82 | `min-h-[72px]` | Raise to 82 | visual |
| Card min-width | 180 | `min-w-[140px]` | Raise to 180 | visual |
| Border width (default) | 1px `--color-border-default` | `2px solid --color-border-default` | Use 1px default; keep selected at 2px accent-blue | visual |
| Border color (selected) | n/a (pen shows default only) | 2px `--color-accent-blue` | Pen missing selected state — flag | cosmetic |
| Accent strip width | 6 | 6 | — | — |
| Body padding | 12 | `p-3` = 12 | — | — |
| Body gap | 8 | `gap-2` = 8 | — | — |
| Title font-size | 13 | `--font-body` = 14 | Scales with UI font — acceptable or introduce 13 token | cosmetic |
| Title weight / color | 600 / primary | 600 / text-primary | — | — |
| Shortcut chip bg | bg-elevated | bg-elevated | — | — |
| Shortcut chip border | border-subtle 1px | border-subtle 1px | — | — |
| Shortcut chip radius | 4 | `rounded` = 4 | — | — |
| Shortcut chip padding | 2/6 | `px-1.5 py-0.5` = 6/2 | — | — |
| Shortcut chip font | sans (Inter in pen) | `theme.fontFamily.mono` (SFMono/Menlo) | Decide: if `<kbd>` style, mono is appropriate | cosmetic |
| Summary font-size | 11 | `--font-caption` ≈ 11 | — | — |
| Summary color | `#a8abb4` secondary | `--color-text-secondary` | — | — |
| Modified pill bg | `--color-accent-amber-bg` | `--color-accent-amber-bg` | — | — |
| Modified pill border | `--color-accent-amber-border` 1px | `--color-accent-amber-border` 1px | — | — |
| Modified pill radius | 9999 | `rounded-full` | — | — |
| Modified pill padding | 2/8 | `px-2 py-0.5` = 8/2 | — | — |
| Hover state | not in pen | none implemented | Consider `bg-hover` treatment (card is a button) | cosmetic |

**Verdict:** minor drift

**Notes:** Tokens clean. Real drifts are geometric — caller-forced 160px width vs pen 180, min-h 72 vs 82, default border 2px vs 1px.

### component/SidebarSectionHeader (`XOuQW`)

- Screenshot: `plans/style-guide-audit/screenshots/XOuQW.png`
- React file(s): `src/components/sidebar/SidebarSectionHeader.tsx:13`, used in `src/components/sidebar/Sidebar.tsx:2060`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Badge background | `--color-bg-tertiary` (#272a2e) | `--color-bg-elevated` (#2f3236) | Use `--color-bg-tertiary` | visual |
| Badge text color | `--color-text-tertiary` (#8f939b) | `--color-text-muted` (#757980) | Use `--color-text-tertiary` | visual |
| Badge content | dot (tertiary) + number (tertiary) | number only | Add neutral grey dot before count | visual |
| Chevron size | 14 | `w-3 h-3` = 12 | Use `w-3.5 h-3.5` | cosmetic |
| Chevron icon | lucide `chevron-down` | custom inline SVG | Swap to lucide `ChevronDown` | cosmetic |
| Title letter-spacing | 1.2px | `tracking-wider` (0.05em) | Use `tracking-[0.1em]` or inline 1.2px | cosmetic |
| Header height | 28 fixed | `py-1.5` + content (~28 implicit) | Add explicit `h-7` | cosmetic |
| Collapsed chevron | chevron-right (-90°) | `-rotate-90` on chevron-down | Matches | — |
| Hover state | not in pen | `hover:bg-bg-hover/30` | Keep — reasonable affordance | — |
| Title color | text-secondary | `var(--color-text-secondary)` | — | — |
| Divider | 1px border-subtle, fills | `flex-1 h-px bg-border-subtle` | — | — |
| Gap | 8 | `gap-2` | — | — |

**Verdict:** minor drift

**Notes:** Functionally correct (uppercase title, neutral badge, flexing divider, collapsible chevron). Drift: badge tokens one shade too light, missing inner dot, slightly undersized chevron, weaker letter-spacing.

### component/EpicGroupHeader (`MbdkY`)

- Screenshot: `plans/style-guide-audit/screenshots/MbdkY.png`
- React file(s): `src/components/sidebar/EpicGroupHeader.tsx:32-116`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Container height | 40 fixed | intrinsic (py-1.5 = 24px content) | Set `h-10` | visual |
| Corner radius | 6 | `rounded` = 4 | Use `rounded-md` | cosmetic |
| Border color | `--color-border-subtle` | `--color-border-default` | Switch to border-subtle | cosmetic |
| Left accent bar | 3px rect child (full height) | simulated via `border-left: 3px` | Acceptable; consider explicit bar element | cosmetic |
| Body padding-x | 12 | `px-2` = 8 | Use `px-3` | visual |
| Body padding-y | 0 | `py-1.5` = 6 | Remove py; set container height 40 | visual |
| Left group gap | 8 | `gap-2` = 8 | — | — |
| Chevron size | 14 | `w-3 h-3` = 12 | Use `w-3.5 h-3.5` | cosmetic |
| Chevron color | text-muted | inherits `currentColor` (text-primary) | Set `--color-text-muted` | visual |
| Collapsed/expanded direction | chevron-right collapsed; down expanded | collapsed=0°, expanded=90° | Matches | — |
| Dot size | 8 | `w-2 h-2` = 8 | — | — |
| Dot color | accent-green (epic color) | `scheme.DEFAULT` | — | — |
| Title size/weight/color | 13 / 500 / text-primary | inherits body (~14), weight 400, primary | Apply `typography.body` + `font-medium` | visual |
| Right group gap | 10 | `gap-2` = 8 | Use `gap-2.5` | cosmetic |
| Count size/weight/color | 11 / normal / text-tertiary | `typography.caption` (~11) / normal / `text-muted` | Switch color to `text-tertiary` | visual |
| Overflow glyph | `⋯` text 16/600 muted | 3-dot SVG w-4 h-4 muted | Acceptable equivalent | cosmetic |
| Hover/focus | not in pen | `hover:opacity-80` on menu button only | Add row hover + focus-visible ring (a11y) | cosmetic |

**Verdict:** minor drift

**Notes:** Main deltas are missing fixed 40 height, body padding 12 vs `px-2`, chevron inheriting primary instead of muted, count using `text-muted` instead of `text-tertiary`, border `default` instead of `subtle`.

### component/CompactVersionRow (`RgQVf`)

- Screenshot: `plans/style-guide-audit/screenshots/RgQVf.png`
- React file(s): `src/components/sidebar/CompactVersionRow.tsx:349`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Row border | 3-sided (no top), radius 0, `border-subtle` | Full 4-side `border` + `rounded-md`, uses `border-default` (state-dependent) | Pen simplification; rows sit in a list — decide whether to round/border-all or match pen | cosmetic |
| Row bg | solid `#272a2e` | `rgb(var(--color-bg-tertiary-rgb) / 0.4)` (layered alpha, state-driven) | Pen captures running snapshot only | cosmetic |
| Left accent bar | fixed blue 4px | `colorScheme.DEFAULT` per agent + pulse | Pen snapshot; real impl is richer | cosmetic |
| v-index label size | 16 | `sessionText.title` = 14 | Bump pen to 14 or real to 16 (pen likely wrong) | visual |
| v-index color | solid accent | `colorScheme.light` (lighter tint) | Change React to `colorScheme.DEFAULT` to match pen | visual |
| Agent chip label size/weight | 10 / 500 | `sessionText.badge` = 12 / 600 | Pen wants tighter; app convention is 12/600 | visual |
| Agent chip padding | 2/6 | `px-1.5 py-[2px]` = 6/2 | — | — |
| Agent chip radius | 4 | `rounded` = 4 | — | — |
| Agent chip colors (running) | accent-blue bg/border/text | accent-blue bg/border, text uses `-light` | Text `-light` vs solid accent in pen — minor drift | cosmetic |
| Dirty chip color | `#ef9b41` (pen error — not a theme token) | `--color-accent-amber-*` (`#be8f38`) | React correct; pen should be fixed | cosmetic (pen-side) |
| Ahead / Diff chips | bg-hover + border-subtle, 16 tall, 4 radius, 2/6 | `bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)] h-4 rounded px-1.5 py-[2px]` | — | — |
| Diff chip font | Inter 10/500 (per pen) | Mono 12/600 | Pen missed mono tag; diff benefits from mono | cosmetic |
| Stats row gap | 6 | `gap-1.5` = 6 | — | — |
| Body padding / gap | 7/10 / gap 5 | `px-2.5 py-[7px]` + `gap-[5px]` | — | — |
| Right column padding | 7/10/7/0 | `py-[7px] pr-2.5` | — | — |
| Right column width | intrinsic | hard-coded `width: 62px` | Flag — forces alignment; fine unless truncates | cosmetic |
| Status chip (Running) | pill with accent tint | Real `running` renders `<ProgressIndicator size="sm" />` spinner (not pill) | Biggest semantic delta — decide which is canonical | visual |
| Status chip (other states) | — | text chips with correct accent tokens | Matches pen | — |
| Shortcut chip border | none | adds `border-[var(--color-bg-subtle)]` | Remove border OR update pen | cosmetic |
| Shortcut chip width | 26 fixed | intrinsic | Leave code; fix pen | cosmetic |
| Shortcut text | Mono 10/500 muted | Mono 12/600 muted | Size/weight mismatch | visual |
| Body extras | — | consolidation-source dots, issue/PR badges, SessionActions dropdown | Additive states — pen incomplete | — |

**Verdict:** minor drift

**Notes:** Two drift themes — (1) badge typography is 12/600 across the app vs pen's 10/500; (2) running state renders a spinner instead of a "Running" pill. Pen's `#ef9b41` dirty chip is a pen-side bug; React already uses `--color-accent-amber-*`.

### SessionCard ready border treatment (`dbZiO`)

- Screenshot: `plans/style-guide-audit/screenshots/dbZiO.png`
- React file(s): `src/components/sidebar/SessionCard.tsx:136-139` (ready→green custom props), `:356-358` (status strip color), `:448-456` (ready status pill), `src/components/sidebar/sessionCardStyles.tsx:121-170`

Pen shape: wraps `p09Tn` with `stroke: #6aab73 1px` + overrides: `vcnT8` accent bar → `#6aab73`; status badge fill/stroke → green tints (`#6aab731f` / `#6aab7380`); status text "Ready" → `#6aab73`; agent "codex" tinted `#c45d52`; dirty chip fill `#c45d521f` + stroke `#c45d5280`; stats: 0 dirty / 0 ahead / +23 / −8 / 2 files / ⌘4.

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Card border | green 1px full | `--session-card-border` = `--color-accent-green-border` (`SessionCard.tsx:137`) | Matches pen intent via CSS var | — |
| Card bg tint | solid (no green wash) | `rgb(var(--color-accent-green-rgb) / 0.08)` (`:138`) | Pen shows no wash; real adds 8% green. Add to pen or remove | cosmetic |
| Accent bar color | `#6aab73` | `var(--color-accent-green)` strip branch `:357-358` | — | — |
| Status badge (Ready) | green 12% bg + 50% border + solid green text | bg `--color-accent-green-bg`, border `--color-accent-green-border`, text `--color-accent-green-light` (`:453-455`) | Text uses `-light` tint vs pen solid | cosmetic |
| Agent color (codex) | `#c45d52` (not a theme token) | `colorScheme` per-agent from `AGENT_COLORS` | Pen illustrative; align to theme tokens | cosmetic |
| Dirty chip colors | `#c45d521f` / `#c45d5280` (pen-invented) | `--color-accent-amber-*` | Use amber in pen | cosmetic |
| Ahead chip (0) | elevated + subtle + text-tertiary | falls back to elevated/subtle when 0 | — | — |
| Shortcut `⌘4` | muted text | `resolveSwitchSessionShortcut(...)` | — | — |

**Verdict:** minor drift

**Notes:** Structural treatment (green border + accent bar + status pill) is in place via `SessionCard.tsx:136-139,356-358`. Real impl adds a subtle 8% green bg wash the pen doesn't show. Pen's `#c45d52*` palette isn't a theme token.

### SessionCard running border treatment (`ohS7S`)

- Screenshot: `plans/style-guide-audit/screenshots/ohS7S.png`
- React file(s): `src/components/sidebar/SessionCard.tsx:141-144` (running → blue ring + bg tint), `:356-360` (status strip color), `:479-483` (running status pill)

Pen shape: re-exports `p09Tn` unmodified (SessionCard base already uses blue accent).

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Border / ring | subtle 1px 3-side (inherited from p09Tn) | `ring-2 ring-[var(--color-accent-blue-border)]` (`:144`) — 2px outer ring | Pen lacks the 2px blue ring; add ring to pen or drop in React | visual |
| Card bg tint | solid `#272a2e` | `--color-accent-blue-bg` (12% blue wash) at `:142-143` | Pen has no blue wash — add to pen or remove | cosmetic |
| Accent bar color | `#548af7` | `var(--color-accent-blue)` strip branch `:359-360` | — | — |
| Status badge (Running) | blue 12% bg + 50% border + solid blue text | bg/border + text `--color-accent-blue-light` (`:481-483`) | Text uses `-light` tint vs pen solid | cosmetic |
| Follow-up pulse dot | not in pen | rendered when `hasFollowUpMessage && !isReadyToMerge` (`:404-421`), blue pulse | Pen missing | cosmetic |

**Verdict:** minor drift

**Notes:** Running adds a 2px blue ring + 12% blue bg wash + optional follow-up pulse — none in the pen. Pen treats running as default p09Tn and under-specifies the live treatment.

---

## Phase 1 — Summary

### Verdict tally

- `matches`: 0
- `minor drift`: 20
- `major drift`: 2 (`component/SearchBox`, `component/DropdownMenu`)

### Severity tally (across 22 components)

| Severity | Count |
|---|---|
| critical | 5 |
| visual | 88 |
| cosmetic | 80 |
| **total diff rows** | **173** |

### Critical items (must reconcile before shipping style guide as canonical)

1. **Shared Badge primitive is missing** (`component/Badge`, `O1LOu`). `PipelineStatusBadge` is forge-specific and no generic `Badge`/`Pill` lives in `src/components/ui/`. Extract one if Badge is meant to be a design-system primitive.
2. **Shared DropdownMenu primitive is missing** (`component/DropdownMenu`, `PnJAA`). Only ad-hoc menus exist (`GitGraphPanel.tsx:814` is the closest analog). Extract `src/components/ui/DropdownMenu.tsx` + `MenuItem`.
3. **Session-card context menu is not implemented** (`PnJAA`). Pen documents Copy Name / Copy Branch / Open in Editor / Delete Session on session cards; no such menu exists on `SessionCard`, `KanbanSessionRow`, or `SessionRailCard`.
4. **DropdownMenu destructive variant missing** (`PnJAA`). Pen expects a red "Delete Session" row (`--color-accent-red`); current menus have no destructive styling.
5. **DropdownMenu has no keyboard navigation / ARIA roles** (`PnJAA`). Only Escape-to-close is wired; arrow-key navigation and `role="menu"`/`menuitem` are missing — blocks a11y and style-guide parity.

### Major drift verdicts

- `component/SearchBox` (`dW8n0`) — pen models a rounded pill, real sidebar search is a borderless full-width bar; reconcile before accepting either as canonical.
- `component/DropdownMenu` (`PnJAA`) — see critical list above.

### Cross-cutting visual drift themes (affect many components)

- **`--control-height-md` is 30px but pen specifies 32px** (Button, TextInput, Select, others). One line to change; fixes 3+ components at once.
- **`--font-input` is 14px but pen specifies 13px** for controls (Button, TextInput, Textarea, Select). Global drift — introduce 13px control-text token or accept as token-level design choice.
- **Control fonts resolve to the system sans stack** (`-apple-system, BlinkMacSystemFont, Segoe UI, …`), pen uses `Inter`. Visual proxy only per `CLAUDE.md`; do not treat as a defect unless the project adopts Inter explicitly.
- **Missing interactive states (hover/focus-visible/disabled/error)** show up across nearly every form control. Pen documents default only; either extend pen with state frames or accept that state rendering lives in code.
- **Session-status-related tinting** (8% green bg for ready, 12% blue bg + 2px ring for running) is present in code but not in the pen's treatment frames.

### Prioritized fix order

1. **Critical — code changes (a11y + missing primitives).**
   - Add keyboard nav + ARIA roles to existing menu components, then extract a reusable `DropdownMenu` primitive. (C1–C5)
   - Add the session-card context menu (with destructive "Delete Session"). (C3/C4)
   - Extract a shared `Badge`/`Pill` primitive if Badge is intended to be design-system-level. (C1)
2. **Global token fixes that resolve many components at once.**
   - Reconcile `--control-height-md` with pen (30 vs 32) and `--font-input` with pen (14 vs 13). Touching two tokens in `base.css` cleans up Button, TextInput, Textarea, Select in one pass.
   - Normalize `--font-label` to 12 if the pen intent sticks (affects FormGroup).
3. **Per-component visual drift — prioritize highest severity-count components.**
   - SessionCard (`p09Tn`) — border sides, corner radius, accent-bar presence, content padding.
   - CompactVersionRow (`RgQVf`) — v-index size, running status rendering (spinner vs pill), badge typography.
   - DropdownMenu (`PnJAA`) — after primitive is extracted, hit item height/icon/hover tokens.
   - EpicGroupHeader (`MbdkY`) — fixed height, body padding, chevron color, count color, border-subtle.
   - SidebarSectionHeader (`XOuQW`) — badge bg/text tokens, inner dot, letter-spacing.
4. **Pen corrections (non-code).**
   - Fix pen's `#ef9b41*` (dirty chip) and `#c45d52*` (codex agent + dirty treatment) to standard theme tokens (`--color-accent-amber-*`, agent color from `AGENT_COLORS`).
   - Add missing state frames (ON toggle, checkbox checked, focused inputs, hover tabs) so the pen documents the full component lifecycle.
   - Resolve SearchBox pill-vs-bar discrepancy by picking canonical form and updating the other side.
5. **Cosmetic cleanup.**
   - Chevron sizes (Select, Sidebar headers, Epic header) all 1–2px undersized.
   - Shortcut badge heights and borders on SessionCard / CompactVersionRow.
   - Remove `--icon-button-*-border` tokens that are always transparent.

### Out-of-scope / Phase 2 preview

Phase 2 audits the 11 top-level composed frames (documentation pages + real app views); see below.

---

## Phase 2 — Composed views

### view / Color Palette (`T2zMu`)

- Screenshot: `plans/style-guide-audit/screenshots/T2zMu.png`
- React file(s): `src/style-guide/sections/ColorReferenceSection.tsx:13`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Page title | "Islands Dark — Component Library" | "Color And Border Reference" | Pen vs section title mismatch | cosmetic |
| Section order | Surfaces → Text → Accents → Borders → Status | Background Scale → Text Scale → Border Scale → Status → Accents → Control Variables | Reorder or accept | cosmetic |
| Surfaces list | 6 swatches (first labeled "canvas") | 6 (bg-primary/secondary/tertiary/elevated/hover/active) | Naming only | cosmetic |
| Text tokens | 4 (primary/secondary/tertiary/muted) | 5 (adds `text-inverse`) | React-only extra | cosmetic |
| Accent tokens | 7: blue, green, red, amber, cyan, violet, yellow | 6 (no yellow) | Add `accent-yellow` to SWATCH_GROUPS | visual |
| Border tokens | subtle/default/strong/focus | default/subtle/strong/focus | Order only | cosmetic |
| Status tokens | 4 | 4 | — | — |
| Extra group in React | none | "Control Variables" | React-only; acceptable | cosmetic |
| Per-swatch card chrome | simple label+swatch | elevated card with name, CSS var, hex, kind-specific preview | React richer — no functional gap | cosmetic |
| Canvas bg semantics | `#0e0e12` called "canvas" | `--color-bg-secondary = #0e0e12` but `--color-bg-primary = #181a1d` | Token naming inverts islands-dark comment — worth clarifying | visual |

**Verdict:** minor drift

**Notes:** Only real gap is missing `accent-yellow` swatch. Token-name vs. layering-comment inversion in `islands-dark.css:11-17` explains the rest of the drift.

### view / Typography (`lANM9`)

- Screenshot: `plans/style-guide-audit/screenshots/lANM9.png`
- React file(s): `src/common/typography.ts:36`, `src/common/theme.ts:399-413`, `src/styles/themes/base.css:7-26,68-74`, `src/style-guide/StyleGuide.tsx:81-86`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Typography section in style guide | rendered doc page | **not rendered** — no TypographySection.tsx | Add `TypographySection` that reads `typography`/`theme.fontSize` | visual |
| Display font-size | 32 | `14 × 2.286` = 32 | — | — |
| Heading XL | 24 | `14 × 1.714` = 24 | — | — |
| Heading LG | 20 | `14 × 1.429` = 20 | — | — |
| Heading | 16 | `14 × 1.286` = 18 | Pen or React off — align | visual |
| Body LG | 14 | `14 × 1.143` = 16 | Align | visual |
| Body | 13 | 14 | Pen should be 14 | visual |
| Caption | 11 | `14 × 0.786` = 11 | — | — |
| Label | 11 | `14 × 0.929` = 13 | Tighten `--font-label` or bump pen to 13 | visual |
| Code / Terminal | 13 | 13 | — | — |
| text.primary hex | `#c4c6cc` | islands-dark `#c4c6cc`; dark.css `#f1f5f9` | Pen matches islands-dark only | visual |
| text.secondary / tertiary / muted | `#a8abb4` / `#8f939b` / `#757980` | islands-dark matches | — (under islands-dark) | — |
| Terminal sample color | `#6aab73` | no terminal-specific token | Use `accent.green` | cosmetic |
| Sans stack | "Inter / System" | `-apple-system, BlinkMacSystemFont, Segoe UI, …` (no Inter) | Update label to "System" | cosmetic |

**Verdict:** major drift

**Notes:** Two problems: (1) no TypographySection renders in StyleGuide, so there's no in-app comparison. (2) The ladder steps 32/24/20/**16/14/13**/11/**11** diverge from real 32/24/20/**18/16/14**/11/**13**.

### view / Buttons (`6hdj9`)

- Screenshot: `plans/style-guide-audit/screenshots/6hdj9.png`
- React file(s): `src/components/ui/Button.tsx:16-24`; tokens `src/styles/themes/islands-dark.css:14-91`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Default bg | `#272a2e` (bg-tertiary) | `#2f3236` (bg-elevated) | Pen or React wrong — reconcile | visual |
| Default text | `#c4c6cc` (primary) | `#a8abb4` (secondary); promotes to primary on hover | Pen shows hover state as default | visual |
| Default hover bg | `#2a2d31` (bg-hover) | `--control-bg-hover` = `#2a2d31` | — | — |
| Default active bg | `#43464a` | not implemented | Drop active from pen OR add `active:` in code | cosmetic |
| Primary text | white `#ffffff` | `text-text-inverse` = `#0e0e12` | `--color-accent-blue-text: #ffffff` exists but Button uses `text-inverse` — likely React bug | visual |
| Primary hover | `#3574f0` | `--color-accent-blue-dark` | — | — |
| Primary active | `#2a5fc0` | not implemented | Drop or add `active:` | cosmetic |
| Danger default | solid `#f75464` + white text | tinted `rgba(247,84,100,0.12)` bg + red text | **Major variant mismatch** — pen shows hover, React default is tinted | critical |
| Danger hover | `#c54350` (dark) | solid accent + white | Opposite direction from pen | visual |
| Warning/Success default | solid bg + `#0e0e12` text | tinted bg + accent text; hover→solid + inverse | Same pattern mismatch as danger | critical |
| Ghost default | transparent | `border-transparent bg-transparent text-text-secondary` | — | — |
| Ghost hover | `#2a2d31` opaque | `rgba(var(--color-bg-hover-rgb),0.35)` | Pen/real differ on alpha | visual |
| Dashed | transparent + dashed `#484b4f` | `border-dashed border-[var(--control-border)]` | — | — |
| Height | 32 | 30 (`--control-height-md`) | Bump token or pen | visual |
| Font size / weight | 13 / 500 | 14 / 400 | Align | visual |
| Gap | 6 | `gap-2` = 8 | Set pen to 8 | cosmetic |

**Verdict:** major drift

**Notes:** Biggest issue is variant semantics for **danger/warning/success**: React ships tinted-bg-with-accent-text defaults flipping to solid-fill-with-inverse-text on hover. Pen documents only the solid/hover treatment as default. Primary's `text-text-inverse` (dark) vs `--color-accent-blue-text: #ffffff` is a latent Button.tsx bug.

### view / Form Controls (`ZjaPs`)

- Screenshot: `plans/style-guide-audit/screenshots/ZjaPs.png`
- React file(s): `src/components/ui/{TextInput,Textarea,Checkbox,Toggle,Select,Label,FormGroup}.tsx`, `src/components/common/IconButton.tsx`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Textarea error state | red border | no `error` prop; only focus/disabled wired | Add `error?: ReactNode` mirroring TextInput | visual |
| FormGroup error → input border | FormGroup error colors help red AND input border red | FormGroup sets `aria-invalid` + red help, but input only reddens when ITS OWN `error` prop is set | Forward `error` to child OR have TextInput read `aria-invalid` | visual |
| Toggle knob travel (md) | knob x=19 (right edge) | `translate-x-4` = 16 with 1px inset → stops ~17 | Use `translate-x-[18px]` | cosmetic |
| Toggle sm knob travel | proportional | `sm` also uses `translate-x-4` | Give `sm` own translate | cosmetic |

**Verdict:** minor drift

**Notes:** TextInput, Checkbox, Select, IconButton, Label cover all pen states. Material gaps: Textarea missing `error`, FormGroup error not reaching input border, Toggle knob translate off by ~2px.

### view / Navigation (`E63Gg`)

- Screenshot: `plans/style-guide-audit/screenshots/E63Gg.png`
- React file(s): `src/components/TabBar.tsx:14`, `src/components/UnifiedTab.tsx:23`, `src/components/sidebar/Sidebar.tsx:1825-1890`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Primary tab set | Sessions / Specs / Settings / Forge | App has no such top nav; `TabBar` shows per-project tabs; Settings is modal; Forge is in-session; Spec is a sidebar FilterMode | Re-model pen as "Project tabs" or "Sidebar filter pills" | critical |
| Tab bar height | 36 fixed | `h-full` inherited | Host-controlled | cosmetic |
| Tab bar bottom border | 1px border-subtle | no strip-wide bottom border; tabs have `border-right` | Either direction | visual |
| Active tab bg | `rgba(#181a1d, 0.8)` literal | `var(--color-tab-active-bg)` token | Use token | visual |
| Close button on tabs | not in pen | real renders `×` on hover/active | Add to pen | cosmetic |
| Search box width | 280 fixed pill | inline full-width `h-8 px-3 border-b` bar | Redraw as bar (matches Phase 1 finding) | critical |
| Search trigger | always visible | gated by `isSearchVisible` toggle | Add hidden/open states | visual |
| Search focused border | accent-blue | `outline-none` + no focus border | Add focus ring or drop from pen | visual |
| Search result-count | pen shows pill | real shows plain muted text | Drop pill | visual |
| Clear button | `×` inside pill w/ blue border | icon-only SVG, muted | Simplify pen | visual |
| Search magnifier icon | not in pen | present at `w-3 h-3 text-muted` | Add to pen | cosmetic |

**Verdict:** major drift

**Notes:** Biggest issue: pen documents a 4-tab top nav that doesn't exist in the product. Split into "Project tabs" and "Sidebar filter pills". Sidebar search confirmed as bar, not pill.

### view / Feedback & Status (`4mQc8`)

- Screenshot: `plans/style-guide-audit/screenshots/4mQc8.png`
- React file(s): `src/components/common/ProgressIndicator.tsx:1`, `src/components/forge/PipelineStatusBadge.tsx:1`, `src/components/forge/ForgeLabelChip.tsx:1`, `src/components/Tab.tsx:18` (numeric badge)

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| ProgressIndicator sizes | 14 / 16 / 20 | `h-3.5` / `h-4` / `h-5` | — | — |
| ProgressIndicator dot count | 3 pulsing | 3 dots with staggered 0/0.3/0.6s | — | — |
| ProgressIndicator dot color | accent-blue | `var(--color-accent-blue)` | — | — |
| Shared Badge primitive | 4-variant Info/Success/Warning/Error | none — only `PipelineStatusBadge` (forge-specific) | Extract `src/components/ui/Badge.tsx` with variants | visual |
| Info variant | blue 12% + border + dot + text | Pipeline tier 1 "running" renders this exactly | Reuse once extracted | — |
| Success variant | green tinted + dot | `pipelineStatusVisual.success` is tier 3 (no bg/border) | Add tier-1 success | visual |
| Warning variant | amber tinted + dot | `pipelineStatusVisual.manual` tier 1 matches | Reuse | — |
| Error variant | red tinted + dot | tier 1 `failed` matches colors but `showLeadingDot: false` | Enable dot on generic error | visual |
| Chip (neutral tech tag) | bg-tertiary + border-subtle + secondary 11/500 | no shared neutral Chip; only `ForgeLabelChip` (colored) | Add `Chip` primitive | visual |
| Chip (solid accent) | `#3574f0` solid + `#e8effd` text | no shared solid-accent chip | Add `variant: accent` | visual |
| Numeric badge "3" | solid red + white 11/600 | `Tab.tsx` attention badge uses `--color-tab-badge-bg/text` but weight 500 | Bump weight to 600, extract to `CountBadge` | cosmetic |

**Verdict:** major drift

**Notes:** ProgressIndicator matches. Missing shared Badge / Chip / CountBadge primitives; pen prescribes 4-variant Badge that doesn't exist as a single primitive.

### view / Cards & Overlays (`CouD2`)

- Screenshot: `plans/style-guide-audit/screenshots/CouD2.png`
- React file(s): `src/components/sidebar/SessionCard.tsx:119-125, 742-756`, `src/index.css:364-374`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Selected ring (`xQJWg`) | bare 2px blue border | `.session-ring-blue` = `box-shadow: 0 0 0 2px accent-blue, 0 0 0 4px accent-blue-bg` + 12% blue fill + `scale(0.97)` | Pen should show 4px halo + bg tint + scale | visual |
| Selected ring radius | same as card | `.session-ring` overrides to 6px on select | Add slight radius tightening to pen | cosmetic |
| Selected ring scale | 1.0 | `transform: scale(0.97)` | Note shrink in pen | cosmetic |
| Bottom shortcut (`lNoKt`) | separate treatment | same inline `⌘N` pill as all other SessionCard states — rendered when `index < 8` | Remove duplicate treatment or rename | cosmetic |
| Gallery canvas bg | `#0e0e12` | `--color-bg-secondary` | Gallery-only choice | cosmetic |

**Verdict:** minor drift

**Notes:** `xQJWg` is the only real drift — real selected treatment is richer (halo + fill + scale) than the bare ring pen shows. `lNoKt` is not a new treatment; same inline shortcut pill.

### view / New Session Modal (`ss6Yu`)

- Screenshot: `plans/style-guide-audit/screenshots/ss6Yu.png`
- React file(s): `src/components/modals/NewSessionModal.tsx:395, 451, 463, 501, 521, 536, 546`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Modal shell | bg `#272a2e`, 1px `#484b4f`, radius 10, width 720 | `ResizableModal` with drag handles, defaultWidth 720 / defaultHeight 620 | Pen omits resize affordance | cosmetic |
| Modal body padding | 20 | `p-5` + `gap-4` | — | — |
| Close `x` icon-button | explicit top-right | not in NewSessionModal.tsx — assumed in ResizableModal | Verify chrome | visual |
| Name+Epic row | single FormGroup | FormGroup + generate-name sparkle button (rightElement) | Pen missing sparkle | cosmetic |
| Presets grouping | dedicated "Presets" header + nested `#0e0e12` panel + "Basic Agents" header | single flat `favorite-carousel` at `:501`, no section headers | Add section headers + nested panel, or update pen to flat | major |
| Prompt "StartFromButton" pill | elevated pill in header row | only plain "Prompt / Content" label | Add or drop from pen | visual |
| Prompt editor | fixed h 220, bg `#181a1d`, radius 6, 1px `#484b4f` | `min-h-[220px]` + `flex-1` grow, bg-primary, border-default | Resizable-modal pattern — acceptable | cosmetic |
| Prompt hint | present | present | — | — |
| Footer | left version Select 140 + right Cancel/Create | left Dropdown-wrapped button (`min-w-[140px]`) + conditional "Custom settings…" ghost + right Cancel/Create | Pen missing "Custom settings…" | visual |
| Version selector | Select 140px static | custom Dropdown button (not Select), disabled unless raw-agent | Pen shows as Select; update to Dropdown-as-button | visual |
| Create button | primary blue + inverse text | `<Button variant="primary">` with loading | Verify tokens | cosmetic |
| Prefill warning banner | absent | conditional yellow banner at `:521` | React-only — add to pen | cosmetic |
| Advanced panel | absent | conditional `NewSessionAdvancedPanel` at `:536` | Document as expandable | cosmetic |

**Verdict:** major drift

**Notes:** Biggest structural drift is presets/basic-agents grouping — pen has two labeled sections with a nested elevated panel; React renders a single flat carousel. Pen also omits generate-name sparkle, prefill warning, and "Custom settings…" toggle; React omits the StartFromButton pill.

### view / Agents Sidebar (`00g6Y`)

- Screenshot: `plans/style-guide-audit/screenshots/00g6Y.png`
- React file(s): `src/components/sidebar/Sidebar.tsx:1645, 1780, 1824, 2033`, `SidebarSectionHeader.tsx:1`, `EpicGroupHeader.tsx:1`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Sidebar wrapper | 24px padding, 1px border-subtle, radius 8 on `#181a1d` panel | flush side panel (no rounded container); sections `px-2 pt-2` | Drop wrapper from pen | visual |
| Header label | "AGENTS" 11/600 tertiary | uppercase `text-xs font-medium text-text-tertiary` + Board/List toggle + collapse icon | Add view-mode toggle + collapse icon to pen | visual |
| Orchestrator bg | `#14161a` + persistent accent-blue 50% border | `hover:bg-bg-hover/30 border-border-subtle`; selected uses `bg-bg-elevated/60 session-ring-blue` — no standing blue border | Either align state or document | visual |
| Orchestrator meta | shortcut + branch chips only | adds model-switch + refresh IconButtons + ProgressIndicator when running | Add icons + progress to pen | visual |
| "Quick filters" label | present | **no such string exists in code** | Remove from pen (fabricated) | critical |
| SearchBox styling | 280 pill w/ radius 6, padding 9/10 | `h-8 px-3 border-b bg-bg-secondary` full-width bar — confirms Phase 1 | Update pen | critical |
| Search results + clear | count as inline chip | plain text + icon-only `×` — matches Phase 1 | Simplify pen | cosmetic |
| Section headers | label + count only | label + count + 1px divider + collapse chevron | Add divider+chevron to pen | visual |
| Section count badge color | neutral tertiary for SPECS, blue for RUNNING | neutral across all sections | Drop blue variant OR implement per-section color | cosmetic |
| Epic header | accent bar + dot + count | adds kebab `Dropdown` (edit/delete) not in pen | Add kebab to pen | visual |
| Epic context menu | free-floating right-click panel | click-driven Dropdown on kebab; no `onContextMenu` | Pen should show kebab + dropdown | visual |
| UNGROUPED divider | two hrs + "UNGROUPED" label | matches exactly | — | — |
| Session right-click menu | pen places `PnJAA` at (424,24) | **no `onContextMenu` in `src/components/sidebar/**`** — not wired | Remove from pen OR add in code | critical |

**Verdict:** major drift

**Notes:** Two critical fabrications in pen — "Quick filters" label and session right-click context popup don't exist in code. SearchBox is bar, not pill.

### view / Agents Sidebar — Board (`jwCvs`)

- Screenshot: `plans/style-guide-audit/screenshots/jwCvs.png`
- React file(s): `src/components/sidebar/KanbanView.tsx:43`, `KanbanSessionRow.tsx:14`, `SidebarSectionHeader.tsx:13`, `Sidebar.tsx:1649`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Section list | Idea / Clarified / Working On / Judge Review / Ready To Merge / Archive | same labels + Archive terminal column | — | — |
| Board mode pill | bordered pill (1px, radius 4, 2/8 pad, bg `#181a1d`) | text-only toggle, no border/bg | Wrap in border+radius pill | visual |
| Selected card cluster (`xRhQi`) | dedicated wrapper bg `#272a2e` + 2px accent-blue border + radius 8 + action strip inside | no wrapper; row uses only `session-ring-blue` on itself; **no action strip in board view** | Add cluster wrapper + action strip, or drop from pen | critical |
| Action Strip under selected card | 1px top border-subtle, padding 8/12, action icons | not rendered in board view at all | Render action strip or drop from pen | critical |
| Consolidation rail | `pl-2 border-l border-border-subtle` | implemented via `consolidation_round_id` grouping | — | — |
| Section count badge color | colored per stage (running=blue, judge=purple, ready=green) | always neutral regardless of stage | Add per-stage color variants | visual |
| Stage accent on cards | idea=amber, clarified/working=blue, judge=violet, ready=green | `KanbanSessionRow` has only text + stage label; no accent bar / stripe | Add stage accent | critical |
| Status pill inside card | tinted pill with stage color | plain muted caption, no pill | Render status pill | visual |
| Agent color chip | per-agent color indicator | not rendered | Add agent chip | visual |
| Shortcut hint | right-aligned ⌘N badge | not rendered | Add | cosmetic |
| Archive section | collapsed by default | matches (`collapsed: true`, `-rotate-90` chevron) | — | — |

**Verdict:** major drift

**Notes:** Structural bones match. Visual language diverges significantly: `KanbanSessionRow` has no stage accent, status pill, agent chip, shortcut hint, or selected-cluster wrapper. Board view is far more minimal than pen documents.

### view / Version Group Running (`QNpSD`)

- Screenshot: `plans/style-guide-audit/screenshots/QNpSD.png`
- React file(s): `src/components/sidebar/SessionVersionGroup.tsx:439-670`, `src/utils/agentColors.ts:1-21`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Outer card bg | solid `#181a1d` | `rgb(var(--color-bg-elevated-rgb) / 0.55)` translucent | Pen should use elevated-translucent token | visual |
| Outer card border | 1px border-subtle | 1px border-default (or accent-blue-border when selected) | Swap pen to border-default | cosmetic |
| Outer card padding | 16 | `px-3 py-3` = 12 | Relax pen or tighten React | cosmetic |
| Header state pill (Running) | green tint (`#1c2b22` + `#2f5a41` border + dot `#6aab73` + text `#9ed5a8`) | React maps `running` → tone `'blue'` (blue pill) | **Pen & React disagree on color semantics** | critical |
| Chevron + baseName + count badge | only title "Version Group Component" | `VscChevronRight` + baseName + `X / Y` count badge | Add to pen | visual |
| Action button size | 22×22 | `h-6 w-6` = 24 | Resize pen | cosmetic |
| Action button set | Consolidate / Judge / Confirm / Terminate unconditionally | Conditional (Consolidate only if `hasMultipleVersions && onConsolidate`; Judge/Confirm keyed on `activeRoundId`/`confirmWinnerSessionId`; Terminate only if `hasRunning`); tones: Judge=amber, Confirm=green, Terminate=red | Add tones + note conditional visibility | visual |
| Row grouping / corners | fused rows with top/bottom shared corners | rows stacked with `space-y-1.5`, each independently `rounded-md` — no fused corners | Drop fused-row idea or refactor | visual |
| Row separator | implicit | `border-t` with `border-subtle/0.7` above row list | Add divider in pen | cosmetic |
| Agent color `gemini` | `#ef9b41` (non-theme) | maps to `--color-accent-amber` via `AGENT_COLORS` | Use token | critical |
| Agent color `codex` | `#c45d52` (non-theme) | maps to `--color-accent-red` | Use token | critical |

**Verdict:** major drift

**Notes:** Two critical issues: (1) pen renders Running in green, React in blue — disagreement on accent semantics. (2) pen hard-codes off-theme hex (`#ef9b41`, `#c45d52`, `#f75464`) for agent/status colors; real code maps to `--color-accent-{amber,red}`. No `--color-accent-orange` exists.

### view / Version Suggested (`sR597`)

- Screenshot: `plans/style-guide-audit/screenshots/sR597.png`
- React file(s): `src/components/sidebar/SessionVersionGroup.tsx:585-665`, `CompactVersionRow.tsx:201, 399`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Consolidation lane bg | `#b07cd80d` (violet 5%) | `--color-accent-violet-bg` = 12% | Introduce 5% token (e.g. `-bg-subtle`) | visual |
| Consolidation lane border | `#b07cd850` (31%) | 50% | Add 31% token or reduce accent-violet-border alpha | visual |
| Consolidation lane radius/padding | 6 / 8-10 | `rounded-md` `px-2.5 py-2` | — | — |
| Judge-recommendation inner card bg | `#b07cd814` (8%, step darker than lane) | same 12% as outer lane — no separation | Use distinct 8% token | visual |
| "Judge recommends {agent} v{n}" text | prominent | rendered via `recommendationLabel` with value highlighted | — | — |
| Confirm action in banner | 22×22 | `h-6 w-6` = 24 | Acceptable near-match | cosmetic |
| Merge-candidate row treatment | top-rounded + full opacity; neighbors faded 0.5 | all rows uniformly `rounded-md`; dimming *inverted* — `isDimmedForConsolidation` dims sources, not rejected candidates | Add `isMergeCandidateWinner` styling | visual |
| Accent colors `#d4a72c`/`#ef9b41`/`#c45d52` | pen literals | theme tokens via `AGENT_COLORS` | Swap pen to tokens | cosmetic |
| Action row post-judge | 3 buttons (Consolidate/Confirm/Terminate) | 4 buttons — retains **Re-run Judge** refresh | Hide Re-run after `latestJudge` OR update pen | visual |
| "Judge recommends X" banner | shown immediately | rendered when `recommendationLabel` exists, Confirm unblocked | Honors project memory requirement | — |

**Verdict:** minor drift

**Notes:** Banner surfaces correctly and unblocks Confirm (honors memory). Drift is in (1) violet alpha tiers (pen wants 5%/8%, React uses single 12%) and (2) missing merge-candidate winner styling. Action row keeps Re-run Judge post-judge that pen omits.

### view / Version Group Running — Judging (`xzyG4`)

- Screenshot: `plans/style-guide-audit/screenshots/xzyG4.png`
- React file(s): `src/components/sidebar/SessionVersionGroup.tsx:283-335, 397, 519-569`, `CompactVersionRow.tsx:196-202`

| Property | Pen value | Real value | Fix | Severity |
|---|---|---|---|---|
| Header status badge tone | green "Running" | blue "Running" (tone `'blue'`) | Pen should use blue | visual |
| Action row button set | 2 buttons (Consolidate + Terminate) | 3 buttons — Consolidate (disabled) + **Trigger/Re-run Judge** + Terminate whenever `activeRoundId` | Pen missing in-flight re-run judge button | major |
| Active candidate row accent | violet accent on Row 1 | no violet accent — row renders identically to others (violet lane hidden while judge runs) | Add violet accent to `isConsolidationCandidate` rows or drop from pen | visual |
| Non-candidate row dimming | 0.55 / 0.62 / 0.56 | 0.55 uniform via `isDimmedForConsolidation` | Use single 0.55 in pen | cosmetic |
| Row grouping / corners | 4 rows fused (top `[6,6,0,0]`, middle sharp, bottom `[0,0,6,6]`) | each row independently `rounded-md` with 6px gap | Drop fused idea | visual |
| Row surface color | `#272a2e` + default elevated | `--color-bg-elevated` via `getSessionCardSurfaceClasses` | Use tokens in pen | cosmetic |
| Agent hex | `#b07cd8`, `#c45d52`, `#ef9b41` | theme tokens | Swap pen | cosmetic |

**Verdict:** major drift

**Notes:** React DOES dim non-candidates at 0.55 during judge (`isDimmedForConsolidation` triggered whenever `focusJudge` exists). Pen omits the Re-run Judge button React always shows during an active round. Pen also paints active candidate violet where React uses violet only inside the post-judge lane.

---

## Phase 2 — Summary

### Verdict tally

- `matches`: 0
- `minor drift`: 5 (Color Palette, Form Controls, Cards & Overlays, Version Suggested, [plus Phase 1's 20])
- `major drift`: 8 (Typography, Buttons, Navigation, Feedback & Status, New Session Modal, Agents Sidebar, Agents Sidebar — Board, Version Group Running, Version Group Judging) — note 8 not 9 because only two verdicts use "major drift" per individual audit

### Phase 2 — new critical items

Phase 2 surfaced these items marked `critical` (in addition to Phase 1's 5):

1. **Pen documents a top nav (Sessions/Specs/Settings/Forge) that doesn't exist** (`E63Gg` Navigation). App's tab affordances are per-project TabBar + sidebar FilterMode pills; Settings is modal, Forge is in-session. Either re-author pen view or accept split.
2. **Pen's sidebar search pill is fictional** (`E63Gg`, `00g6Y`). Real search is a flush `h-8 border-b` bar, not a 280px rounded pill.
3. **"Quick filters" label in pen doesn't exist in code** (`00g6Y`). Remove or add string.
4. **Session right-click context menu doesn't exist** (`00g6Y`). No `onContextMenu` in `src/components/sidebar/**`. Same critical as Phase 1's DropdownMenu missing.
5. **Selected-card cluster + Action Strip missing in board view** (`jwCvs`). Pen shows a bordered cluster with action strip; code has neither. Bigger: `KanbanSessionRow` has no stage accent, status pill, agent chip, or shortcut hint — far more minimal than pen documents.
6. **Presets grouping divergence in New Session Modal** (`ss6Yu`). Pen has two labeled sections + nested panel; code has flat carousel.
7. **Running badge color disagreement** (`QNpSD`, `xzyG4`). Pen renders green; React renders blue. Pick canonical.
8. **Pen hard-codes off-theme agent colors** (`#ef9b41`, `#c45d52`, `#d4a72c`) across CompactVersionRow / version group views. React correctly uses `AGENT_COLORS` → theme tokens.

### Combined cross-phase fix priorities

**Critical (code + pen reconciliation):**
1. Missing primitives: shared `DropdownMenu`, `Badge`, `Chip`, `CountBadge` — affects Feedback & Status view + session context menu.
2. Missing a11y on menus: `role="menu"`/`menuitem`, arrow-key nav, `focus-visible`.
3. `KanbanSessionRow` needs stage accent + status pill + agent chip + selected cluster wrapper to match pen board view, OR pen must simplify.
4. Button danger/warning/success default vs hover semantics (solid-vs-tinted) — reconcile and document.
5. Typography section — add a `TypographySection.tsx` so style-guide renders the ladder that pen documents.

**Global token fixes (one change, many wins):**
- `--control-height-md` 30 → 32 (Phase 1).
- `--font-input` 14 → 13 or vice-versa (Phase 1).
- Add `--color-accent-violet-bg-subtle` (5%) + 8% token tier for nested consolidation hierarchy.
- Add `--color-accent-yellow` swatch to `ColorReferenceSection`.
- Decide whether Running at group level is blue or green and apply consistently.

**Pen corrections (non-code):**
- Remove fictional "Quick filters" label.
- Remove fictional session right-click popup OR add to code.
- Remove 4-tab top nav OR split into Project tabs + Sidebar filter pills.
- Swap SearchBox to flush `h-8 border-b` bar.
- Replace `#ef9b41`, `#c45d52`, `#d4a72c` agent hexes with theme tokens.
- Simplify non-candidate row opacity to single 0.55.

**Cosmetic cleanup (Phase 1 items still apply):**
- Chevron sizes, shortcut badge heights, transparent icon-button borders.

### Final tally across both phases

- Components + views audited: **22 + 13 = 35**
- Matches: 0
- Minor drift: 25
- Major drift: 10
- Critical diff rows: **13** (5 from Phase 1 + 8 from Phase 2)

Phase 2 surfaced real-app divergence that Phase 1 couldn't see — the Kanban board, sidebar context menu gaps, and running-badge color semantic disagreement are the highest-leverage items to resolve before the pen file can serve as canonical design spec.


