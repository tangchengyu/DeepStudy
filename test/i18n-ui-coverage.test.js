const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "renderer");
const appJs = fs.readFileSync(path.join(renderer, "app.js"), "utf8");
const i18nJs = fs.readFileSync(path.join(renderer, "i18n.js"), "utf8");
const styles = fs.readFileSync(path.join(renderer, "styles.css"), "utf8");
const timerHtml = fs.readFileSync(path.join(renderer, "timer.html"), "utf8");
const timerJs = fs.readFileSync(path.join(renderer, "timer.js"), "utf8");

test("dynamic focus, rest, and habit content uses translated copy", () => {
  const dynamicKeys = [
    "controllableInteresting",
    "controllableBoring",
    "uncontrollableInteresting",
    "uncontrollableBoring",
  ];
  const staticKeys = [
    "boxBreathing",
    "wimHofBreathing",
    "habitTargetValue",
    "auditDescription",
  ];
  for (const key of [...dynamicKeys, ...staticKeys]) {
    assert.match(i18nJs, new RegExp(`${key}:`));
  }
  for (const key of dynamicKeys) {
    assert.match(appJs, new RegExp(`tr\\(\\"${key}\\"\\)`));
  }
  assert.doesNotMatch(appJs, /"controllable-interesting": \["可控 \+ 有意思"/);
});

test("language changes rerender dynamic app views", () => {
  assert.match(i18nJs, /deepstudy:language-changed/);
  assert.match(appJs, /addEventListener\("deepstudy:language-changed",\s*refreshLocaleSensitiveViews\)/);
  assert.match(appJs, /return \{ addTasks, getTasks, reloadFromStorage, render \}/);
});

test("white-noise popover is promoted to the root overlay layer", () => {
  assert.match(appJs, /document\.body\.append\(popover\)/);
  assert.match(appJs, /--noise-popover-max-height/);
  assert.match(styles, /#noise-popover\s*\{[^}]*z-index:\s*250/s);
});

test("standalone timer windows follow the selected interface language", () => {
  assert.match(timerHtml, /<script src="i18n\.js"><\/script>/);
  assert.match(timerJs, /applyTimerCopy/);
  assert.match(timerJs, /tr\(copy\.key\)/);
});

test("work type switch translates only the visible side labels", () => {
  const indexHtml = fs.readFileSync(path.join(renderer, "index.html"), "utf8");
  assert.match(indexHtml, /class="work-type-label maintenance-label"/);
  assert.match(indexHtml, /class="work-type-label core-label"/);
  assert.match(i18nJs, /\.switch-row \.maintenance-label/);
  assert.match(i18nJs, /\.switch-row \.core-label/);
  assert.doesNotMatch(i18nJs, /\.switch-row span:first-child/);
  assert.doesNotMatch(i18nJs, /\.switch-row span:last-child/);
});
