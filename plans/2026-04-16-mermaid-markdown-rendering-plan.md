# Mermaid Markdown Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render fenced `mermaid` Markdown blocks as diagrams everywhere the shared `MarkdownRenderer` is used.

**Architecture:** Keep the integration inside `src/components/specs/MarkdownRenderer.tsx`. The existing `code` override remains responsible for all inline and non-Mermaid code, while Mermaid fenced blocks route to a small React component that asynchronously imports Mermaid, renders SVG, logs failures, and avoids per-surface flags.

**Tech Stack:** React 19, react-markdown, remark-gfm, Mermaid, Vitest, Testing Library.

---

### Brainstormed Design

Recommended approach: add Mermaid support at the shared renderer boundary. This matches the requirement that spec preview, forge details, GitHub prompt previews, and file previews all gain support through one path. A separate per-surface integration would duplicate behavior, and a Markdown preprocessor would make error handling and React lifecycle cleanup harder than a component-level branch.

The trigger is intentionally narrow: only fenced blocks whose class resolves to `language-mermaid` render as diagrams. Inline code and all other fenced languages keep the current styled `<code>` output.

Rendering happens after mount because Mermaid is DOM-oriented and returns SVG asynchronously. The component tracks render state, ignores stale async results after unmount or content changes, logs failures with the project logger, and shows a small fallback with the raw source if rendering fails.

### Task 1: Renderer Tests

**Files:**
- Modify: `src/components/specs/MarkdownRenderer.test.tsx`

**Step 1: Write failing tests**

Add tests that mock the `mermaid` package and assert:
- a fenced `mermaid` block calls `mermaid.render` and displays returned SVG
- a fenced non-Mermaid block still renders as a styled code block with raw source

**Step 2: Run targeted test**

Run: `bun run test:frontend -- src/components/specs/MarkdownRenderer.test.tsx`

Expected: Mermaid rendering test fails because the renderer still emits raw `<code>`.

### Task 2: Mermaid Dependency

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

**Step 1: Add dependency**

Run: `bun add mermaid`

**Step 2: Confirm package metadata updates**

Run: `rg -n '"mermaid"' package.json bun.lock`

Expected: `mermaid` appears as a dependency.

### Task 3: Mermaid Component

**Files:**
- Modify: `src/components/specs/MarkdownRenderer.tsx`
- Modify: `vite.config.ts`

**Step 1: Implement minimal rendering component**

Add a `MermaidDiagram` component that:
- dynamically imports `mermaid`
- initializes Mermaid with `startOnLoad: false`
- initializes Mermaid with `securityLevel: 'strict'`, `theme: 'base'`, and theme variables from the active Lucode CSS variables
- renders SVG into a generated id
- stores SVG in state
- logs errors and shows fallback UI on failure

**Step 2: Branch in `customComponents.code`**

When `className` contains `language-mermaid`, return `<MermaidDiagram chart={String(children).trim()} />`; otherwise return the existing code block.

**Step 3: Run targeted test**

Run: `bun run test:frontend -- src/components/specs/MarkdownRenderer.test.tsx`

Expected: all renderer tests pass.

### Task 4: Validation and Review

**Files:**
- Verify all changed files

**Step 1: Run full validation**

Run: `just test`

Expected: all validations pass.

**Step 2: Request code review**

Use the requesting-code-review workflow on the final diff and address any Critical or Important findings.

**Step 3: Create squashed commit**

Run:

```bash
git status --short
git add src/components/specs/MarkdownRenderer.tsx src/components/specs/MarkdownRenderer.test.tsx src/adapters/pierreDiffAdapter.ts src/adapters/pierreDiffAdapter.test.ts vite.config.ts package.json bun.lock plans/2026-04-16-mermaid-markdown-rendering-plan.md
git commit -m "feat: render mermaid markdown diagrams"
```
