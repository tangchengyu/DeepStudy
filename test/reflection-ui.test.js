const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const desktopApp = fs.readFileSync(path.resolve(__dirname, "..", "renderer", "app.js"), "utf8");

test("background synchronization preserves an unsaved reflection draft", () => {
  const start = desktopApp.indexOf("function reloadFromStorage()", desktopApp.indexOf("const Reflections ="));
  const end = desktopApp.indexOf("const selectedIds =", start);
  const context = {
    items: [{ id: "today", date: "2026-09-20", content: "previous saved note" }],
    input: { value: "an unfinished local draft" }, editingId: null, selectedIds: new Set(),
    KEYS: { reflections: "notes" }, todayKey: () => "2026-09-20", render() {},
    readJSON: () => [{ id: "today", date: "2026-09-20", content: "remote saved note" }],
  };
  vm.runInNewContext(`${desktopApp.slice(start, end)}\nreloadFromStorage();`, context);
  assert.equal(context.input.value, "an unfinished local draft");
  assert.equal(context.items[0].content, "remote saved note");
});

test("background synchronization updates a reflection editor with no unsaved changes", () => {
  const start = desktopApp.indexOf("function reloadFromStorage()", desktopApp.indexOf("const Reflections ="));
  const end = desktopApp.indexOf("const selectedIds =", start);
  const context = {
    items: [{ id: "today", date: "2026-09-20", content: "previous saved note" }],
    input: { value: "previous saved note" }, editingId: null, selectedIds: new Set(),
    KEYS: { reflections: "notes" }, todayKey: () => "2026-09-20", render() {},
    readJSON: () => [{ id: "today", date: "2026-09-20", content: "remote saved note" }],
  };
  vm.runInNewContext(`${desktopApp.slice(start, end)}\nreloadFromStorage();`, context);
  assert.equal(context.input.value, "remote saved note");
});

test("desktop reflection history renders newest dates first", () => {
  const start = desktopApp.indexOf("function groupItemsByDate()");
  const end = desktopApp.indexOf("function render()", start);
  const groupItemsByDate = desktopApp.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(
    groupItemsByDate,
    /String\(b\.date \|\| ""\)\.localeCompare\(String\(a\.date \|\| ""\)\)/,
  );
  assert.doesNotMatch(
    groupItemsByDate,
    /\[\.\.\.items\]\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)/,
  );
});
