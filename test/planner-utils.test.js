const test = require("node:test");
const assert = require("node:assert/strict");
const {
  API_MODEL_PRESETS,
  buildAuditSegments,
  buildTimelineSegments,
  completePriorityItems,
  formatApiResponsePreview,
  findSimilarTask,
  fallbackPlanItemsFromText,
  getApiModelPreset,
  matchApiModelPreset,
  mergeCompletedTasksIntoReflection,
  parsePlanItems,
  sanitizeChatHistory,
  syncCompletedTaskEntries,
  upsertApiProfile,
} = require("../renderer/planner-utils");

test("extracts priority tasks when the model omits the PLAN_ITEMS heading", () => {
  const reply = [
    "今天你的日程安排如下：",
    "",
    "* [PRIORITY] 完成鱼皮老师教程的学习内容",
  ].join("\n");

  assert.deepEqual(parsePlanItems(reply), [
    "[PRIORITY] 完成鱼皮老师教程的学习内容",
  ]);
});

test("ignores malformed plan item brackets", () => {
  assert.deepEqual(parsePlanItems("PLAN_ITEMS:\n- ["), []);
});

test("extracts all tasks when the model uses a markdown PLAN_ITEMS heading", () => {
  const reply = [
    "**今日计划**",
    "1. 设定阅读聊天记录的时间块。",
    "",
    "---",
    "",
    "### PLAN_ITEMS",
    "- [PRIORITY] 阅读聊天记录 45 分钟",
    "- 准备探访阿公阿婆的礼物或问候卡",
    "- 前往阿公阿婆家并进行探访 30 分钟",
    "- 回家换装并准备乒乓球装备",
    "- 打乒乓球 30 分钟",
  ].join("\n");

  assert.deepEqual(parsePlanItems(reply), [
    "[PRIORITY] 阅读聊天记录 45 分钟",
    "准备探访阿公阿婆的礼物或问候卡",
    "前往阿公阿婆家并进行探访 30 分钟",
    "回家换装并准备乒乓球装备",
    "打乒乓球 30 分钟",
  ]);
});

test("extracts daily tasks from common JSON-shaped model output", () => {
  assert.deepEqual(
    parsePlanItems('{"plan_items":["[PRIORITY] 写论文 45 分钟","整理资料 20 分钟"]}'),
    ["[PRIORITY] 写论文 45 分钟", "整理资料 20 分钟"],
  );
});

test("falls back to splitting sequential Chinese plan text", () => {
  assert.deepEqual(
    fallbackPlanItemsFromText("我今天先去健身，然后把微信这么长时间的聊天记录过完，然后再去看个阿公阿婆，再打个乒乓球"),
    ["健身", "过完微信这么长时间的聊天记录", "看阿公阿婆", "打个乒乓球"],
  );
});

test("API model presets provide and match their Base URL", () => {
  assert.ok(API_MODEL_PRESETS.length >= 6);
  const preset = getApiModelPreset("deepseek-v4-flash");
  assert.deepEqual(preset, {
    id: "deepseek-v4-flash",
    provider: "DeepSeek",
    label: "DeepSeek V4 Flash",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  });
  assert.equal(
    matchApiModelPreset("deepseek-v4-flash", "https://api.deepseek.com/")?.id,
    preset.id,
  );
  assert.equal(
    matchApiModelPreset(
      "gemini-2.5-flash",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    )?.id,
    "gemini-2-5-flash-free",
  );
  assert.equal(
    getApiModelPreset("openrouter-gpt-oss-120b-free").model,
    "nvidia/nemotron-3-super-120b-a12b:free",
  );
});

test("formats non-JSON API responses without leaking parser errors", () => {
  assert.match(
    formatApiResponsePreview("text/html", "<!doctype html><html><title>Not Found</title></html>"),
    /网页|HTML|非 JSON/,
  );
  assert.doesNotMatch(
    formatApiResponsePreview("text/html", "<!doctype html><html><title>Not Found</title></html>"),
    /Unexpected token/,
  );
});

test("fills priority gaps only when explicitly enabled for the first daily chat", () => {
  const reply = [
    "PLAN_ITEMS:",
    "- [PRIORITY] 完成课程学习",
    "- 整理桌面",
  ].join("\n");

  assert.deepEqual(
    completePriorityItems(parsePlanItems(reply), { fillPriorityGaps: true }),
    [
      "[PRIORITY] 完成课程学习",
      "整理桌面",
      "[PRIORITY] 读书",
      "[PRIORITY] 运动",
    ],
  );
});

test("does not add filler tasks to a reply without plan items", () => {
  assert.deepEqual(completePriorityItems(parsePlanItems("今天先聊聊目标。")), []);
});

test("completed priority tasks still count toward the first-chat target", () => {
  const items = ["[PRIORITY] 完成课程学习"];
  const existing = [
    { text: "写论文", priority: true, done: true },
    { text: "运动", priority: true },
  ];
  assert.deepEqual(
    completePriorityItems(items, {
      fillPriorityGaps: true,
      existingTasks: existing,
    }),
    items,
  );
});

test("preserves model plan items without promoting or appending fillers", () => {
  const items = ["[PRIORITY] 完成课程学习", "读书"];
  assert.deepEqual(completePriorityItems(items), items);
});

test("keeps only recent user and assistant messages for a new model request", () => {
  const messages = [
    { role: "system", content: "已添加任务" },
    ...Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `消息 ${index + 1}`,
    })),
  ];
  assert.deepEqual(
    sanitizeChatHistory(messages).map((message) => message.content),
    Array.from({ length: 8 }, (_, index) => `消息 ${index + 3}`),
  );
});

test("merges completed tasks into reflection without replacing manual notes", () => {
  const original = "今天的专注状态不错。";
  const merged = mergeCompletedTasksIntoReflection(original, [
    "完成课程学习",
    "运动 30 分钟",
  ]);
  assert.match(merged, /^今天的专注状态不错。/);
  assert.match(merged, /今日已完成任务（自动同步）/);
  assert.match(merged, /- 完成课程学习/);
  assert.equal(
    mergeCompletedTasksIntoReflection(merged, ["完成课程学习"]),
    "今天的专注状态不错。\n\n【今日已完成任务（自动同步）】\n- 完成课程学习\n【自动同步结束】",
  );
});

test("removes the managed reflection block when no tasks remain completed", () => {
  const content = mergeCompletedTasksIntoReflection("手写内容", ["任务 A"]);
  assert.equal(mergeCompletedTasksIntoReflection(content, []), "手写内容");
});

test("audit segments are scaled to recorded time instead of the full day", () => {
  assert.deepEqual(
    buildAuditSegments({
      core: 2 * 60000,
      maintenance: 13 * 60000,
      rest: 0,
      distraction: 1 * 60000,
    }),
    [
      { category: "core", durationMs: 120000, percentage: 12.5 },
      { category: "maintenance", durationMs: 780000, percentage: 81.25 },
      { category: "distraction", durationMs: 60000, percentage: 6.25 },
    ],
  );
});

test("completed tasks merge into one daily reflection entry in completion order", () => {
  const initial = [
    {
      id: "manual-1",
      date: "2026-06-22",
      content: "手写反思",
      kind: "manual",
      updatedAt: 1,
    },
    {
      id: "auto-1",
      date: "2026-06-22",
      content: "已完成：任务 A",
      kind: "completed-task",
      sourceTaskId: "a",
      updatedAt: 2,
    },
  ];
  const result = syncCompletedTaskEntries(
    initial,
    [
      { id: "a", text: "任务 A", done: true },
      { id: "b", text: "任务 B", done: true },
    ],
    "2026-06-22",
    10,
    () => "auto-2",
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].content, "手写反思");
  assert.equal(result[1].kind, "completed-task-summary");
  assert.equal(result[1].content, "已完成：任务 A\n已完成：任务 B");
  assert.equal(
    syncCompletedTaskEntries(result, [{ id: "b", text: "任务 B", done: true }], "2026-06-22", 20, () => "unused").length,
    2,
  );
});

test("uses completion timestamps instead of plan order for a new daily summary", () => {
  const result = syncCompletedTaskEntries([], [
    { id: "a", text: "先创建但后完成", done: true, createdAt: 1, completedAt: 20 },
    { id: "b", text: "后创建但先完成", done: true, createdAt: 2, completedAt: 10 },
  ], "2026-06-22", 30, () => "summary");
  assert.equal(result[0].content, "已完成：后创建但先完成\n已完成：先创建但后完成");
});

test("detects similar AI tasks while preserving distinct tasks", () => {
  const existing = [
    { id: "1", text: "完成鱼皮老师教程的学习内容" },
    { id: "2", text: "运动 30 分钟" },
  ];
  assert.equal(findSimilarTask("学习鱼皮老师教程", existing)?.id, "1");
  assert.equal(findSimilarTask("整理明天会议资料", existing), null);
});

test("does not treat different numbered study chapters as duplicate AI tasks", () => {
  const existing = [{ id: "chapter-4", text: "学习矩阵论第 4 章" }];
  assert.equal(findSimilarTask("学习矩阵论第 5 章", existing), null);
  assert.equal(findSimilarTask("学习矩阵论第5章", existing), null);
});

test("timeline segments preserve their absolute positions and gaps", () => {
  const start = new Date("2026-06-22T00:00:00+08:00").getTime();
  const end = start + 86400000;
  const segments = buildTimelineSegments(
    [
      { category: "core", start: start + 8 * 3600000, end: start + 8 * 3600000 + 40 * 60000 },
      { category: "maintenance", start: start + 8 * 3600000 + 40 * 60000, end: start + 8 * 3600000 + 45 * 60000 },
    ],
    start,
    end,
  );
  assert.ok(Math.abs(segments[0].leftPercentage - 100 / 3) < 1e-10);
  assert.ok(
    Math.abs(segments[0].widthPercentage - (40 / 1440) * 100) < 1e-10,
  );
  assert.ok(
    Math.abs(
      segments[1].leftPercentage - ((8 * 60 + 40) / 1440) * 100,
    ) < 1e-10,
  );
});

test("saved API profiles reuse stored keys and do not overwrite other profiles", () => {
  const existing = [
    {
      id: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "saved-key",
    },
    {
      id: "gemini",
      label: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.5-flash",
      apiKey: "gemini-key",
    },
  ];
  const updated = upsertApiProfile(
    existing,
    {
      id: "deepseek",
      label: "工作用 DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "",
    },
    () => "unused",
  );
  assert.equal(updated.activeProfileId, "deepseek");
  assert.equal(updated.apiKey, "saved-key");
  assert.equal(updated.profiles.length, 2);
  assert.equal(updated.profiles[0].label, "工作用 DeepSeek");
  assert.equal(updated.profiles[1].apiKey, "gemini-key");
});

test("saved API profiles can force a new profile for the same endpoint", () => {
  const existing = [
    {
      id: "gemini-a",
      label: "Gemini A",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
      apiKey: "key-a",
    },
  ];
  const updated = upsertApiProfile(
    existing,
    {
      label: "Gemini B",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
      apiKey: "key-b",
      forceNew: true,
    },
    () => "gemini-b",
  );
  assert.equal(updated.activeProfileId, "gemini-b");
  assert.equal(updated.profiles.length, 2);
  assert.equal(updated.profiles[0].apiKey, "key-a");
  assert.equal(updated.profiles[1].apiKey, "key-b");
});
