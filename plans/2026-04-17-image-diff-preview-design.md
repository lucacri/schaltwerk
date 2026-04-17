# Image Diff Preview Design

## Goal

Image files that are already classified as binary should render inline previews in the diff list and single-file viewer instead of the generic binary placeholder.

## Approach

Add explicit image-extension helpers beside the existing binary-extension helpers in TypeScript and Rust. Keep the image set identical to the existing "Image files" group: `png`, `jpg`, `jpeg`, `gif`, `bmp`, `tiff`, `tif`, `webp`, `ico`, and `svg`.

Add a Tauri command that returns an optional image `data:` URL for a requested side of a diff. For the current side it reads the worktree path. For the base side it reads the merge-base blob for session diffs, the HEAD blob for orchestrator working changes, or the parent commit blob for history diffs. The command returns `null` when that side does not exist, such as the old side of an added file or the new side of a deleted file.

Create a shared React image preview component for diff images. It fetches only the sides needed by the change type:

- `modified`: old and new
- `added`: new
- `deleted`: old
- `renamed` and `copied`: old and new when available, collapsing identical data URLs to one preview
- `unknown`: new, with old as fallback

`PierreDiffViewer` will render this component for binary files with supported image extensions. Other binary files keep the current placeholder. `FileContentViewer` will render the same single-side preview for supported image extensions when `read_project_file` reports the file as binary.

## Error Handling

Image preview failures fall back to the existing binary placeholder. Missing sides are expected for added and deleted files and are not treated as errors. The backend rejects non-image extensions for the image command.

## Testing

Write tests first:

- TypeScript image-extension helpers detect all supported image formats and reject non-images.
- `PierreDiffViewer` renders before/after image previews for modified image binaries and preserves the generic binary placeholder for non-image binaries.
- `FileContentViewer` renders an image preview when a binary response is for a supported image path.
- Rust image helpers produce the expected MIME types and reject non-images.

