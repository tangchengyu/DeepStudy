# Long Task Image Insertion and Navigation Design

## Scope

Improve the local-only long-task experience in three areas:

1. Insert local images into a long-task note by dragging image files from Windows Explorer, pasting copied image files, or pasting bitmap data from screenshot tools such as Snipaste.
2. Return from task detail to the view that opened it: the board for a card opened on the board, or the quadrant list for a card opened there.
3. Preselect the active quadrant when creating a task from a quadrant list.

## Image Insertion

The note editor will use one shared image-import pipeline for drag-and-drop and clipboard input. Accepted image `File` objects are read as binary data and sent through the existing `saveLongTaskImage` IPC API. The main process validates the image type and size, stores a managed copy under DeepStudy's local application data, and returns a `deepstudy-image://` identifier. Notes therefore remain valid if the original desktop file is moved or deleted.

The editor will accept PNG, JPEG, GIF, WebP, and BMP images up to the existing 16 MB limit. Unsupported files and failed imports will show the existing localized error feedback without altering the note.

Insertion respects the current caret:

- On an empty line, the image replaces that line.
- At the beginning or end of a non-empty line, the image is inserted before or after that line.
- In the middle of a line, the text is split and the image is inserted between the two text lines.
- Multiple pasted or dropped images are inserted in their source order.

The editor will suppress the browser's default file navigation behavior during drag-and-drop and show a lightweight drop-target state using the current quadrant color.

## Navigation

Task detail state will retain an explicit `returnMode` value. Opening a card from the board sets `returnMode` to `board`; opening it from a quadrant list sets it to `quadrant`. The detail back button returns directly to that recorded view.

If a task disappears or becomes unavailable while its detail is open, view resolution will use the same return target when possible. A quadrant return requires a valid quadrant; otherwise it falls back to the board.

## New Task Defaults

Both add buttons continue to use one defaults function. When the active view is a quadrant list, the form receives that quadrant. From the board, the existing global default remains `important-not-urgent`.

## Components

- `renderer/long-task-utils.js`: pure helpers for detail navigation state and image insertion placement.
- `renderer/long-tasks.js`: drag, paste, caret capture, managed image import, and view transitions.
- `renderer/long-tasks.css`: drag-over feedback.
- `renderer/i18n.js` and `renderer/tutorial.js`: localized feedback and updated user guidance where needed.
- Existing preload/main-process image IPC remains the storage boundary unless testing reveals a missing Electron clipboard capability.

## Testing

Automated tests will cover:

- Navigation returns to the board or quadrant list according to entry source.
- Missing tasks preserve the intended fallback behavior.
- New-task defaults use the active quadrant.
- Image placement for empty, leading, middle, trailing, and multiple-image insertion.
- Renderer markup includes drag-and-drop and clipboard image handling.
- Existing local image validation and storage tests remain green.

Manual Electron verification will cover dragging `C:\Users\DELL\Desktop\论文阅读步骤.png`, copying that file in Windows Explorer and pasting it, and pasting a Snipaste bitmap into the `test` task note. It will also verify both navigation entry paths and the quadrant form default at desktop and compact window sizes.

## Release

After all tests and packaged-app checks pass, bump the local version, build the Windows installer, push branch `本地版本`, publish a matching GitHub Release asset, and recreate desktop shortcuts so they target the installed or unpacked application executable rather than the installer.
