const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(renderer, "long-tasks.html"), "utf8");
const css = fs.readFileSync(path.join(renderer, "long-tasks.css"), "utf8");

test("declares board, quadrant list, and task detail views", () => {
  for (const id of ["quadrant-board-view", "quadrant-list-view", "task-detail-view", "quadrant-view-list", "task-detail-notes"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.equal((html.match(/data-open-quadrant=/g) || []).length, 4);
});

test("keeps task notes safe and readable in the detail view", () => {
  assert.match(html, /id="task-detail-notes"/);
  assert.match(css, /\.task-detail-notes\s*\{[^}]*white-space:\s*pre-wrap/s);
});
