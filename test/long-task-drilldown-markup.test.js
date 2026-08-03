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
  assert.match(longTasksJs, /obsidianImageImports\.delete\(sourcePath\)/);
  assert.doesNotMatch(longTasksJs, /readAsDataURL/);
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
  assert.match(longTasksJs, /returnMode:\s*viewState\.mode === "quadrant" \? "quadrant" : "board"/);
  assert.match(longTasksJs, /LongTaskUtils\.detailReturnView\(viewState\)/);
  assert.match(longTasksJs, /LongTaskUtils\.newTaskDefaultsForView\(viewState\)/);
});
