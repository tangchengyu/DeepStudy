const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktopApp = fs.readFileSync(path.resolve(__dirname, "..", "renderer", "app.js"), "utf8");

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
