# Standalone Style Guide Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a browser-only style guide page at `http://localhost:1420/style-guide.html` that renders Lucode UI components and mock settings data without the Tauri backend.

**Architecture:** Use a second root HTML/Vite entry and a dedicated React entry module that installs a narrow browser-side Tauri mock. Render real UI/settings components where their dependencies can be satisfied by mocked `invoke` responses, and render inline preview wrappers for fixed-position dialogs and integration-heavy modal content.

**Tech Stack:** React, Vite multi-entry build, Jotai, Tailwind/theme tokens, Vitest, Testing Library.

---

### Task 1: Add failing tests for the new entry and gallery shell

**Files:**
- Create: `src/style-guide.test.tsx`
- Create: `src/style-guide/StyleGuide.test.tsx`

**Step 1: Write the failing entry test**

- Assert importing `src/style-guide.tsx` creates a React root and renders the style guide tree.
- Assert the browser-only Tauri shim exists before render and the initial theme is applied from URL/local storage behavior.

**Step 2: Run the entry test and verify RED**

Run: `bunx vitest run src/style-guide.test.tsx`

**Step 3: Write the failing gallery shell test**

- Assert the gallery renders the five required section headers.
- Assert the theme selector includes the requested theme options.

**Step 4: Run the gallery shell test and verify RED**

Run: `bunx vitest run src/style-guide/StyleGuide.test.tsx`

### Task 2: Add the new style-guide entry wiring

**Files:**
- Create: `style-guide.html`
- Create: `src/style-guide.tsx`
- Modify: `vite.config.ts`
- Modify: `knip.json`

**Step 1: Add the HTML entry**

- Mirror the existing `index.html` anti-flash structure.
- Point it at `/src/style-guide.tsx`.

**Step 2: Implement the React entry**

- Import shared CSS.
- Install the browser-only Tauri shim.
- Create a dedicated Jotai store.
- Initialize theme from query/local storage and render the gallery.

**Step 3: Update Vite multi-entry build**

- Add `rollupOptions.input` entries for `index.html` and `style-guide.html`.

**Step 4: Update Knip ignore rules**

- Ignore `src/style-guide.tsx` and `src/style-guide/**` so the dev-only gallery files are not treated as dead code.

### Task 3: Build the gallery sections and mocks

**Files:**
- Create: `src/style-guide/StyleGuide.tsx`
- Create: `src/style-guide/mocks.tsx`
- Create: `src/style-guide/sections/PrimitivesSection.tsx`
- Create: `src/style-guide/sections/CommonSection.tsx`
- Create: `src/style-guide/sections/SettingsSection.tsx`
- Create: `src/style-guide/sections/DialogsSection.tsx`
- Create: `src/style-guide/sections/ColorReferenceSection.tsx`

**Step 1: Add shared mock data/helpers**

- Centralize theme ids, mock settings payloads, local theme helpers, and command-response logic.

**Step 2: Add the gallery shell**

- Sticky toolbar with theme `Select`.
- Section wrappers and overall page layout.

**Step 3: Add the primitives section**

- Render the requested UI components in the requested states.

**Step 4: Add the common section**

- Render real inline-edit/search/spinner/icon button previews.
- Render inline wrappers for the confirm dialogs that otherwise use fullscreen fixed overlays.

**Step 5: Add the settings section**

- Render the real settings components backed by the mocked Tauri command responses.

**Step 6: Add the dialogs section**

- Render representative inline content for confirm/link-PR modal bodies.

**Step 7: Add the color reference section**

- Read CSS variables from computed styles.
- Render swatches for background, text, border, accent, and control tokens.

### Task 4: Verify incrementally and clean up

**Files:**
- Modify any new style-guide files as needed based on test or lint failures.

**Step 1: Run targeted tests**

Run: `bunx vitest run src/style-guide.test.tsx src/style-guide/StyleGuide.test.tsx`

**Step 2: Run a production build check**

Run: `bun run build`

**Step 3: Run the full validation suite**

Run: `just test`

**Step 4: Request code review**

- Use the code review workflow after implementation and before commit.

**Step 5: Commit once**

Run:

```bash
git add style-guide.html vite.config.ts knip.json src/style-guide.tsx src/style-guide docs/plans/2026-04-05-style-guide-page-design.md docs/plans/2026-04-05-style-guide-page-plan.md src/style-guide.test.tsx
git commit -m "feat: add standalone style guide page"
```
