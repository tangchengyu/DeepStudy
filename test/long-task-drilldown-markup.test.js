const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(renderer, "long-tasks.html"), "utf8");
const css = fs.readFileSync(path.join(renderer, "long-tasks.css"), "utf8");
const longTasksJs = fs.readFileSync(path.join(renderer, "long-tasks.js"), "utf8");
const appJs = fs.readFileSync(path.join(renderer, "app.js"), "utf8");

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

test("limits long-task drag affordance to the colored control area", () => {
  assert.match(longTasksJs, /long-task-drag-zone/);
  assert.match(longTasksJs, /card\.addEventListener\("click"/);
  assert.doesNotMatch(longTasksJs, /card\.draggable\s*=\s*true/);
  assert.match(css, /\.long-task-drag-zone:hover\s*\{[^}]*cursor:\s*grab/s);
  assert.match(css, /10px 18px 0 currentColor/);
});

test("does not show an undo button for daily task completion", () => {
  assert.doesNotMatch(appJs, /undo-complete-button/);
  assert.match(appJs, /Reflections\.syncCompletedTasks\(state\.tasks\)/);
});
