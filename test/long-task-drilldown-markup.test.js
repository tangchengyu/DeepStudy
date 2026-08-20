const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(renderer, "long-tasks.html"), "utf8");
const css = fs.readFileSync(path.join(renderer, "long-tasks.css"), "utf8");
const longTasksJs = fs.readFileSync(path.join(renderer, "long-tasks.js"), "utf8");
const appJs = fs.readFileSync(path.join(renderer, "app.js"), "utf8");
const i18nJs = fs.readFileSync(path.join(renderer, "i18n.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
const mainJs = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const tutorialJs = fs.readFileSync(path.join(renderer, "tutorial.js"), "utf8");

test("declares board, quadrant list, and task detail views", () => {
  for (const id of ["quadrant-board-view", "quadrant-list-view", "task-detail-view", "quadrant-view-list", "task-detail-notes"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.equal((html.match(/data-open-quadrant=/g) || []).length, 4);
});

test("keeps task notes safe and readable in the detail view", () => {
  assert.match(html, /id="task-detail-notes" class="task-detail-notes-editor"/);
  assert.doesNotMatch(html, /<textarea id="task-detail-notes"/);
  assert.doesNotMatch(html, /id="task-detail-markdown"/);
  assert.match(html, /支持 Markdown 格式渲染/);
  assert.match(css, /\.task-detail-notes-editor\s*\{[^}]*line-height:\s*1\.72/s);
  assert.match(css, /\.markdown-line\.editing\s*\{/);
  assert.match(longTasksJs, /markdownLineToHTML/);
  assert.match(longTasksJs, /startMarkdownLineEdit/);
});

test("stores pasted note images as local app files and hydrates them for display", () => {
  assert.match(html, /img-src 'self' data: blob:/);
  assert.match(preloadJs, /saveLongTaskImage/);
  assert.match(preloadJs, /readLongTaskImage/);
  assert.match(mainJs, /long-tasks:save-image/);
  assert.match(mainJs, /long-tasks:read-image/);
  assert.match(mainJs, /long-tasks:import-image-path/);
  assert.match(preloadJs, /importLongTaskImage/);
  assert.match(longTasksJs, /deepstudy-image:\/\//);
  assert.match(longTasksJs, /hydrateMarkdownImages/);
  assert.match(longTasksJs, /parseObsidianImagePath/);
  assert.match(longTasksJs, /importObsidianImageLine/);
  assert.doesNotMatch(longTasksJs, /readAsDataURL/);
});

test("abandons stale absolute-path image imports and discards their files", () => {
  const start = longTasksJs.indexOf("async function importObsidianImageLine");
  const end = longTasksJs.indexOf("\nasync function localImageUrl", start);
  const handler = longTasksJs.slice(start, end);
  assert.match(handler, /const taskId = viewState\.taskId/);
  assert.match(handler, /viewState\.mode !== "detail"/);
  assert.match(handler, /viewState\.taskId !== taskId/);
  assert.match(handler, /!line\.isConnected/);
  assert.match(handler, /line\.classList\.contains\("editing"\)/);
  assert.match(handler, /cleanupSavedImages\(\[saved\]\)/);
});

test("captures image insertion state before persistence awaits", () => {
  const start = longTasksJs.indexOf("async function insertImageFilesIntoNotes");
  const end = longTasksJs.indexOf("\nfunction currentDetailTask", start);
  const handler = longTasksJs.slice(start, end);
  const firstAwait = handler.indexOf("await ");
  assert.ok(firstAwait >= 0);
  for (const statement of ["const target =", "const text =", "const insertionOffset ="]) {
    assert.ok(handler.indexOf(statement) >= 0 && handler.indexOf(statement) < firstAwait, `${statement} must precede the first await`);
  }
});

test("freezes the editable image target before persistence begins", () => {
  const start = longTasksJs.indexOf("async function insertImageFilesIntoNotes");
  const end = longTasksJs.indexOf("\nfunction currentDetailTask", start);
  const handler = longTasksJs.slice(start, end);
  const freeze = handler.indexOf("finishMarkdownLineEdit(target)");
  const firstAwait = handler.indexOf("await ");
  assert.ok(freeze >= 0, "the target line must be synchronously frozen");
  assert.ok(freeze < firstAwait, "the target line must be frozen before persistence awaits");
});

test("discards every completed image save when a batch cannot be inserted", () => {
  assert.match(preloadJs, /discardLongTaskImage: \(id\) => ipcRenderer\.invoke\("long-tasks:discard-image", id\)/);
  assert.match(mainJs, /ipcMain\.handle\("long-tasks:discard-image"/);
  assert.match(mainJs, /function discardUnreferencedLongTaskImage\(id\)/);
  const discardStart = mainJs.indexOf("function discardUnreferencedLongTaskImage");
  const discardEnd = mainJs.indexOf("\nfunction noiseDir", discardStart);
  const discardHandler = mainJs.slice(discardStart, discardEnd);
  assert.match(discardHandler, /safeLongTaskImagePath\(id\)/);
  assert.match(discardHandler, /readLongTasks\(\)/);
  assert.match(discardHandler, /longTaskImageIds\(task\.notes\)/);
  assert.match(discardHandler, /if \(referenced\) return false/);
  assert.match(discardHandler, /fs\.rmSync\(target, \{ force: true \}\)/);

  const start = longTasksJs.indexOf("async function insertImageFilesIntoNotes");
  const end = longTasksJs.indexOf("\nfunction currentDetailTask", start);
  const handler = longTasksJs.slice(start, end);
  assert.match(handler, /Promise\.allSettled\(imageFiles\.map/);
  assert.match(handler, /result\.status === "fulfilled"/);
  const cleanup = handler.indexOf("await cleanupSavedImages(savedImages)");
  const failure = handler.indexOf("throw failedSave.reason");
  assert.ok(cleanup >= 0 && cleanup < failure, "successful saves must be discarded before the batch rejects");

  const cleanupStart = longTasksJs.indexOf("async function cleanupSavedImages");
  const cleanupEnd = longTasksJs.indexOf("\nasync function insertImageFilesIntoNotes", cleanupStart);
  const cleanupHandler = longTasksJs.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupHandler, /savedImages\.map/);
  assert.match(cleanupHandler, /api\.discardLongTaskImage\(saved\.id\)/);
  assert.match(cleanupHandler, /Promise\.allSettled/);
});

test("abandons delayed image inserts when the task or target line changes", () => {
  const start = longTasksJs.indexOf("async function insertImageFilesIntoNotes");
  const end = longTasksJs.indexOf("\nfunction currentDetailTask", start);
  const handler = longTasksJs.slice(start, end);
  assert.match(handler, /const taskId = viewState\.taskId/);
  assert.match(handler, /viewState\.mode !== "detail"/);
  assert.match(handler, /viewState\.taskId !== taskId/);
  assert.match(handler, /!target\.isConnected/);
  assert.match(handler, /target\.classList\.contains\("editing"\)/);
  assert.match(handler, /\(target\.dataset\.raw \|\| ""\) !== text/);
  const staleCheck = handler.indexOf('viewState.mode !== "detail"');
  const mutation = handler.indexOf("target.dataset.raw =");
  assert.ok(staleCheck >= 0 && staleCheck < mutation, "stale imports must stop before mutating the editor");
});

test("rejects oversized image files before reading their bytes", () => {
  const start = longTasksJs.indexOf("async function insertImageFilesIntoNotes");
  const end = longTasksJs.indexOf("\nfunction currentDetailTask", start);
  const handler = longTasksJs.slice(start, end);
  const sizeCheck = handler.indexOf("file.size > MAX_IMAGE_BYTES");
  const readBytes = handler.indexOf("file.arrayBuffer()");
  assert.ok(sizeCheck >= 0 && sizeCheck < readBytes, "file size must be checked before arrayBuffer");
});

test("imports supported clipboard and dropped image files into task notes", () => {
  assert.match(longTasksJs, /function imageFilesFromTransfer\(transfer\)/);
  assert.match(longTasksJs, /function isSupportedImageFile\(file\)/);
  assert.match(longTasksJs, /image\/png/);
  assert.match(longTasksJs, /image\/jpeg/);
  assert.match(longTasksJs, /image\/gif/);
  assert.match(longTasksJs, /image\/webp/);
  assert.match(longTasksJs, /image\/(?:bmp|x-ms-bmp)/);
  assert.match(longTasksJs, /png\|jpe\?g\|gif\|webp\|bmp/i);
  assert.match(longTasksJs, /transfer\?\.files/);
  assert.match(longTasksJs, /transfer\?\.items/);
  assert.match(longTasksJs, /item\.kind === "file"/);
  assert.match(longTasksJs, /async function insertImageFilesIntoNotes\(line, files, offset\)/);
  assert.match(longTasksJs, /api\.saveLongTaskImage/);
  assert.match(longTasksJs, /imageFilesFromTransfer\(event\.clipboardData\)/);
  assert.match(longTasksJs, /imageFilesFromTransfer\(event\.dataTransfer\)/);
  assert.match(longTasksJs, /insertImageFilesIntoNotes\(line, imageFiles, line \? caretOffset\(line\) : undefined\)/);
  assert.match(longTasksJs, /event\.preventDefault\(\);\s*\n\s*insertImageFilesIntoNotes\(line, imageFiles/s);
});

test("shows and clears a quadrant-colored image drop state", () => {
  assert.match(longTasksJs, /function noteLineAtPoint\(x, y\)/);
  assert.match(longTasksJs, /function setImageDropState\(active\)/);
  assert.match(longTasksJs, /"dragover"/);
  assert.match(longTasksJs, /"dragleave"/);
  assert.match(longTasksJs, /"drop"/);
  assert.match(longTasksJs, /setImageDropState\(false\)/);
  assert.match(css, /\.task-detail-notes-editor\.image-drop-active\s*\{/);
  assert.match(css, /var\(--detail-color, var\(--accent\)\)/);
});

test("uses an active note caret for drops and reports unsupported files", () => {
  assert.match(longTasksJs, /function filesFromTransfer\(transfer\)/);
  assert.match(longTasksJs, /const activeLine = \$\("#task-detail-notes \.markdown-line\.editing"\)/);
  assert.match(longTasksJs, /const line = activeLine \|\| noteLineAtPoint/);
  assert.match(longTasksJs, /imageFiles\.length !== transferFiles\.length/);
  assert.match(longTasksJs, /if \(!imageFiles\.length \|\| imageFiles\.length !== transferFiles\.length\) \{\s*alert\(tr\("imageImportFailed"\)\)/s);
});

test("documents all supported image intake workflows in both tutorial languages", () => {
  assert.match(tutorialJs, /Explorer/);
  assert.match(tutorialJs, /截图/);
  assert.match(tutorialJs, /drag.*Explorer|Explorer.*drag/i);
  assert.match(tutorialJs, /screenshot clipboard paste/i);
  assert.doesNotMatch(tutorialJs, /Obsidian-style absolute local image paths/i);
  assert.doesNotMatch(tutorialJs, /!\[\[C:\\本地路径\\图片\.png\]\]/);
});

test("moves markdown note editing between lines with keyboard arrows", () => {
  assert.match(longTasksJs, /function moveMarkdownLineByKeyboard\(line, direction\)/);
  assert.match(longTasksJs, /event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"/);
  assert.match(longTasksJs, /event\.key === "ArrowDown" \? 1 : -1/);
  assert.match(longTasksJs, /startMarkdownLineEdit\(target, caretOffset\(line\)\)/);
});

test("supports single-click positioning, drag selection, and Tab indentation for note lines", () => {
  assert.match(longTasksJs, /function caretOffsetFromPoint\(line, x, y\)/);
  assert.match(longTasksJs, /function beginMarkdownLineSelection\(line, event\)/);
  assert.match(longTasksJs, /function updateMarkdownLineSelection\(x, y\)/);
  assert.match(longTasksJs, /function endMarkdownLineSelection\(event\)/);
  assert.match(longTasksJs, /function indentSelectedMarkdownLines\(direction\)/);
  assert.match(longTasksJs, /function indentMarkdownLine\(line, direction\)/);
  assert.match(longTasksJs, /line\.addEventListener\("mousedown"/);
  assert.match(longTasksJs, /line\.addEventListener\("click"/);
  assert.match(longTasksJs, /line\.addEventListener\("dblclick"/);
  assert.match(longTasksJs, /document\.addEventListener\("mousemove"/);
  assert.match(longTasksJs, /document\.addEventListener\("mouseup"/);
  assert.match(longTasksJs, /event\.key === "Tab"/);
  assert.match(longTasksJs, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(css, /\.markdown-line\.selected\s*\{/);
  assert.match(longTasksJs, /--note-line-indent/);
  assert.match(css, /\.markdown-line\s*\{[^}]*var\(--note-line-indent/s);
});

test("starts cross-line note drag selection from the active editing line", () => {
  assert.doesNotMatch(longTasksJs, /event\.button !== 0 \|\| line\.classList\.contains\("editing"\)/);
  assert.doesNotMatch(longTasksJs, /line\.classList\.contains\("editing"\)\) event\.preventDefault\(\)/);
  assert.match(longTasksJs, /if \(line\.classList\.contains\("editing"\)\) return caretOffsetFromPoint\(line, x, y\)/);
});

test("renders partial note selections at text precision instead of whole-row highlight", () => {
  assert.match(longTasksJs, /function rawOffsetToDisplayOffset\(raw, rawOffset\)/);
  assert.match(longTasksJs, /function syncNativeMarkdownSelection\(\)/);
  assert.match(longTasksJs, /function isMarkdownLineFullySelected\(line, index, range\)/);
  assert.match(longTasksJs, /line\.classList\.toggle\("partial-selected", selected && !isMarkdownLineFullySelected\(line, index, range\)\)/);
  assert.match(longTasksJs, /window\.getSelection\(\)\.addRange\(domRange\)/);
  assert.match(longTasksJs, /finishAllMarkdownLineEdits\(\);\s*syncNativeMarkdownSelection\(\);/s);
  assert.match(css, /\.markdown-line\.selected\.partial-selected\s*\{/);
});

test("supports exact copy and cut for non-editing note selections", () => {
  assert.match(longTasksJs, /function selectedMarkdownText\(\)/);
  assert.match(longTasksJs, /function nativeMarkdownTextSelectionRange\(\)/);
  assert.match(longTasksJs, /addEventListener\("copy"/);
  assert.match(longTasksJs, /addEventListener\("cut"/);
  assert.match(longTasksJs, /document\.addEventListener\("copy"/);
  assert.match(longTasksJs, /document\.addEventListener\("cut"/);
  assert.match(longTasksJs, /selection\.toString\(\)/);
  assert.match(longTasksJs, /clipboardData\.setData\("text\/plain", text\)/);
  assert.match(longTasksJs, /replaceMarkdownSelectionWithText\(""\)/);
});

test("lets the browser create precise native selections inside rendered note paragraphs", () => {
  assert.doesNotMatch(longTasksJs, /if \(!line\.classList\.contains\("editing"\)\) event\.preventDefault\(\)/);
  assert.match(longTasksJs, /line\.addEventListener\("mousedown", \(event\) => \{\s*if \(event\.button !== 0\) return;\s*beginMarkdownLineSelection\(line, event\);/s);
  assert.match(css, /\.task-detail-notes-editor\s*\{[^}]*user-select:\s*text/s);
  assert.match(css, /\.markdown-line\s*\{[^}]*user-select:\s*text/s);
});

test("keeps a dragged note text selection highlighted after mouseup", () => {
  assert.match(longTasksJs, /line\.classList\.contains\("editing"\) \|\| markdownSelectionState\.dragging \|\| markdownTextSelectionRange\(\) \|\| selectedMarkdownLines\(\)\.length > 1/);
  assert.doesNotMatch(longTasksJs, /selected\[0\]\?\.focus\(\)/);
  assert.match(longTasksJs, /requestAnimationFrame\(syncNativeMarkdownSelection\)/);
});

test("Enter splitting commits only the text before the caret to the current note line", () => {
  assert.match(longTasksJs, /const \[before, after\] = LongTaskUtils\.splitNoteLineAtOffset\(text, offset\)/);
  assert.match(longTasksJs, /line\.textContent = before;\s*line\.dataset\.raw = before;\s*finishMarkdownLineEdit\(line\);/s);
});

test("Backspace at the start of a note line merges it into the previous editable block", () => {
  assert.match(longTasksJs, /function mergeMarkdownLineBackward\(line\)/);
  assert.match(longTasksJs, /LongTaskUtils\.mergeNoteLineBackward/);
  assert.match(longTasksJs, /event\.key === "Backspace" && caretOffset\(line\) === 0/);
  assert.match(longTasksJs, /setNoteLines\(result\.lines, result\.caret\)/);
});

test("completed long tasks stay in reflection when daily tasks resync", () => {
  assert.match(appJs, /let completedLongReflectionTasks = \[\]/);
  assert.match(appJs, /completedLongReflectionTasks = completedLongReflectionTasks\.filter\(\(item\) => item\.id !== sourceId\)/);
  assert.match(appJs, /const taskSource = \[\s*\.\.\.\(Array\.isArray\(tasks\) \? tasks : \[\]\),\s*\.\.\.completedLongReflectionTasks,\s*\]/s);
});

test("edits reminders directly from the long-task detail page", () => {
  for (const id of [
    "task-detail-reminder",
    "task-detail-reminder-summary",
    "task-detail-reminder-kind",
    "task-detail-reminder-once",
    "task-detail-reminder-time",
    "task-detail-reminder-weekdays",
    "task-detail-reminder-error",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(longTasksJs, /function readDetailReminder\(/);
  assert.match(longTasksJs, /function validateDetailReminder\(/);
  assert.match(longTasksJs, /function renderDetailReminderFields\(/);
  assert.match(longTasksJs, /Object\.assign\(task, \{ title, notes, reminder,/);
  assert.doesNotMatch(longTasksJs, /meta\.push\(`\$\{tr\("reminderPrefix"\)\}/);
  assert.match(i18nJs, /reminderSettings/);
  assert.match(i18nJs, /reminderPastTime/);
  assert.match(i18nJs, /reminderWeekdayRequired/);
  assert.match(css, /\.task-detail-reminder\s*\{/);
  assert.match(tutorialJs, /提醒方式和提醒时间/);
  assert.match(tutorialJs, /reminder type and time/i);
});

test("keeps the new long-task dialog focused on title and two quadrant choices", () => {
  assert.match(html, /class="quadrant-choice-grid"/);
  assert.match(html, /name="long-task-importance"/);
  assert.match(html, /name="long-task-urgency"/);
  assert.doesNotMatch(html, /<textarea id="long-task-notes"/);
  assert.doesNotMatch(html, /<select id="long-task-quadrant"/);
  assert.match(longTasksJs, /function selectedFormQuadrant\(\)/);
  assert.match(longTasksJs, /function setFormQuadrant\(quadrant/);
  assert.match(longTasksJs, /notes:\s*""/);
});

test("limits long-task drag affordance to the colored control area", () => {
  assert.match(longTasksJs, /long-task-drag-zone/);
  assert.match(longTasksJs, /card\.addEventListener\("click"/);
  assert.doesNotMatch(longTasksJs, /card\.draggable\s*=\s*true/);
  assert.match(css, /\.long-task-drag-zone:hover\s*\{[^}]*cursor:\s*grab/s);
  assert.match(css, /8px 16px 0 currentColor/);
  assert.match(css, /\.long-task-drag-zone\s*\{[^}]*grid-template-rows:\s*20px 24px/s);
  assert.match(css, /\.long-task-check input\s*\{[^}]*margin:\s*0/s);
  assert.match(css, /\.back-button\s*\{[^}]*--back-accent:/s);
  assert.match(css, /\.back-button::before\s*\{/);
  assert.match(css, /\.back-button::after\s*\{/);
});

test("does not show an undo button for daily task completion", () => {
  assert.doesNotMatch(appJs, /undo-complete-button/);
  assert.match(appJs, /Reflections\.syncCompletedTasks\(state\.tasks\)/);
});

test("uses the view source for task detail back navigation and new-task defaults", () => {
  assert.match(longTasksJs, /returnMode:\s*"quadrant"/);
  assert.match(longTasksJs, /LongTaskUtils\.detailReturnView\(viewState\)/);
  assert.match(longTasksJs, /LongTaskUtils\.newTaskDefaultsForView\(viewState\)/);
});
