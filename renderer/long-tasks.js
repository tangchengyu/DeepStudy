const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const api = window.electronAPI;
let tasks = [];
let chatHistory = [];
let pendingOperations = [];
const QUADRANT_META = {
  "important-urgent": { label: "重要且紧急", className: "q1" },
  "important-not-urgent": { label: "重要不紧急", className: "q2" },
  "urgent-not-important": { label: "不重要但紧急", className: "q3" },
  "not-important-not-urgent": { label: "不重要不紧急", className: "q4" },
};
let viewState = { mode: "board", quadrant: null, taskId: null };
let suppressTaskOpenUntil = 0;
let undoTimer = null;
let pendingUndoTask = null;
let detailSaveTimer = null;
let noteUndoStack = [];
const localImageUrls = new Map();

const undoButton = document.createElement("button");
undoButton.type = "button";
undoButton.className = "long-undo-button";
undoButton.hidden = true;
undoButton.textContent = "撤回完成";
document.body.append(undoButton);

function tr(key, replacements = {}) {
  let value = window.DeepStudyI18n?.t?.(key) || key;
  Object.entries(replacements).forEach(([name, replacement]) => {
    value = value.replaceAll(`{${name}}`, String(replacement));
  });
  return value;
}
function currentLocale() {
  return window.DeepStudyI18n?.language?.() || "zh-CN";
}
function quadrantLabel(quadrant) {
  const labels = {
    "important-urgent": "importantUrgent",
    "important-not-urgent": "importantNotUrgent",
    "urgent-not-important": "urgentNotImportant",
    "not-important-not-urgent": "notImportantNotUrgent",
  };
  return tr(labels[quadrant] || "") || QUADRANT_META[quadrant]?.label || "";
}

function openQuadrant(quadrant) {
  if (!LongTaskUtils.QUADRANTS.includes(quadrant)) return;
  viewState = { mode: "quadrant", quadrant, taskId: null };
  render();
}

function openTaskDetail(taskId) {
  if (Date.now() < suppressTaskOpenUntil) return;
  const task = tasks.find((item) => item.id === taskId && item.status === "active");
  if (!task) return;
  hideTaskMenu();
  viewState = { mode: "detail", quadrant: task.quadrant, taskId, returnMode: "quadrant" };
  render();
}

function navigateBack() {
  if (viewState.mode === "detail") viewState = LongTaskUtils.detailReturnView(viewState);
  else if (viewState.mode === "quadrant") viewState = { mode: "board", quadrant: null, taskId: null };
  else return;
  render();
}

function escapeHTML(value) { const div = document.createElement("div"); div.textContent = String(value || ""); return div.innerHTML; }
function renderInlineMarkdown(value) {
  return escapeHTML(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
function markdownToHTML(value) {
  const lines = String(value || "").split(/\r?\n/);
  const html = [];
  let listType = "";
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };
  const openList = (type) => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
      return;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      return;
    }
    const orderedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedItem) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(orderedItem[1])}</li>`);
      return;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  });
  closeList();
  return html.join("");
}
function markdownLineToHTML(value) {
  const raw = String(value || "");
  const trimmed = raw.trim();
  if (!trimmed) return "<br>";
  const obsidianImagePath = LongTaskUtils.parseObsidianImagePath(trimmed);
  if (obsidianImagePath) return `<span class="markdown-image-status">${escapeHTML(tr("imageImporting"))}</span>`;
  const image = trimmed.match(/^!\[([^\]]*)\]\((data:image\/[^)]+|deepstudy-image:\/\/[a-z0-9._-]+)\)$/i);
  if (image) {
    const alt = escapeHTML(image[1] || tr("pastedImageAlt"));
    const localId = image[2].match(/^deepstudy-image:\/\/([a-z0-9._-]+)$/i)?.[1];
    if (localId) return `<figure class="markdown-image"><img data-local-image="${escapeHTML(localId)}" alt="${alt}" /></figure>`;
    return `<figure class="markdown-image"><img src="${escapeHTML(image[2])}" alt="${alt}" /></figure>`;
  }
  const leading = raw.match(/^[\t ]+/)?.[0] || "";
  const body = raw.slice(leading.length);
  const heading = body.match(/^(#{1,3})\s+(.+)$/);
  if (heading) return `<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`;
  const listItem = body.match(/^[-*]\s+(.+)$/);
  if (listItem) return `<ul><li>${renderInlineMarkdown(listItem[1])}</li></ul>`;
  const orderedItem = body.match(/^(\d+)[.)]\s+(.+)$/);
  if (orderedItem) return `<ol start="${Number(orderedItem[1])}"><li>${renderInlineMarkdown(orderedItem[2])}</li></ol>`;
  return `<p>${renderInlineMarkdown(body) || "<br>"}</p>`;
}
function noteLineIndentColumns(raw) {
  return (String(raw || "").match(/^[\t ]+/)?.[0] || "").split("").reduce((total, char) => total + (char === "\t" ? 2 : 1), 0);
}
function renderMarkdownLine(line) {
  const raw = line.dataset.raw || "";
  line.contentEditable = "false";
  line.classList.remove("editing");
  line.style.setProperty("--note-line-indent", `${Math.floor(noteLineIndentColumns(raw) / 2) * 1.6}rem`);
  line.innerHTML = markdownLineToHTML(raw);
  line.style.whiteSpace = "";
  hydrateMarkdownImages(line);
  importObsidianImageLine(line);
}

const markdownSelectionState = {
  pointerDown: false,
  dragging: false,
  anchorLine: null,
  anchorIndex: -1,
  anchorOffset: 0,
  focusIndex: -1,
  focusOffset: 0,
  startX: 0,
  startY: 0,
};

function markdownLineElements() {
  return $$("#task-detail-notes .markdown-line");
}

function markdownLineIndex(line) {
  return markdownLineElements().indexOf(line);
}

function clearMarkdownLineSelection() {
  markdownLineElements().forEach((line) => line.classList.remove("selected", "partial-selected"));
  const selection = window.getSelection?.();
  if (selection && !document.activeElement?.closest?.("#task-detail-notes")) selection.removeAllRanges();
  markdownSelectionState.pointerDown = false;
  markdownSelectionState.dragging = false;
  markdownSelectionState.anchorLine = null;
  markdownSelectionState.anchorIndex = -1;
  markdownSelectionState.anchorOffset = 0;
  markdownSelectionState.focusIndex = -1;
  markdownSelectionState.focusOffset = 0;
}

function selectedMarkdownLines() {
  return markdownLineElements().filter((line) => line.classList.contains("selected"));
}

function markdownTextSelectionRange() {
  if (markdownSelectionState.anchorIndex < 0 || markdownSelectionState.focusIndex < 0) return null;
  const start = {
    line: markdownSelectionState.anchorIndex,
    offset: markdownSelectionState.anchorOffset,
  };
  const end = {
    line: markdownSelectionState.focusIndex,
    offset: markdownSelectionState.focusOffset,
  };
  if (start.line > end.line || (start.line === end.line && start.offset > end.offset)) {
    return { startLine: end.line, startOffset: end.offset, endLine: start.line, endOffset: start.offset };
  }
  return { startLine: start.line, startOffset: start.offset, endLine: end.line, endOffset: end.offset };
}

function markdownSelectedLineRange() {
  const textRange = markdownTextSelectionRange();
  if (textRange) return { start: textRange.startLine, end: textRange.endLine };
  const selected = selectedMarkdownLines();
  if (!selected.length) return null;
  const indices = selected.map(markdownLineIndex).filter((index) => index >= 0);
  if (!indices.length) return null;
  return { start: Math.min(...indices), end: Math.max(...indices) };
}

function finishAllMarkdownLineEdits() {
  $$(".markdown-line.editing").forEach(finishMarkdownLineEdit);
}

function pushNoteUndoSnapshot() {
  const snapshot = notesEditorValue();
  if (noteUndoStack[noteUndoStack.length - 1] === snapshot) return;
  noteUndoStack.push(snapshot);
  if (noteUndoStack.length > 80) noteUndoStack.shift();
}

function restoreNoteSnapshot() {
  const snapshot = noteUndoStack.pop();
  if (snapshot === undefined) return false;
  const lines = String(snapshot || "").split(/\r?\n/);
  setNoteLines(lines, { line: Math.max(0, lines.length - 1), offset: lines.at(-1)?.length || 0 });
  saveDetailEdits();
  return true;
}

function setNoteLines(lines, caret) {
  const editor = $("#task-detail-notes");
  clearMarkdownLineSelection();
  editor.replaceChildren(...(Array.isArray(lines) && lines.length ? lines : [""]).map(createMarkdownLine));
  hydrateMarkdownImages(editor);
  const target = markdownLineElements()[Math.max(0, Math.min(markdownLineElements().length - 1, Number(caret?.line) || 0))];
  if (target) startMarkdownLineEdit(target, Number(caret?.offset) || 0);
}

function replaceMarkdownSelectionWithText(text) {
  const range = markdownTextSelectionRange();
  if (!range) return false;
  finishAllMarkdownLineEdits();
  pushNoteUndoSnapshot();
  const result = LongTaskUtils.replaceNoteSelection(markdownLineElements().map((line) => line.dataset.raw || ""), range, text);
  setNoteLines(result.lines, result.caret);
  saveDetailEdits();
  return true;
}

function selectedMarkdownText() {
  const range = markdownTextSelectionRange();
  if (!range) return "";
  return LongTaskUtils.selectedNoteText(markdownLineElements().map((line) => (
    line.classList.contains("editing") ? line.textContent.replace(/\u00a0/g, " ") : line.dataset.raw || ""
  )), range);
}

function handleMarkdownClipboardSelection(event, cut = false) {
  const text = selectedMarkdownText();
  if (!text) return false;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  if (cut) replaceMarkdownSelectionWithText("");
  return true;
}

function mergeMarkdownLineBackward(line) {
  const index = markdownLineIndex(line);
  if (index <= 0) return false;
  const lines = markdownLineElements().map((item) => (
    item.classList.contains("editing") ? item.textContent.replace(/\u00a0/g, " ") : item.dataset.raw || ""
  ));
  pushNoteUndoSnapshot();
  const result = LongTaskUtils.mergeNoteLineBackward(lines, index);
  setNoteLines(result.lines, result.caret);
  saveDetailEdits();
  return true;
}

function selectMarkdownLineRange(startIndex, endIndex, focusOffset = 0) {
  const lines = markdownLineElements();
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  markdownSelectionState.anchorIndex = startIndex;
  markdownSelectionState.focusIndex = endIndex;
  markdownSelectionState.focusOffset = focusOffset;
  const range = markdownTextSelectionRange();
  lines.forEach((line, index) => {
    const selected = index >= start && index <= end;
    line.classList.toggle("selected", selected);
    line.classList.toggle("partial-selected", selected && !isMarkdownLineFullySelected(line, index, range));
  });
  syncNativeMarkdownSelection();
}

function caretOffsetFromPoint(line, x, y) {
  const doc = line.ownerDocument;
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    if (position?.offsetNode && line.contains(position.offsetNode)) {
      const range = document.createRange();
      range.selectNodeContents(line);
      range.setEnd(position.offsetNode, position.offset);
      return range.toString().length;
    }
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      const copy = range.cloneRange();
      copy.selectNodeContents(line);
      copy.setEnd(range.startContainer, range.startOffset);
      return copy.toString().length;
    }
  }
  return line.textContent.length;
}

function displayOffsetToRawOffset(raw, displayOffset) {
  const source = String(raw || "");
  const offset = Math.max(0, Number(displayOffset) || 0);
  const leading = source.match(/^[\t ]+/)?.[0] || "";
  const body = source.slice(leading.length);
  const heading = body.match(/^(#{1,3})\s+/);
  if (heading) return Math.min(source.length, leading.length + heading[0].length + offset);
  const unordered = body.match(/^[-*]\s+/);
  if (unordered) return Math.min(source.length, leading.length + unordered[0].length + offset);
  const ordered = body.match(/^\d+[.)]\s+/);
  if (ordered) return Math.min(source.length, leading.length + ordered[0].length + offset);
  return Math.min(source.length, leading.length + offset);
}

function rawOffsetToDisplayOffset(raw, rawOffset) {
  const source = String(raw || "");
  const offset = Math.min(source.length, Math.max(0, Number(rawOffset) || 0));
  const leading = source.match(/^[\t ]+/)?.[0] || "";
  const body = source.slice(leading.length);
  const heading = body.match(/^(#{1,3})\s+/);
  const unordered = body.match(/^[-*]\s+/);
  const ordered = body.match(/^\d+[.)]\s+/);
  const hiddenLength = leading.length + (heading?.[0].length || unordered?.[0].length || ordered?.[0].length || 0);
  return Math.max(0, Math.min(source.length - hiddenLength, offset - hiddenLength));
}

function rawCaretOffsetFromPoint(line, x, y) {
  if (line.classList.contains("editing")) return caretOffsetFromPoint(line, x, y);
  return displayOffsetToRawOffset(line.dataset.raw || "", caretOffsetFromPoint(line, x, y));
}

function textPositionAtOffset(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, Number(offset) || 0);
  let node = walker.nextNode();
  let lastText = null;
  while (node) {
    lastText = node;
    if (remaining <= node.textContent.length) return { node, offset: remaining };
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  if (lastText) return { node: lastText, offset: lastText.textContent.length };
  return { node: root, offset: root.childNodes.length };
}

function displaySelectionOffset(line, rawOffset) {
  if (line.classList.contains("editing")) return Math.min(line.textContent.length, Math.max(0, Number(rawOffset) || 0));
  return rawOffsetToDisplayOffset(line.dataset.raw || "", rawOffset);
}

function syncNativeMarkdownSelection() {
  const range = markdownTextSelectionRange();
  const lines = markdownLineElements();
  const startLine = lines[range?.startLine];
  const endLine = lines[range?.endLine];
  if (!range || !startLine || !endLine) return false;
  const selection = window.getSelection();
  const domRange = document.createRange();
  const start = textPositionAtOffset(startLine, displaySelectionOffset(startLine, range.startOffset));
  const end = textPositionAtOffset(endLine, displaySelectionOffset(endLine, range.endOffset));
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  if (!domRange.collapsed) window.getSelection().addRange(domRange);
  return !domRange.collapsed;
}

function isMarkdownLineFullySelected(line, index, range) {
  if (!range || index < range.startLine || index > range.endLine) return false;
  const raw = line.classList.contains("editing") ? line.textContent : line.dataset.raw || "";
  if (range.startLine === range.endLine) return range.startOffset <= 0 && range.endOffset >= raw.length;
  if (index === range.startLine) return range.startOffset <= 0;
  if (index === range.endLine) return range.endOffset >= raw.length;
  return true;
}

function beginMarkdownLineSelection(line, event) {
  markdownSelectionState.pointerDown = true;
  markdownSelectionState.dragging = false;
  markdownSelectionState.anchorLine = line;
  markdownSelectionState.anchorIndex = markdownLineIndex(line);
  markdownSelectionState.anchorOffset = rawCaretOffsetFromPoint(line, event.clientX, event.clientY);
  markdownSelectionState.focusIndex = markdownSelectionState.anchorIndex;
  markdownSelectionState.focusOffset = markdownSelectionState.anchorOffset;
  markdownSelectionState.startX = event.clientX;
  markdownSelectionState.startY = event.clientY;
}

function updateMarkdownLineSelection(x, y) {
  if (!markdownSelectionState.pointerDown || !markdownSelectionState.anchorLine) return;
  const target = noteLineAtPoint(x, y);
  if (!target) return;
  const targetIndex = markdownLineIndex(target);
  const targetOffset = rawCaretOffsetFromPoint(target, x, y);
  const moved = Math.abs(x - markdownSelectionState.startX) > 4
    || Math.abs(y - markdownSelectionState.startY) > 4
    || targetIndex !== markdownSelectionState.anchorIndex;
  if (!moved) return;
  markdownSelectionState.dragging = true;
  selectMarkdownLineRange(markdownSelectionState.anchorIndex, targetIndex, targetOffset);
}

function endMarkdownLineSelection(event) {
  if (!markdownSelectionState.pointerDown) return;
  const anchorLine = markdownSelectionState.anchorLine;
  const dragging = markdownSelectionState.dragging;
  markdownSelectionState.pointerDown = false;
  markdownSelectionState.anchorLine = null;
  if (dragging) {
    const selected = selectedMarkdownLines();
    const range = markdownTextSelectionRange();
    markdownSelectionState.dragging = false;
    if (selected.length && range && (range.startLine !== range.endLine || range.startOffset !== range.endOffset)) {
      finishAllMarkdownLineEdits();
      syncNativeMarkdownSelection();
      selected[0]?.focus();
      requestAnimationFrame(syncNativeMarkdownSelection);
    }
    else clearMarkdownLineSelection();
    return;
  }
  clearMarkdownLineSelection();
  if (!anchorLine || anchorLine.classList.contains("editing")) return;
  startMarkdownLineEdit(anchorLine, rawCaretOffsetFromPoint(anchorLine, event.clientX, event.clientY));
}

function importObsidianImage(sourcePath) {
  return api.importLongTaskImage(sourcePath);
}

async function importObsidianImageLine(line) {
  const editor = $("#task-detail-notes");
  const taskId = viewState.taskId;
  const raw = line?.dataset.raw || "";
  const sourcePath = LongTaskUtils.parseObsidianImagePath(raw);
  if (!sourcePath || line.dataset.importingImage === sourcePath) return;
  line.dataset.importingImage = sourcePath;
  try {
    const saved = await importObsidianImage(sourcePath);
    if (!saved?.id) return;
    if (
      viewState.mode !== "detail"
      || viewState.taskId !== taskId
      || !line.isConnected
      || line.closest("#task-detail-notes") !== editor
      || line.classList.contains("editing")
      || line.dataset.raw !== raw
    ) {
      await cleanupSavedImages([saved]);
      return;
    }
    line.dataset.raw = `![${tr("pastedImageAlt")}](deepstudy-image://${saved.id})`;
    delete line.dataset.importingImage;
    renderMarkdownLine(line);
    saveDetailEdits();
  } catch {
    if (line.dataset.raw !== raw) return;
    line.innerHTML = `<span class="markdown-image-status markdown-image-error">${escapeHTML(tr("imageImportFailed"))}</span>`;
  }
}

async function localImageUrl(id) {
  if (localImageUrls.has(id)) return localImageUrls.get(id);
  const item = await api.readLongTaskImage(id);
  if (!item?.buffer) throw new Error(tr("imageReadFailed"));
  const url = URL.createObjectURL(new Blob([item.buffer], { type: item.type || "image/png" }));
  localImageUrls.set(id, url);
  return url;
}

function hydrateMarkdownImages(scope = document) {
  scope.querySelectorAll?.("img[data-local-image]").forEach((image) => {
    if (image.dataset.loading === "true" || image.src) return;
    image.dataset.loading = "true";
    localImageUrl(image.dataset.localImage)
      .then((url) => { image.src = url; })
      .catch((error) => {
        image.classList.add("load-error");
        image.alt = error.message;
      })
      .finally(() => { delete image.dataset.loading; });
  });
}
function createMarkdownLine(raw = "") {
  const line = document.createElement("div");
  line.className = "markdown-line";
  line.dataset.raw = raw;
  line.tabIndex = 0;
  line.setAttribute("role", "textbox");
  line.setAttribute("aria-multiline", "false");

  line.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (!line.classList.contains("editing")) event.preventDefault();
    beginMarkdownLineSelection(line, event);
  });
  line.addEventListener("click", (event) => {
    if (line.classList.contains("editing") || markdownSelectionState.dragging || selectedMarkdownLines().length > 1) return;
    startMarkdownLineEdit(line, rawCaretOffsetFromPoint(line, event.clientX, event.clientY));
  });
  line.addEventListener("dblclick", (event) => {
    event.preventDefault();
    startMarkdownLineEdit(line, line.textContent.length);
  });
  line.addEventListener("keydown", (event) => {
    if (line.classList.contains("editing")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Tab" && selectedMarkdownLines().length > 0) {
      event.preventDefault();
      indentSelectedMarkdownLines(event.shiftKey ? -1 : 1);
      return;
    }
    if (markdownTextSelectionRange()) return;
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
      startMarkdownLineEdit(line);
    }
  });
  line.addEventListener("blur", () => {
    finishMarkdownLineEdit(line);
    saveDetailEdits();
  });

  renderMarkdownLine(line);
  return line;
}
function placeCaretAt(element, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.textContent.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
function caretOffset(element) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return element.textContent.length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}
function startMarkdownLineEdit(line, pendingCaret) {
  if (line.classList.contains("editing")) return;
  $$(".markdown-line.editing").forEach((item) => {
    if (item !== line) finishMarkdownLineEdit(item);
  });
  clearMarkdownLineSelection();
  line.classList.add("editing");
  line.contentEditable = "true";
  line.spellcheck = false;
  line.style.setProperty("--note-line-indent", "0rem");
  line.textContent = line.dataset.raw || "";
  line.focus();
  requestAnimationFrame(() => placeCaretAt(line, Number.isFinite(Number(pendingCaret)) ? Number(pendingCaret) : line.textContent.length));
}
function finishMarkdownLineEdit(line) {
  if (!line?.classList.contains("editing")) return;
  line.dataset.raw = line.textContent.replace(/\u00a0/g, " ");
  renderMarkdownLine(line);
}
function moveMarkdownLineByKeyboard(line, direction) {
  const target = direction > 0 ? line.nextElementSibling : line.previousElementSibling;
  if (!target?.classList.contains("markdown-line")) return false;
  target.focus();
  startMarkdownLineEdit(target, caretOffset(line));
  return true;
}

function indentMarkdownLine(line, direction) {
  const raw = String(line.dataset.raw || line.textContent || "");
  const next = direction > 0
    ? `  ${raw}`
    : raw.replace(/^(?: {1,2}|\t)/, "");
  if (next === raw) return false;
  line.dataset.raw = next;
  if (line.classList.contains("editing")) {
    line.textContent = next;
    requestAnimationFrame(() => placeCaretAt(line, line.textContent.length));
  }
  else {
    renderMarkdownLine(line);
  }
  return true;
}

function indentSelectedMarkdownLines(direction) {
  const range = markdownSelectedLineRange();
  if (!range) return false;
  finishAllMarkdownLineEdits();
  pushNoteUndoSnapshot();
  const lines = LongTaskUtils.indentNoteLines(
    markdownLineElements().map((line) => line.dataset.raw || ""),
    range.start,
    range.end,
    direction,
  );
  setNoteLines(lines, { line: range.start, offset: 0 });
  saveDetailEdits();
  return true;
}

function renderNotesEditor(notes, resetUndo = true) {
  const editor = $("#task-detail-notes");
  const lines = String(notes || "").split(/\r?\n/);
  clearMarkdownLineSelection();
  if (resetUndo) noteUndoStack = [];
  editor.replaceChildren(...(lines.length ? lines : [""]).map(createMarkdownLine));
  hydrateMarkdownImages(editor);
}
function notesEditorValue() {
  return markdownLineElements().map((line) => (
    line.classList.contains("editing") ? line.textContent : line.dataset.raw || ""
  )).join("\n");
}
function splitMarkdownLine(line) {
  const text = line.textContent.replace(/\u00a0/g, " ");
  const offset = caretOffset(line);
  pushNoteUndoSnapshot();
  const [before, after] = LongTaskUtils.splitNoteLineAtOffset(text, offset);
  line.textContent = before;
  line.dataset.raw = before;
  finishMarkdownLineEdit(line);
  const next = createMarkdownLine(after);
  line.after(next);
  startMarkdownLineEdit(next, 0);
  saveDetailEdits();
}
function insertPlainTextAtCaret(text) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
function pasteIntoMarkdownLine(line, text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.includes("\n")) {
    insertPlainTextAtCaret(normalized);
    line.dataset.raw = line.textContent.replace(/\u00a0/g, " ");
    saveDetailEdits();
    return;
  }
  const parts = normalized.split("\n");
  const current = line.textContent.replace(/\u00a0/g, " ");
  const offset = caretOffset(line);
  line.dataset.raw = `${current.slice(0, offset)}${parts.shift()}`;
  const tail = `${parts.pop() || ""}${current.slice(offset)}`;
  finishMarkdownLineEdit(line);
  let anchor = line;
  parts.forEach((part) => {
    const next = createMarkdownLine(part);
    anchor.after(next);
    anchor = next;
  });
  const tailLine = createMarkdownLine(tail);
  anchor.after(tailLine);
  tailLine.focus();
  requestAnimationFrame(() => placeCaretAt(tailLine, 0));
  saveDetailEdits();
}
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/x-ms-bmp"]);
const IMAGE_FILE_NAME = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
function isSupportedImageFile(file) {
  return Boolean(file) && (IMAGE_MIME_TYPES.has(String(file.type || "").toLowerCase()) || IMAGE_FILE_NAME.test(String(file.name || "")));
}
function imageFilesFromTransfer(transfer) {
  return filesFromTransfer(transfer).filter(isSupportedImageFile);
}
function filesFromTransfer(transfer) {
  const files = Array.from(transfer?.files || []);
  if (files.length) return files;
  return Array.from(transfer?.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}
function transferHasFiles(transfer) {
  return Array.from(transfer?.files || []).length > 0
    || Array.from(transfer?.items || []).some((item) => item.kind === "file")
    || Array.from(transfer?.types || []).includes("Files");
}
function lastNoteLine() {
  return $("#task-detail-notes .markdown-line:last-child") || createMarkdownLine("");
}
async function cleanupSavedImages(savedImages) {
  const results = await Promise.allSettled(savedImages.map((saved) => api.discardLongTaskImage(saved.id)));
  results.forEach((result) => {
    if (result.status === "rejected") console.warn("Failed to discard an incomplete image import:", result.reason);
  });
}
async function insertImageFilesIntoNotes(line, files, offset) {
  const editor = $("#task-detail-notes");
  const taskId = viewState.taskId;
  const target = line || $("#task-detail-notes .markdown-line:last-child") || createMarkdownLine("");
  const text = target.classList.contains("editing") ? target.textContent : target.dataset.raw || "";
  const insertionOffset = Math.min(text.length, Math.max(0, Number(offset ?? text.length) || 0));
  const imageFiles = Array.from(files || []).filter(isSupportedImageFile);
  if (!imageFiles.length) return;
  if (imageFiles.some((file) => file.size > MAX_IMAGE_BYTES)) throw new Error(tr("imageImportFailed"));
  finishMarkdownLineEdit(target);
  const saveResults = await Promise.allSettled(imageFiles.map(async (file) => {
    const saved = await api.saveLongTaskImage({
      buffer: await file.arrayBuffer(),
      type: file.type,
      name: file.name,
    });
    if (!saved?.id) throw new Error(tr("imageSaveFailed"));
    return saved;
  }));
  const savedImages = saveResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failedSave = saveResults.find((result) => result.status === "rejected");
  if (failedSave) {
    await cleanupSavedImages(savedImages);
    throw failedSave.reason;
  }
  if (
    viewState.mode !== "detail"
    || viewState.taskId !== taskId
    || !target.isConnected
    || target.closest("#task-detail-notes") !== editor
    || target.classList.contains("editing")
    || (target.dataset.raw || "") !== text
  ) {
    await cleanupSavedImages(savedImages);
    return false;
  }
  const imageLines = savedImages.map((saved) => `![${tr("pastedImageAlt")}](deepstudy-image://${saved.id})`);
  if (!target.parentElement) $("#task-detail-notes").append(target);
  const insertedLines = LongTaskUtils.imageInsertionLines(text, insertionOffset, imageLines);
  target.dataset.raw = insertedLines.shift() || "";
  renderMarkdownLine(target);
  let anchor = target;
  insertedLines.forEach((insertedLine) => {
    const next = createMarkdownLine(insertedLine);
    anchor.after(next);
    anchor = next;
  });
  saveDetailEdits();
}
function noteLineAtPoint(x, y) {
  const line = document.elementFromPoint(x, y)?.closest(".markdown-line");
  return line?.closest("#task-detail-notes") ? line : null;
}
function setImageDropState(active) {
  $("#task-detail-notes").classList.toggle("image-drop-active", Boolean(active));
}
function currentDetailTask() {
  return tasks.find((item) => item.id === viewState.taskId && item.status === "active");
}
function isDetailEditorFocused() {
  return [$("#task-detail-title"), $("#task-detail-notes")].includes(document.activeElement)
    || Boolean(document.activeElement.closest?.("#task-detail-notes, #task-detail-reminder"));
}
function showLongUndo(task) {
  pendingUndoTask = { ...task, status: "active", completedAt: null };
  undoButton.hidden = false;
  undoButton.textContent = `${currentLocale() === "en-US" ? "Undo completion" : "撤回完成"}：${task.title}`;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoButton.hidden = true;
    pendingUndoTask = null;
  }, 10000);
}
undoButton.addEventListener("click", async () => {
  if (!pendingUndoTask) return;
  const task = pendingUndoTask;
  undoButton.hidden = true;
  pendingUndoTask = null;
  clearTimeout(undoTimer);
  try {
    if (typeof api.undoLongTaskCompletion === "function") await api.undoLongTaskCompletion(task);
    else await api.saveLongTask(task);
  } catch (error) {
    alert(error.message);
  }
});
function reminderLabel(reminder) {
  if (!reminder?.enabled || reminder.kind === "none") return "";
  if (reminder.kind === "once") return `${tr("reminderOnce")} · ${new Intl.DateTimeFormat(currentLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(reminder.at))}`;
  if (reminder.kind === "daily") return `${tr("reminderDaily")} · ${reminder.time}`;
  const weekdayFormatter = new Intl.DateTimeFormat(currentLocale(), { weekday: "short", timeZone: "UTC" });
  const weekdays = reminder.weekdays.map((day) => weekdayFormatter.format(new Date(Date.UTC(2026, 7, 2 + day)))).join(currentLocale() === "en-US" ? ", " : "、");
  return `${tr("reminderWeekly")} ${weekdays} · ${reminder.time}`;
}
function taskCard(task) {
  const card = document.createElement("article");
  card.className = `long-task-card ${QUADRANT_META[task.quadrant]?.className || ""}`; card.tabIndex = 0; card.dataset.id = task.id;
  card.innerHTML = `<div class="long-task-drag-zone" draggable="true" title="${tr("dragLongTask")}" aria-label="${tr("dragLongTask")}"><label class="long-task-check" title="${tr("markDone")}"><input type="checkbox" aria-label="${tr("markDone")}"></label><span class="long-task-drag-grip" aria-hidden="true"></span></div><div class="long-card-main"><header><button class="long-task-title-button" type="button" tabindex="-1">${escapeHTML(task.title)}</button>${task.notes ? `<span class="task-note-indicator" title="${tr("containsNotes")}" aria-label="${tr("containsNotes")}">▤</span>` : ""}</header>${task.notes ? `<p>${escapeHTML(task.notes)}</p>` : ""}${reminderLabel(task.reminder) ? `<span class="task-reminder">${escapeHTML(reminderLabel(task.reminder))}</span>` : ""}</div>`;
  card.addEventListener("click", (event) => {
    if (event.target.closest(".long-task-check") || event.target.closest(".long-task-drag-zone")) return;
    openTaskDetail(task.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(".long-task-check") || event.target.closest(".long-task-drag-zone")) return;
    event.preventDefault();
    openTaskDetail(task.id);
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showTaskMenu(task, event.clientX, event.clientY);
  });
  const check = card.querySelector(".long-task-check input");
  check.addEventListener("pointerdown", (event) => event.stopPropagation());
  check.addEventListener("click", async (event) => {
    event.stopPropagation();
    check.disabled = true;
    try {
      await api.completeLongTask(task.id);
      showLongUndo(task);
    } catch (error) {
      check.checked = false;
      check.disabled = false;
      alert(error.message);
    }
  });
  const dragZone = card.querySelector(".long-task-drag-zone");
  dragZone.addEventListener("dragstart", (event) => {
    hideTaskMenu();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setData("application/x-deepstudy-long-task", JSON.stringify({ id: task.id, title: task.title }));
    api.setLongTaskDragPayload?.({ id: task.id, title: task.title }).catch(() => {});
    card.classList.add("dragging");
  });
  dragZone.addEventListener("dragend", () => {
    suppressTaskOpenUntil = Date.now() + 180;
    card.classList.remove("dragging");
    clearDragPlaceholder();
  });
  return card;
}
const dragPlaceholder = document.createElement("div");
dragPlaceholder.className = "long-task-card-placeholder";
function placeholderTargetId(list) {
  if (dragPlaceholder.parentElement !== list) return "";
  return dragPlaceholder.nextElementSibling?.dataset.id || "";
}
function clearDragPlaceholder() {
  dragPlaceholder.remove();
  $$(".quadrant-list").forEach((list) => list.classList.remove("drag-over"));
}
const taskMenu = document.createElement("div");
taskMenu.className = "long-task-menu";
taskMenu.hidden = true;
document.body.append(taskMenu);
function hideTaskMenu() {
  taskMenu.hidden = true;
}
function showTaskMenu(task, x, y) {
  taskMenu.replaceChildren();
  [
    ["copy-today", tr("copyToToday")],
    ["delete", tr("delete")],
  ].forEach(([action, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    if (action === "delete") button.className = "danger";
    taskMenu.append(button);
  });
  taskMenu.dataset.id = task.id;
  taskMenu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  taskMenu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  taskMenu.hidden = false;
}
async function copyTaskToToday(task) {
  await api.addTaskToDailyPlan({ title: task.title });
}
function updateDragPlaceholder(list, event) {
  const cards = [...list.querySelectorAll(".long-task-card:not(.dragging)")];
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      index = i;
      break;
    }
  }
  if (index < cards.length) list.insertBefore(dragPlaceholder, cards[index]);
  else list.append(dragPlaceholder);
}
function setVisibleView(mode) {
  $("#quadrant-board-view").hidden = mode !== "board";
  $("#quadrant-list-view").hidden = mode !== "quadrant";
  $("#task-detail-view").hidden = mode !== "detail";
  document.body.classList.toggle("detail-q1", mode === "detail" && viewState.quadrant === "important-urgent");
  document.body.classList.toggle("detail-q2", mode === "detail" && viewState.quadrant === "important-not-urgent");
  document.body.classList.toggle("detail-q3", mode === "detail" && viewState.quadrant === "urgent-not-important");
  document.body.classList.toggle("detail-q4", mode === "detail" && viewState.quadrant === "not-important-not-urgent");
  $("#quadrant-list-view").className = `long-task-view drilldown-view ${QUADRANT_META[viewState.quadrant]?.className || ""}`;
}

function renderBoard() {
  LongTaskUtils.QUADRANTS.forEach((quadrant) => {
    const quadrantTasks = LongTaskUtils.activeTasksForQuadrant(tasks, quadrant);
    const list = $(`[data-list="${quadrant}"]`);
    list.replaceChildren(...quadrantTasks.map(taskCard));
    $(`[data-quadrant-count="${quadrant}"]`).textContent = String(quadrantTasks.length);
  });
}

function renderQuadrantList() {
  const quadrantTasks = LongTaskUtils.activeTasksForQuadrant(tasks, viewState.quadrant);
  $("#quadrant-view-title").textContent = quadrantLabel(viewState.quadrant);
  $("#quadrant-view-count").textContent = String(quadrantTasks.length);
  $("#quadrant-view-list").replaceChildren(...quadrantTasks.map(taskCard));
}

function detailReminderSummary(reminder) {
  return reminderLabel(reminder) || tr("noReminder");
}

function populateDetailReminder(reminder = {}) {
  const value = reminder || {};
  $("#task-detail-reminder-kind").value = value.kind || "none";
  $("#task-detail-reminder-at").value = value.at
    ? new Date(new Date(value.at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";
  $("#task-detail-reminder-clock").value = value.time || "09:00";
  $$("#task-detail-reminder-weekdays input").forEach((input) => {
    input.checked = (value.weekdays || []).includes(Number(input.value));
  });
  $("#task-detail-reminder-error").textContent = "";
  renderDetailReminderFields();
}

function readDetailReminder() {
  const kind = $("#task-detail-reminder-kind").value;
  return {
    kind,
    at: $("#task-detail-reminder-at").value ? new Date($("#task-detail-reminder-at").value).toISOString() : null,
    time: $("#task-detail-reminder-clock").value || "09:00",
    weekdays: $$("#task-detail-reminder-weekdays input:checked").map((input) => Number(input.value)),
    enabled: kind !== "none",
    lastTriggeredAt: null,
  };
}

function validateDetailReminder(reminder, task = currentDetailTask()) {
  if (reminder.kind === "once") {
    const at = Date.parse(reminder.at);
    const unchanged = reminder.at && reminder.at === task?.reminder?.at;
    if (!Number.isFinite(at) || (at <= Date.now() && !unchanged)) return tr("reminderPastTime");
  }
  if (reminder.kind === "weekly" && !reminder.weekdays.length) return tr("reminderWeekdayRequired");
  return "";
}

function renderDetailReminderFields() {
  const kind = $("#task-detail-reminder-kind").value;
  $("#task-detail-reminder-once").hidden = kind !== "once";
  $("#task-detail-reminder-time").hidden = !["daily", "weekly"].includes(kind);
  $("#task-detail-reminder-weekdays").hidden = kind !== "weekly";
  $("#task-detail-reminder-summary").textContent = detailReminderSummary(readDetailReminder());
}

function renderTaskDetail(task) {
  $("#task-detail-quadrant").textContent = quadrantLabel(task.quadrant);
  $("#task-detail-title").value = task.title;
  renderNotesEditor(task.notes || "");
  const meta = [];
  if (task.createdAt) meta.push(`${currentLocale() === "en-US" ? "Created" : "创建于"} ${new Intl.DateTimeFormat(currentLocale(), { year: "numeric", month: "long", day: "numeric" }).format(new Date(task.createdAt))}`);
  $("#task-detail-meta").replaceChildren(...meta.map((text) => Object.assign(document.createElement("span"), { textContent: text })));
  populateDetailReminder(task.reminder);
  $("#task-detail-check").checked = false;
  $("#task-detail-check").disabled = false;
  $("#task-detail-save-status").textContent = "";
}

function saveDetailEdits() {
  const task = currentDetailTask();
  if (!task) return;
  const title = $("#task-detail-title").value.trim();
  const notes = notesEditorValue();
  const reminder = readDetailReminder();
  if (!title) {
    $("#task-detail-save-status").textContent = tr("taskNameRequired");
    return;
  }
  const reminderError = validateDetailReminder(reminder, task);
  $("#task-detail-reminder-error").textContent = reminderError;
  if (reminderError) return;
  Object.assign(task, { title, notes, reminder, updatedAt: Date.now() });
  $("#task-detail-reminder-summary").textContent = detailReminderSummary(reminder);
  $("#task-detail-save-status").textContent = tr("autoSaving");
  clearTimeout(detailSaveTimer);
  detailSaveTimer = setTimeout(async () => {
    try {
      await api.saveLongTask(task);
      $("#task-detail-save-status").textContent = tr("autoSaved");
    } catch (error) {
      $("#task-detail-save-status").textContent = error.message;
    }
  }, 500);
}

function render() {
  const resolved = LongTaskUtils.resolveLongTaskView(viewState, tasks);
  viewState = resolved.mode === "detail"
    ? { mode: resolved.mode, quadrant: resolved.quadrant, taskId: resolved.taskId, returnMode: resolved.returnMode }
    : { mode: resolved.mode, quadrant: resolved.quadrant, taskId: resolved.taskId };
  setVisibleView(viewState.mode);
  if (viewState.mode === "board") renderBoard();
  else if (viewState.mode === "quadrant") renderQuadrantList();
  else renderTaskDetail(resolved.task);
}
async function reload() {
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("加载超时")), 5000));
    tasks = await Promise.race([api.listLongTasks(), timeout]);
    if (!Array.isArray(tasks)) tasks = [];
  } catch (error) {
    console.error("长期任务加载失败:", error);
    tasks = [];
  }
  render();
}

function showForm(task = {}) {
  $("#long-task-form-title").textContent = task.id ? tr("editLongTask") : tr("addLongTask");
  $("#long-task-id").value = task.id || ""; $("#long-task-title").value = task.title || ""; setFormQuadrant(task.quadrant || "important-not-urgent");
  const reminder = task.reminder || { kind: "none", time: "09:00", weekdays: [] }; $("#long-reminder-kind").value = reminder.kind || "none"; $("#long-reminder-at").value = reminder.at ? new Date(new Date(reminder.at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; $("#long-reminder-clock").value = reminder.time || "09:00";
  $$("#long-reminder-weekdays input").forEach((input) => input.checked = (reminder.weekdays || []).includes(Number(input.value)));
  renderReminderFields(); $("#long-task-modal").hidden = false; $("#long-task-title").focus();
}
function hideForm() { $("#long-task-modal").hidden = true; }
function renderReminderFields() { const kind = $("#long-reminder-kind").value; $("#long-reminder-once").hidden = kind !== "once"; $("#long-reminder-time").hidden = !["daily", "weekly"].includes(kind); $("#long-reminder-weekdays").hidden = kind !== "weekly"; }
function selectedFormQuadrant() {
  const importance = document.querySelector('input[name="long-task-importance"]:checked')?.value || "important";
  const urgency = document.querySelector('input[name="long-task-urgency"]:checked')?.value || "not-urgent";
  if (importance === "important" && urgency === "urgent") return "important-urgent";
  if (importance === "important") return "important-not-urgent";
  if (urgency === "urgent") return "urgent-not-important";
  return "not-important-not-urgent";
}
function setFormQuadrant(quadrant) {
  const normalized = LongTaskUtils.QUADRANTS.includes(quadrant) ? quadrant : "important-not-urgent";
  const important = normalized === "important-urgent" || normalized === "important-not-urgent";
  const urgent = normalized === "important-urgent" || normalized === "urgent-not-important";
  const importanceInput = document.querySelector(`input[name="long-task-importance"][value="${important ? "important" : "not-important"}"]`);
  const urgencyInput = document.querySelector(`input[name="long-task-urgency"][value="${urgent ? "urgent" : "not-urgent"}"]`);
  if (importanceInput) importanceInput.checked = true;
  if (urgencyInput) urgencyInput.checked = true;
}
$$('[data-open-quadrant]').forEach((button) => button.addEventListener("click", () => openQuadrant(button.dataset.openQuadrant)));
$("#quadrant-back").addEventListener("click", navigateBack);
$("#task-detail-back").addEventListener("click", navigateBack);
function newTaskDefaults() {
  return LongTaskUtils.newTaskDefaultsForView(viewState);
}
$("#long-add").addEventListener("click", () => showForm(newTaskDefaults()));
$("#quadrant-add").addEventListener("click", () => showForm(newTaskDefaults()));
$("#long-task-close").addEventListener("click", hideForm); $("#long-task-cancel").addEventListener("click", hideForm); $("#long-reminder-kind").addEventListener("change", renderReminderFields);
$("#long-task-form").addEventListener("submit", async (event) => { event.preventDefault(); const kind = $("#long-reminder-kind").value; const weekdays = $$("#long-reminder-weekdays input:checked").map((input) => Number(input.value)); if (kind === "once" && !$("#long-reminder-at").value) return alert("请选择单次提醒时间。"); if (kind === "once" && Date.parse($("#long-reminder-at").value) <= Date.now()) return alert("提醒时间必须晚于当前时间。"); if (kind === "weekly" && !weekdays.length) return alert("请至少选择一个星期。"); const task = { id: $("#long-task-id").value, title: $("#long-task-title").value, notes: "", quadrant: selectedFormQuadrant(), reminder: { kind, at: $("#long-reminder-at").value ? new Date($("#long-reminder-at").value).toISOString() : null, time: $("#long-reminder-clock").value, weekdays } }; await api.saveLongTask(task); hideForm(); await reload(); });
$("#task-detail-title").addEventListener("input", saveDetailEdits);
$("#task-detail-reminder-kind").addEventListener("change", () => { renderDetailReminderFields(); saveDetailEdits(); });
$("#task-detail-reminder-at").addEventListener("change", () => { renderDetailReminderFields(); saveDetailEdits(); });
$("#task-detail-reminder-clock").addEventListener("change", () => { renderDetailReminderFields(); saveDetailEdits(); });
$("#task-detail-reminder-weekdays").addEventListener("change", () => { renderDetailReminderFields(); saveDetailEdits(); });
document.addEventListener("mousemove", (event) => updateMarkdownLineSelection(event.clientX, event.clientY));
document.addEventListener("mouseup", (event) => endMarkdownLineSelection(event));
$("#task-detail-notes").addEventListener("click", (event) => {
  const line = event.target.closest(".markdown-line");
  if (line) line.focus();
  else if (!$("#task-detail-notes .markdown-line")) {
    const next = createMarkdownLine("");
    $("#task-detail-notes").append(next);
    startMarkdownLineEdit(next, 0);
  }
});
$("#task-detail-notes").addEventListener("input", (event) => {
  const line = event.target.closest(".markdown-line.editing");
  if (line) line.dataset.raw = line.textContent.replace(/\u00a0/g, " ");
  saveDetailEdits();
});
$("#task-detail-notes").addEventListener("keydown", (event) => {
  const line = event.target.closest(".markdown-line.editing");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
    event.preventDefault();
    restoreNoteSnapshot();
    return;
  }
  const textRange = markdownTextSelectionRange();
  if (textRange) {
    if (event.key === "Tab") {
      event.preventDefault();
      indentSelectedMarkdownLines(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      replaceMarkdownSelectionWithText("");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      replaceMarkdownSelectionWithText("\n");
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      replaceMarkdownSelectionWithText(event.key);
      return;
    }
  }
  if (event.key === "Tab") {
    event.preventDefault();
    if (indentSelectedMarkdownLines(event.shiftKey ? -1 : 1)) return;
    if (line) {
      const index = markdownLineIndex(line);
      finishMarkdownLineEdit(line);
      pushNoteUndoSnapshot();
      const lines = LongTaskUtils.indentNoteLines(
        markdownLineElements().map((item) => item.dataset.raw || ""),
        index,
        index,
        event.shiftKey ? -1 : 1,
      );
      setNoteLines(lines, { line: index, offset: 0 });
      saveDetailEdits();
    }
    return;
  }
  if (!line) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (moveMarkdownLineByKeyboard(line, event.key === "ArrowDown" ? 1 : -1)) {
      event.preventDefault();
    }
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    splitMarkdownLine(line);
    return;
  }
  if (event.key === "Backspace" && caretOffset(line) === 0 && line.previousElementSibling?.classList.contains("markdown-line")) {
    event.preventDefault();
    mergeMarkdownLineBackward(line);
  }
});
$("#task-detail-notes").addEventListener("paste", (event) => {
  const line = event.target.closest(".markdown-line.editing");
  const transferFiles = filesFromTransfer(event.clipboardData);
  const imageFiles = imageFilesFromTransfer(event.clipboardData);
  if (imageFiles.length && imageFiles.length === transferFiles.length) {
    event.preventDefault();
    insertImageFilesIntoNotes(line, imageFiles, line ? caretOffset(line) : undefined).catch(() => alert(tr("imageImportFailed")));
    return;
  }
  if (transferHasFiles(event.clipboardData)) {
    event.preventDefault();
    alert(tr("imageImportFailed"));
    return;
  }
  if (markdownTextSelectionRange()) {
    event.preventDefault();
    replaceMarkdownSelectionWithText(event.clipboardData.getData("text/plain"));
    return;
  }
  if (!line) return;
  event.preventDefault();
  pushNoteUndoSnapshot();
  pasteIntoMarkdownLine(line, event.clipboardData.getData("text/plain"));
});
$("#task-detail-notes").addEventListener("copy", (event) => {
  handleMarkdownClipboardSelection(event);
});
$("#task-detail-notes").addEventListener("cut", (event) => {
  handleMarkdownClipboardSelection(event, true);
});
$("#task-detail-notes").addEventListener("dragover", (event) => {
  if (!transferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  setImageDropState(true);
});
$("#task-detail-notes").addEventListener("dragleave", (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) setImageDropState(false);
});
$("#task-detail-notes").addEventListener("drop", (event) => {
  if (!transferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  setImageDropState(false);
  const transferFiles = filesFromTransfer(event.dataTransfer);
  const imageFiles = imageFilesFromTransfer(event.dataTransfer);
  if (!imageFiles.length || imageFiles.length !== transferFiles.length) {
    alert(tr("imageImportFailed"));
    return;
  }
  const activeLine = $("#task-detail-notes .markdown-line.editing");
  const line = activeLine || noteLineAtPoint(event.clientX, event.clientY) || lastNoteLine();
  const offset = line.classList.contains("editing") ? caretOffset(line) : (line.dataset.raw || "").length;
  insertImageFilesIntoNotes(line, imageFiles, offset)
    .catch(() => alert(tr("imageImportFailed")))
    .finally(() => setImageDropState(false));
});
$("#task-detail-menu").addEventListener("click", (event) => {
  event.stopPropagation();
  const task = tasks.find((item) => item.id === viewState.taskId);
  if (!task) return;
  const rect = event.currentTarget.getBoundingClientRect();
  showTaskMenu(task, rect.right - 160, rect.bottom + 6);
});
$("#task-detail-check").addEventListener("change", async (event) => {
  event.currentTarget.disabled = true;
  const task = currentDetailTask();
  try {
    await api.completeLongTask(viewState.taskId);
    if (task) showLongUndo(task);
  }
  catch (error) { event.currentTarget.checked = false; event.currentTarget.disabled = false; alert(error.message); }
});
taskMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const task = tasks.find((item) => item.id === taskMenu.dataset.id);
  hideTaskMenu();
  if (!task) return;
  if (button.dataset.action === "copy-today") {
    try {
      await copyTaskToToday(task);
    } catch (error) {
      alert(error.message);
    }
  }
  if (button.dataset.action === "delete" && confirm(`删除"${task.title}"？`)) await api.deleteLongTask(task.id);
});
document.addEventListener("click", hideTaskMenu);
$$(".quadrant-list").forEach((list) => {
  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    list.classList.add("drag-over");
    updateDragPlaceholder(list, event);
  });
  list.addEventListener("dragleave", (event) => {
    if (!list.contains(event.relatedTarget)) {
      list.classList.remove("drag-over");
      dragPlaceholder.remove();
    }
  });
  list.addEventListener("drop", async (event) => {
    event.preventDefault();
    list.classList.remove("drag-over");
    const taskId = event.dataTransfer.getData("text/plain");
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      dragPlaceholder.remove();
      return;
    }
    const targetQuadrant = list.dataset.list === "active-quadrant" ? viewState.quadrant : list.dataset.list;
    const beforeId = placeholderTargetId(list);
    dragPlaceholder.remove();
    const activeTasks = tasks.filter((t) => t.status === "active");
    const others = activeTasks.filter((item) => item.id !== taskId);
    const targetTasks = others.filter((item) => item.quadrant === targetQuadrant).sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt));
    const insertIndex = beforeId ? targetTasks.findIndex((item) => item.id === beforeId) : targetTasks.length;
    targetTasks.splice(insertIndex >= 0 ? insertIndex : targetTasks.length, 0, { ...task, quadrant: targetQuadrant });
    const quadrantOrder = ["important-urgent", "important-not-urgent", "urgent-not-important", "not-important-not-urgent"];
    const updates = [];
    quadrantOrder.forEach((quadrant) => {
      const ordered = quadrant === targetQuadrant
        ? targetTasks
        : others.filter((item) => item.quadrant === quadrant).sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt));
      ordered.forEach((item, order) => updates.push({ id: item.id, quadrant, order }));
    });
    try {
      tasks = await api.reorderLongTasks(updates);
    } catch (error) {
      console.error("长期任务排序保存失败:", error);
    }
    render();
  });
});
function renderMessages() { $("#long-ai-messages").innerHTML = chatHistory.map((message) => `<div class="long-ai-message ${message.role}">${escapeHTML(message.content)}</div>`).join(""); }
function openAiPanel() {
  $("#long-ai-panel").hidden = false;
  $("#long-ai-input").focus();
}
$("#long-ai-toggle").addEventListener("click", openAiPanel);
$("#quadrant-ai-toggle").addEventListener("click", openAiPanel);
$("#long-ai-close").addEventListener("click", () => $("#long-ai-panel").hidden = true);
$("#long-ai-new").addEventListener("click", () => { chatHistory = []; pendingOperations = []; $("#long-ai-preview").hidden = true; renderMessages(); $("#long-ai-input").focus(); });
$("#long-ai-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#long-ai-input").value.trim();
  if (!message) return;
  const history = chatHistory.slice(-6);
  chatHistory.push({ role: "user", content: message });
  renderMessages();
  $("#long-ai-input").value = "";
  $("#long-ai-send").disabled = true;
  try {
    const result = await api.chatWithLongTasks({ message, history });
    pendingOperations = result.operations;
    chatHistory.push({
      role: "assistant",
      content: result.fallback
        ? `${result.warning}\n已生成 ${pendingOperations.length} 项待确认变更。请检查提醒时间和象限后再确认。`
        : `已生成 ${pendingOperations.length} 项待确认变更。`,
    });
    renderMessages();
    $("#long-ai-preview").hidden = false;
    $("#long-ai-preview").innerHTML = `${pendingOperations.map((operation) => `<div class="operation-item"><strong>${{ create: "新增", update: "修改", delete: "删除", restore: "恢复" }[operation.action]}</strong> · ${escapeHTML(operation.task?.title || tasks.find((task) => task.id === operation.id)?.title || operation.id)}</div>`).join("")}<div class="operation-actions"><button id="discard-ops" class="secondary-btn" type="button">放弃</button><button id="apply-ops" class="primary-btn" type="button">确认应用</button></div>`;
  } catch (error) {
    chatHistory.push({ role: "assistant", content: `无法生成变更：${error.message}` });
    renderMessages();
  } finally {
    $("#long-ai-send").disabled = false;
  }
});
$("#long-ai-preview").addEventListener("click", async (event) => { if (event.target.id === "discard-ops") { pendingOperations = []; $("#long-ai-preview").hidden = true; } if (event.target.id === "apply-ops") { if (pendingOperations.some((operation) => operation.action === "delete") && !confirm("变更中包含删除操作，确认继续？")) return; await api.applyLongTaskOperations(pendingOperations); pendingOperations = []; $("#long-ai-preview").hidden = true; } });

const LongAiSettings = (() => {
  const modal = $("#long-ai-settings-modal");
  let profiles = [];
  let applyingProfile = false;
  const setStatus = (message = "", kind = "") => {
    const status = $("#long-ai-settings-status");
    status.textContent = message;
    status.className = `settings-status${kind ? ` ${kind}` : ""}`;
  };
  function populatePresets() {
    const select = $("#long-api-model-preset");
    select.replaceChildren(new Option("自定义模型", "custom"));
    PlannerUtils.API_MODEL_PRESET_GROUPS.forEach((groupConfig) => {
      const group = document.createElement("optgroup");
      group.label = groupConfig.label;
      groupConfig.presets.forEach((preset) => group.append(new Option(preset.label, preset.id)));
      select.append(group);
    });
  }
  function selectMatchingPreset() {
    const preset = PlannerUtils.matchApiModelPreset($("#long-api-model").value.trim(), $("#long-api-base-url").value.trim());
    $("#long-api-model-preset").value = preset?.id || "custom";
  }
  function applyPreset() {
    const preset = PlannerUtils.getApiModelPreset($("#long-api-model-preset").value);
    if (!preset) return $("#long-api-model").focus();
    $("#long-api-base-url").value = preset.baseUrl;
    $("#long-api-model").value = preset.model || "";
    detachProfileIfChanged();
    setStatus(
      preset.model
        ? `已选择 ${preset.provider} · ${preset.label}`
        : `已选择 ${preset.provider} · 已填入最新 API Base URL`,
      "success",
    );
  }
  function detachProfileIfChanged() {
    if (applyingProfile || !$("#long-api-profile").value) return;
    const profile = profiles.find((item) => item.id === $("#long-api-profile").value);
    if (profile && (profile.baseUrl !== $("#long-api-base-url").value.trim().replace(/\/+$/, "") || profile.model !== $("#long-api-model").value.trim())) {
      $("#long-api-profile").value = "";
      $("#long-api-label").value = "";
      $("#long-api-key-row").hidden = false;
      $("#long-api-saved-hint").hidden = true;
      $("#long-api-delete").disabled = true;
      setStatus("模型信息已修改，请输入 API Key 保存为新配置。");
    }
  }
  function renderSummary(config) {
    $("#long-ai-config-summary").textContent = `${config.api.model || "未配置"} · API`;
  }
  function populateProfiles(config) {
    profiles = config.apiProfiles || [];
    const select = $("#long-api-profile");
    select.replaceChildren(new Option("新建 API 配置", ""));
    profiles.forEach((profile) => select.append(new Option(profile.label, profile.id)));
    select.value = config.activeApiProfileId || "";
    $("#long-api-delete").disabled = !select.value;
  }
  function startNewProfile() {
    $("#long-api-profile").value = "";
    $("#long-api-label").value = "";
    $("#long-api-model-preset").value = "custom";
    $("#long-api-base-url").value = "";
    $("#long-api-model").value = "";
    $("#long-api-key").value = "";
    $("#long-api-key-row").hidden = false;
    $("#long-api-saved-hint").hidden = true;
    $("#long-api-delete").disabled = true;
    setStatus("正在新建 API 配置，请填写名称和 API Key。");
    $("#long-api-label").focus();
  }
  function applyProfile() {
    const profile = profiles.find((item) => item.id === $("#long-api-profile").value);
    if (!profile) {
      $("#long-api-label").value = "";
      $("#long-api-model-preset").value = "custom";
      $("#long-api-base-url").value = "";
      $("#long-api-model").value = "";
      $("#long-api-key").value = "";
    } else {
      applyingProfile = true;
      $("#long-api-label").value = profile.label;
      $("#long-api-base-url").value = profile.baseUrl;
      $("#long-api-model").value = profile.model;
      $("#long-api-key").value = "";
      selectMatchingPreset();
      applyingProfile = false;
    }
    $("#long-api-key-row").hidden = Boolean(profile);
    $("#long-api-saved-hint").hidden = !profile;
    $("#long-api-delete").disabled = !profile;
  }
  async function refresh() {
    const config = await api.getLongTaskAiConfig();
    renderSummary(config);
    return config;
  }
  async function open() {
    modal.hidden = false;
    setStatus("正在读取配置…");
    try {
      const config = await refresh();
      populateProfiles(config);
      if (config.activeApiProfileId) applyProfile();
      else {
        $("#long-api-base-url").value = config.api.baseUrl;
        $("#long-api-model").value = config.api.model;
        selectMatchingPreset();
        $("#long-api-key-row").hidden = false;
        $("#long-api-saved-hint").hidden = true;
        $("#long-api-delete").disabled = true;
      }
      $("#long-system-prompt").value = config.systemPrompt || "";
      setStatus("");
    } catch (error) { setStatus(error.message, "error"); }
  }
  function close() {
    modal.hidden = true;
    requestAnimationFrame(() => {
      const chatInput = $("#long-ai-panel").hidden ? null : $("#long-ai-input");
      (chatInput || $("#long-ai-settings")).focus();
    });
  }
  async function save() {
    const button = $("#long-ai-settings-save");
    button.disabled = true;
    setStatus("正在保存…");
    try {
      const config = await api.saveLongTaskAiConfig({
        mode: "api",
        api: {
          profileId: $("#long-api-profile").value,
          label: $("#long-api-label").value,
          baseUrl: $("#long-api-base-url").value,
          model: $("#long-api-model").value,
          apiKey: $("#long-api-key").value,
          forceNewProfile: !$("#long-api-profile").value,
        },
        systemPrompt: $("#long-system-prompt").value,
      });
      renderSummary(config);
      setStatus("配置已保存，下一次对话生效。", "success");
      setTimeout(close, 400);
    } catch (error) { setStatus(error.message, "error"); }
    finally { button.disabled = false; }
  }
  async function deleteProfile() {
    const profileId = $("#long-api-profile").value;
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (!confirm(`删除已保存的 API 配置"${profile.label}"？`)) return;
    $("#long-api-delete").disabled = true;
    setStatus("正在删除 API 配置…");
    try {
      const config = await api.deleteLongTaskApiProfile(profileId);
      populateProfiles(config);
      if (config.activeApiProfileId) applyProfile();
      else {
        $("#long-api-label").value = "";
        $("#long-api-base-url").value = config.api.baseUrl;
        $("#long-api-model").value = config.api.model;
        selectMatchingPreset();
        $("#long-api-key-row").hidden = false;
        $("#long-api-saved-hint").hidden = true;
      }
      renderSummary(config);
      setStatus("API 配置已删除。", "success");
    } catch (error) { setStatus(error.message, "error"); }
    finally { $("#long-api-delete").disabled = !$("#long-api-profile").value; }
  }
  $("#long-ai-settings").addEventListener("click", () => {
    if (typeof api.openAppSettings === "function") api.openAppSettings("long-ai");
    else open();
  });
  $("#long-ai-settings-close").addEventListener("click", close);
  $("#long-ai-settings-cancel").addEventListener("click", close);
  $("#long-ai-settings-save").addEventListener("click", save);
  $("#long-api-profile").addEventListener("change", applyProfile);
  $("#long-api-new").addEventListener("click", startNewProfile);
  $("#long-api-delete").addEventListener("click", deleteProfile);
  $("#long-free-api-tutorial").addEventListener("click", () => api.openFreeApiTutorial());
  $("#long-api-model-preset").addEventListener("change", applyPreset);
  $("#long-api-base-url").addEventListener("input", () => { selectMatchingPreset(); detachProfileIfChanged(); });
  $("#long-api-model").addEventListener("input", () => { selectMatchingPreset(); detachProfileIfChanged(); });
  populatePresets();
  refresh().catch((error) => { $("#long-ai-config-summary").textContent = error.message; });
  return { refresh, close };
})();

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" && !(event.altKey && event.key === "ArrowLeft")) return;
  if (!taskMenu.hidden) { event.preventDefault(); hideTaskMenu(); return; }
  if (!$("#long-task-modal").hidden) { event.preventDefault(); hideForm(); return; }
  if (!$("#long-ai-settings-modal").hidden) { event.preventDefault(); LongAiSettings.close(); return; }
  if (!$("#long-ai-panel").hidden) { event.preventDefault(); $("#long-ai-panel").hidden = true; return; }
  if (viewState.mode !== "board") { event.preventDefault(); navigateBack(); }
});

api.onLongTasksChanged((next) => {
  tasks = next;
  if (viewState.mode === "detail" && isDetailEditorFocused() && currentDetailTask()) {
    return;
  }
  render();
}); api.acknowledgeReminders(); reload();
