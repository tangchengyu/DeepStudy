const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../renderer/long-tasks.js"), "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));

function createEditor() {
  const initial = {
    id: "cross-device-plan", title: "跨端同步测试", notes: "原有计划", status: "active",
    quadrant: "important-not-urgent", updatedAt: 1,
    reminder: { kind: "none", at: null, time: "09:00", weekdays: [], enabled: false, lastTriggeredAt: null },
  };
  const elements = new Map();
  const timers = new Map();
  const writes = [];
  let timerId = 0;
  let editorNotes = "";
  let editorReminder;
  let received;
  let saveHook = async () => {};
  let renderCount = 0;
  let persisted = clone(initial);
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { value: "", textContent: "", replaceChildren() {} });
    return elements.get(selector);
  };
  const context = vm.createContext({
    console, Date, Intl,
    $: element,
    document: { activeElement: { closest: () => element("#task-detail-notes") }, createElement: () => ({}) },
    tr: (key) => key,
    quadrantLabel: (key) => key,
    currentLocale: () => "zh-CN",
    renderNotesEditor: (notes) => { editorNotes = notes; renderCount += 1; },
    notesEditorValue: () => editorNotes,
    populateDetailReminder: (reminder) => { editorReminder = clone(reminder); },
    readDetailReminder: () => clone(editorReminder),
    validateDetailReminder: () => "",
    detailReminderSummary: () => "",
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    api: {
      onLongTasksChanged: (callback) => { received = callback; },
      saveLongTask: async (task) => {
        persisted = clone(task);
        writes.push(persisted);
        await saveHook(clone(task));
        return clone(task);
      },
    },
    initial: clone(initial),
  });
  vm.runInContext([
    source.slice(source.indexOf("let tasks ="), source.indexOf("const localImageUrls")),
    source.slice(source.indexOf("function currentDetailTask()"), source.indexOf("function showLongUndo(")),
    source.slice(source.indexOf("function renderTaskDetail("), source.indexOf("function render()")),
    "function render() { const task = currentDetailTask(); if (task) renderTaskDetail(task); }",
    "tasks = [initial]; viewState = { mode: 'detail', taskId: initial.id }; render();",
    source.slice(source.indexOf("api.onLongTasksChanged((next) =>"), source.indexOf(" api.acknowledgeReminders();")),
  ].join("\n"), context);
  return {
    initial, writes,
    receive(task) { persisted = clone(task); received([clone(task)]); },
    setSaveHook(hook) { saveHook = hook; },
    openTask(task) {
      context.nextTask = clone(task);
      vm.runInContext("tasks.push(nextTask); viewState.taskId = nextTask.id; render();", context);
    },
    editNotes(notes) { editorNotes = notes; vm.runInContext("saveDetailEdits()", context); },
    editTitle(title) { element("#task-detail-title").value = title; vm.runInContext("saveDetailEdits()", context); },
    blurLine() { vm.runInContext("saveDetailEdits()", context); },
    async flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) await callback();
    },
    persisted: () => persisted,
    displayedNotes: () => editorNotes,
    displayedTitle: () => element("#task-detail-title").value,
    renderCount: () => renderCount,
  };
}

test("a focused note editor does not save its stale text over a received task on blur", async () => {
  const editor = createEditor();
  const incoming = {
    ...editor.initial,
    notes: "原有计划\n新增计划一\n新增计划二",
    updatedAt: 2,
  };
  editor.receive(incoming);
  editor.blurLine();
  await editor.flush();
  assert.equal(editor.persisted().notes, incoming.notes);
  assert.equal(editor.writes.length, 0);
});

test("a focused editor displays received notes when it has no unsaved edit", () => {
  const editor = createEditor();
  const incoming = { ...editor.initial, notes: "另一台设备新加的计划", updatedAt: 2 };
  editor.receive(incoming);
  assert.equal(editor.displayedNotes(), incoming.notes);
});

test("an actual note edit still saves its multiline text", async () => {
  const editor = createEditor();
  const notes = "原有计划\n新增计划一\n新增计划二";
  editor.editNotes(notes);
  await editor.flush();
  assert.equal(editor.persisted().notes, notes);
  assert.equal(editor.writes.length, 1);
});

test("a pending note edit preserves a received change to an untouched title", async () => {
  const editor = createEditor();
  const notes = "原有计划\n本机新增一行";
  editor.editNotes(notes);
  editor.receive({ ...editor.initial, title: "另一台设备修改的标题", updatedAt: 2 });
  assert.equal(editor.displayedNotes(), notes);
  await editor.flush();
  assert.equal(editor.persisted().notes, notes);
  assert.equal(editor.persisted().title, "另一台设备修改的标题");
});

test("a received note does not discard an unsaved local change to the same field", async () => {
  const editor = createEditor();
  editor.editNotes("本机尚未保存的备注");
  editor.receive({ ...editor.initial, notes: "另一台设备的新备注", updatedAt: 2 });
  assert.equal(editor.displayedNotes(), "本机尚未保存的备注");
  await editor.flush();
  assert.equal(editor.persisted().notes, "本机尚未保存的备注");
});

test("the broadcast acknowledging a local save preserves the focused editor", async () => {
  const editor = createEditor();
  editor.setSaveHook((task) => editor.receive(task));
  editor.editNotes("本机输入的备注");
  await editor.flush();
  assert.equal(editor.renderCount(), 1);
  editor.blurLine();
  await editor.flush();
  assert.equal(editor.writes.length, 1);
});

test("editing another task before the debounce expires saves both tasks", async () => {
  const editor = createEditor();
  editor.editNotes("第一个任务的新备注");
  editor.openTask({ ...editor.initial, id: "second", title: "第二个任务" });
  editor.editNotes("第二个任务的新备注");
  await editor.flush();
  assert.deepEqual(editor.writes.map(({ id, notes }) => ({ id, notes })), [
    { id: editor.initial.id, notes: "第一个任务的新备注" },
    { id: "second", notes: "第二个任务的新备注" },
  ]);
});

test("an edit made during a slow save is saved after its debounce already fired", async () => {
  const editor = createEditor();
  let finishSave;
  editor.setSaveHook(() => new Promise((resolve) => { finishSave = resolve; }));
  editor.editNotes("第一次输入");
  const firstSave = editor.flush();
  editor.editNotes("第一次输入\n保存期间继续输入");
  await editor.flush();
  editor.setSaveHook(async () => {});
  finishSave();
  await firstSave;
  await editor.flush();
  assert.equal(editor.persisted().notes, "第一次输入\n保存期间继续输入");
  assert.equal(editor.writes.length, 2);
});

test("a received update preserves an incomplete title until it passes validation", async () => {
  const editor = createEditor();
  editor.editTitle("");
  editor.receive({ ...editor.initial, notes: "另一台设备的新备注", updatedAt: 2 });
  assert.equal(editor.displayedTitle(), "");
  editor.editTitle("完成后的标题");
  await editor.flush();
  assert.equal(editor.persisted().title, "完成后的标题");
  assert.equal(editor.persisted().notes, "另一台设备的新备注");
});
