const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activeTasksForQuadrant,
  applyPriorityDecision,
  dueTasks,
  detailReturnView,
  fallbackAiOperationsFromText,
  imageInsertionLines,
  newTaskDefaultsForView,
  nextReminderAt,
  normalizeAiOperations,
  normalizeTask,
  parseObsidianImagePath,
  resolveLongTaskView,
} = require("../renderer/long-task-utils");

test("inserts image lines at a caret in the middle of a markdown line", () => {
  assert.deepEqual(
    imageInsertionLines("前半后半", 2, ["![a](deepstudy-image://a.png)", "![b](deepstudy-image://b.png)"]),
    ["前半", "![a](deepstudy-image://a.png)", "![b](deepstudy-image://b.png)", "后半"],
  );
});

test("replaces an empty markdown line with image lines", () => {
  assert.deepEqual(
    imageInsertionLines("", 0, ["![a](deepstudy-image://a.png)"]),
    ["![a](deepstudy-image://a.png)"],
  );
});

test("places image lines before text at offset zero", () => {
  assert.deepEqual(
    imageInsertionLines("正文", 0, ["![a](deepstudy-image://a.png)"]),
    ["![a](deepstudy-image://a.png)", "正文"],
  );
});

test("places image lines after text at the line end", () => {
  assert.deepEqual(
    imageInsertionLines("正文", 2, ["![a](deepstudy-image://a.png)"]),
    ["正文", "![a](deepstudy-image://a.png)"],
  );
});

test("clamps image insertion offsets to the markdown line bounds", () => {
  const image = ["![a](deepstudy-image://a.png)"];
  assert.deepEqual(imageInsertionLines("正文", -1, image), ["![a](deepstudy-image://a.png)", "正文"]);
  assert.deepEqual(imageInsertionLines("正文", 99, image), ["正文", "![a](deepstudy-image://a.png)"]);
});

test("normalizes a long task and its reminder", () => {
  const task = normalizeTask({ title: "  写论文  ", quadrant: "important-urgent", reminder: { kind: "weekly", time: "18:30", weekdays: [1, 3, 3] } }, 10);
  assert.equal(task.title, "写论文");
  assert.deepEqual(task.reminder.weekdays, [1, 3]);
});

test("preserves planned long tasks without treating them as completed", () => {
  const task = normalizeTask({ title: "写论文", status: "planned", completedAt: 100 }, 10);
  assert.equal(task.status, "planned");
  assert.equal(task.completedAt, null);
});

test("computes daily and weekly reminder occurrences", () => {
  const from = new Date("2026-06-22T08:00:00+08:00").getTime();
  assert.equal(new Date(nextReminderAt({ kind: "daily", time: "09:15" }, from)).getHours(), 9);
  assert.equal(new Date(nextReminderAt({ kind: "weekly", time: "10:00", weekdays: [2] }, from)).getDay(), 2);
});

test("finds a due one-time reminder once", () => {
  const at = new Date("2026-06-22T09:00:00+08:00").toISOString();
  const task = normalizeTask({ title: "任务", reminder: { kind: "once", at } }, 1);
  assert.equal(dueTasks([task], Date.parse(at) + 1000).length, 1);
  task.reminder.lastTriggeredAt = Date.parse(at);
  assert.equal(dueTasks([task], Date.parse(at) + 1000).length, 0);
});

test("parses confirmed AI operations and rejects unknown ids", () => {
  const existing = [normalizeTask({ id: "a", title: "任务 A" }, 1)];
  assert.equal(normalizeAiOperations('{"operations":[{"action":"update","id":"a","task":{"title":"任务 A+","quadrant":"important-urgent"}}]}', existing)[0].task.title, "任务 A+");
  assert.throws(() => normalizeAiOperations('{"operations":[{"action":"delete","id":"missing"}]}', existing));
});

test("extracts an Obsidian Windows absolute image path", () => {
  assert.equal(typeof parseObsidianImagePath, "function");
  assert.equal(
    parseObsidianImagePath("![[C:\\Users\\DELL\\Desktop\\论文阅读步骤.png]]"),
    "C:\\Users\\DELL\\Desktop\\论文阅读步骤.png",
  );
  assert.equal(parseObsidianImagePath("![[C:/Users/DELL/Desktop/论文阅读步骤.png]]"), "C:/Users/DELL/Desktop/论文阅读步骤.png");
  assert.equal(parseObsidianImagePath("![[relative.png]]"), null);
  assert.equal(parseObsidianImagePath("![[C:\\Users\\DELL\\Desktop\\notes.txt]]"), null);
});

test("parses long-task JSON even when the model adds trailing prose", () => {
  const operations = normalizeAiOperations('{"operations":[{"action":"create","task":{"title":"经营自己的自媒体","notes":"中文备注","quadrant":"important-not-urgent","reminder":{"kind":"none"}}}]}\\n请确认。', []);
  assert.equal(operations[0].action, "create");
  assert.equal(operations[0].task.title, "经营自己的自媒体");
  assert.equal(operations[0].task.notes, "中文备注");
});

test("demotes the selected priority when adding a worthy task", () => {
  const tasks = [1, 2, 3].map((id) => ({ id: String(id), text: `任务 ${id}`, priority: true }));
  const result = applyPriorityDecision(tasks, { id: "4", text: "长期任务" }, { worthy: true, demoteId: "3" });
  assert.equal(result.find((task) => task.id === "3").priority, false);
  assert.equal(result.find((task) => task.id === "4").priority, true);
});

test("does not cap manually selected priority tasks", () => {
  const tasks = [1, 2, 3].map((id) => ({ id: String(id), text: `任务 ${id}`, priority: true }));
  const result = applyPriorityDecision(tasks, { id: "4", text: "长期任务" }, { worthy: true });
  assert.equal(result.filter((task) => task.priority).length, 4);
});

test("creates a fallback long-task operation when the model returns empty content", () => {
  const now = new Date("2026-06-23T10:00:00+08:00").getTime();
  const operations = fallbackAiOperationsFromText("下周三晚上提交论文初稿，提前一天提醒我", now);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].action, "create");
  assert.equal(operations[0].task.title, "提交论文初稿");
  assert.equal(operations[0].task.notes, "");
  assert.equal(operations[0].task.quadrant, "important-urgent");
  assert.equal(operations[0].task.reminder.kind, "once");
  assert.equal(new Date(operations[0].task.reminder.at).getDay(), 2);
  assert.equal(new Date(operations[0].task.reminder.at).getHours(), 20);
});

test("selects and sorts active tasks for one quadrant", () => {
  const input = [
    { id: "later", quadrant: "important-urgent", status: "active", order: 2, createdAt: 1 },
    { id: "done", quadrant: "important-urgent", status: "completed", order: 0, createdAt: 1 },
    { id: "other", quadrant: "important-not-urgent", status: "active", order: 0, createdAt: 1 },
    { id: "first", quadrant: "important-urgent", status: "active", order: 1, createdAt: 2 },
  ];
  assert.deepEqual(activeTasksForQuadrant(input, "important-urgent").map((task) => task.id), ["first", "later"]);
});

test("keeps detail on the latest active task and falls back when it disappears", () => {
  const active = { id: "a", title: "新标题", quadrant: "urgent-not-important", status: "active" };
  assert.deepEqual(resolveLongTaskView({ mode: "detail", quadrant: "important-urgent", taskId: "a" }, [active]), {
    mode: "detail",
    quadrant: "urgent-not-important",
    taskId: "a",
    returnMode: "quadrant",
    task: active,
  });
  assert.deepEqual(resolveLongTaskView({ mode: "detail", quadrant: "important-urgent", taskId: "missing" }, []), {
    mode: "quadrant",
    quadrant: "important-urgent",
    taskId: null,
    task: null,
  });
});

test("returns board detail views to the board when the task is unavailable", () => {
  assert.deepEqual(detailReturnView({ mode: "detail", quadrant: "urgent-not-important", returnMode: "board" }), {
    mode: "board",
    quadrant: null,
    taskId: null,
  });
  assert.deepEqual(resolveLongTaskView({ mode: "detail", quadrant: "urgent-not-important", taskId: "missing", returnMode: "board" }, []), {
    mode: "board",
    quadrant: null,
    taskId: null,
    task: null,
  });
});

test("returns quadrant detail views to their source quadrant", () => {
  assert.deepEqual(detailReturnView({ mode: "detail", quadrant: "urgent-not-important", returnMode: "quadrant" }), {
    mode: "quadrant",
    quadrant: "urgent-not-important",
    taskId: null,
  });
});

test("preselects the active quadrant only when creating from its list", () => {
  assert.deepEqual(newTaskDefaultsForView({ mode: "quadrant", quadrant: "urgent-not-important" }), {
    quadrant: "urgent-not-important",
  });
  assert.deepEqual(newTaskDefaultsForView({ mode: "board", quadrant: null }), {});
});
