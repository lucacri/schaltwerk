# Image Diff Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render supported image binaries inline in diff views and the single-file viewer.

**Architecture:** Add image-extension detection on both sides of the Tauri boundary, expose a backend command that returns image data URLs for diff sides, and consume it through a shared React preview component. Existing binary placeholders remain the fallback for non-images and preview failures.

**Tech Stack:** React, Vitest, Tauri command enum, Rust, git2, base64.

---

### Task 1: Image Detection Helpers

**Files:**
- Modify: `src/utils/binaryDetection.ts`
- Modify: `src/utils/binaryDetection.test.ts`
- Modify: `src-tauri/src/binary_detection.rs`

**Step 1: Write the failing tests**

Add tests for `isImageFileByExtension`, `getImageExtensions`, and Rust `is_image_file_by_extension` plus MIME inference.

**Step 2: Run the targeted tests**

Run:

```bash
bun vitest run src/utils/binaryDetection.test.ts
cd src-tauri && cargo test binary_detection
```

Expected: fail because image-specific helpers do not exist.

**Step 3: Implement the helpers**

Extract `IMAGE_EXTENSIONS` in TypeScript and Rust, build the binary list from image plus other binary extensions, and add MIME inference for image data URLs.

**Step 4: Re-run targeted tests**

Expected: pass.

### Task 2: Backend Image Data Command

**Files:**
- Modify: `src-tauri/src/diff_commands.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/common/tauriCommands.ts`
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src-tauri/src/domains/git/stats.rs`

**Step 1: Write the failing tests**

Add Rust tests for image data URL construction and changed-file `previous_path` capture for renamed/copied deltas.

**Step 2: Run the targeted tests**

Run:

```bash
cd src-tauri && cargo test image_preview changed_files
```

Expected: fail until the helper and changed-file metadata exist.

**Step 3: Implement the command**

Add `read_diff_image` to `diff_commands.rs` and register it in `main.rs`. The command accepts file path, optional old file path, side (`old`/`new`), optional session name, optional project path, optional commit hash, and optional repo path. It returns `{ data_url, size_bytes, mime_type }` or `null`.

**Step 4: Re-run targeted tests**

Expected: pass.

### Task 3: React Image Preview Component

**Files:**
- Create: `src/components/diff/ImageDiffPreview.tsx`
- Create: `src/components/diff/ImageDiffPreview.test.tsx`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`
- Modify: `src/common/i18n/types.ts`

**Step 1: Write the failing tests**

Cover modified before/after rendering, added new-only rendering, and renamed/copy identical-image collapse.

**Step 2: Run the targeted tests**

Run:

```bash
bun vitest run src/components/diff/ImageDiffPreview.test.tsx
```

Expected: fail because the component does not exist.

**Step 3: Implement the component**

Use `TauriCommands.ReadDiffImage`, theme colors/font sizes, and deterministic `useEffect` fetches. Show existing fallback content when preview loading fails or no image side can be read.

**Step 4: Re-run targeted tests**

Expected: pass.

### Task 4: Integrate Diff List and File Viewer

**Files:**
- Modify: `src/components/diff/PierreDiffViewer.tsx`
- Create: `src/components/diff/PierreDiffViewer.image-preview.test.tsx`
- Modify: `src/components/diff/FileContentViewer.tsx`
- Create: `src/components/diff/FileContentViewer.test.tsx`
- Modify: `src/components/diff/UnifiedDiffView.tsx`

**Step 1: Write the failing tests**

Assert `PierreDiffViewer` renders image previews instead of "Binary file" for image binaries and keeps the placeholder for non-image binaries. Assert `FileContentViewer` renders a current-side image preview for image binaries.

**Step 2: Run targeted tests**

Run:

```bash
bun vitest run src/components/diff/PierreDiffViewer.image-preview.test.tsx src/components/diff/FileContentViewer.test.tsx
```

Expected: fail until integration exists.

**Step 3: Implement integration**

Pass image preview context from `UnifiedDiffView` into `PierreDiffViewer`. Branch binary rendering through the preview only when `isImageFileByExtension(file.path)` is true. Use a single-side `ImageDiffPreview` from `FileContentViewer` after `read_project_file` reports a supported image path as binary.

**Step 4: Re-run targeted tests**

Expected: pass.

### Task 5: Full Verification and Commit

**Files:**
- All modified files.

**Step 1: Run full validation**

Run:

```bash
just test
```

Expected: all checks pass.

**Step 2: Request code review**

Review the diff against the starting commit and fix any critical or important findings.

**Step 3: Create the squashed commit**

Run:

```bash
git status --short
git add <changed-files>
git commit -m "feat: preview image diffs inline"
```

