(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LongTaskUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const QUADRANTS = ["important-urgent", "important-not-urgent", "urgent-not-important", "not-important-not-urgent"];

  function cleanText(value, max = 120) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function parseObsidianImagePath(value) {
    const match = String(value || "").trim().match(/^!\[\[([a-z]:[\\/][^\]\r\n]+)\]\]$/i);
    if (!match || !/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(match[1])) return null;
    return match[1];
  }

  function imageInsertionLines(text, offset, imageMarkdownLines) {
    const source = String(text || "");
    const position = Math.min(source.length, Math.max(0, Number(offset) || 0));
    const before = source.slice(0, position);
    const after = source.slice(position);
    return [before, ...imageMarkdownLines, after].filter((line) => line !== "");
  }

  function clampOffset(text, offset) {
    const source = String(text || "");
    return Math.min(source.length, Math.max(0, Number(offset) || 0));
  }

  function splitNoteLineAtOffset(text, offset) {
    const source = String(text || "");
    const position = clampOffset(source, offset);
    return [source.slice(0, position), source.slice(position)];
  }

  function normalizeNoteSelection(lines, selection = {}) {
    const source = Array.isArray(lines) && lines.length ? lines.map((line) => String(line || "")) : [""];
    const maxLine = source.length - 1;
    const point = (line, offset) => {
      const index = Math.min(maxLine, Math.max(0, Number(line) || 0));
      return { line: index, offset: clampOffset(source[index], offset) };
    };
    const start = point(selection.startLine, selection.startOffset);
    const end = point(selection.endLine, selection.endOffset);
    if (start.line > end.line || (start.line === end.line && start.offset > end.offset)) {
      return { lines: source, start: end, end: start };
    }
    return { lines: source, start, end };
  }

  function replaceNoteSelection(lines, selection, replacement = "") {
    const normalized = normalizeNoteSelection(lines, selection);
    const source = normalized.lines;
    const insertLines = String(replacement || "").replace(/\r\n/g, "\n").split("\n");
    const prefix = source[normalized.start.line].slice(0, normalized.start.offset);
    const suffix = source[normalized.end.line].slice(normalized.end.offset);
    const nextLines = [
      ...source.slice(0, normalized.start.line),
      ...insertLines,
      ...source.slice(normalized.end.line + 1),
    ];
    const insertStart = normalized.start.line;
    const insertEnd = insertStart + insertLines.length - 1;
    nextLines[insertStart] = prefix + nextLines[insertStart];
    nextLines[insertEnd] = nextLines[insertEnd] + suffix;
    return {
      lines: nextLines.length ? nextLines : [""],
      caret: {
        line: insertEnd,
        offset: insertLines.length === 1
          ? prefix.length + insertLines[0].length
          : insertLines[insertLines.length - 1].length,
      },
    };
  }

  function selectedNoteText(lines, selection) {
    const normalized = normalizeNoteSelection(lines, selection);
    const source = normalized.lines;
    if (
      normalized.start.line === normalized.end.line
      && normalized.start.offset === normalized.end.offset
    ) {
      return "";
    }
    if (normalized.start.line === normalized.end.line) {
      return source[normalized.start.line].slice(normalized.start.offset, normalized.end.offset);
    }
    return [
      source[normalized.start.line].slice(normalized.start.offset),
      ...source.slice(normalized.start.line + 1, normalized.end.line),
      source[normalized.end.line].slice(0, normalized.end.offset),
    ].join("\n");
  }

  function indentNoteLines(lines, startLine, endLine, direction = 1) {
    const source = Array.isArray(lines) && lines.length ? lines.map((line) => String(line || "")) : [""];
    const start = Math.min(Math.max(0, Number(startLine) || 0), source.length - 1);
    const end = Math.min(Math.max(0, Number(endLine) || 0), source.length - 1);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    return source.map((line, index) => {
      if (index < from || index > to) return line;
      return direction > 0 ? `  ${line}` : line.replace(/^(?: {1,2}|\t)/, "");
    });
  }

  function mergeNoteLineBackward(lines, lineIndex) {
    const source = Array.isArray(lines) && lines.length ? lines.map((line) => String(line || "")) : [""];
    const index = Math.min(Math.max(0, Number(lineIndex) || 0), source.length - 1);
    if (index <= 0) {
      return {
        lines: source,
        caret: { line: 0, offset: clampOffset(source[0], 0) },
      };
    }
    const previous = source[index - 1];
    const current = source[index];
    const next = [
      ...source.slice(0, index - 1),
      `${previous}${current}`,
      ...source.slice(index + 1),
    ];
    return {
      lines: next,
      caret: { line: index - 1, offset: previous.length },
    };
  }

  function normalizeReminder(value = {}) {
    const kind = ["once", "daily", "weekly"].includes(value.kind) ? value.kind : "none";
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || "") ? value.time : "09:00";
    const weekdays = [...new Set((Array.isArray(value.weekdays) ? value.weekdays : []).map(Number).filter((day) => day >= 0 && day <= 6))].sort();
    const at = kind === "once" && !Number.isNaN(Date.parse(value.at)) ? new Date(value.at).toISOString() : null;
    return { kind: kind === "weekly" && !weekdays.length ? "none" : kind, time, weekdays, at, enabled: kind !== "none" && value.enabled !== false, lastTriggeredAt: Number(value.lastTriggeredAt) || null };
  }

  function normalizeTask(value = {}, now = Date.now()) {
    const title = cleanText(value.title);
    if (!title) throw new Error("长期任务标题不能为空。");
    return {
      id: cleanText(value.id, 80) || `lt-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      notes: String(value.notes || "").slice(0, 2_000_000),
      quadrant: QUADRANTS.includes(value.quadrant) ? value.quadrant : "important-not-urgent",
      status: ["completed", "planned"].includes(value.status) ? value.status : "active",
      reminder: normalizeReminder(value.reminder),
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
      createdAt: Number(value.createdAt) || now,
      updatedAt: now,
      completedAt: value.status === "completed" ? Number(value.completedAt) || now : null,
    };
  }

  function nextReminderAt(reminder, from = Date.now()) {
    const rule = normalizeReminder(reminder);
    if (!rule.enabled || rule.kind === "none") return null;
    if (rule.kind === "once") {
      const at = Date.parse(rule.at);
      return Number.isFinite(at) && at > from ? at : null;
    }
    const [hour, minute] = rule.time.split(":").map(Number);
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = new Date(from);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() <= from) continue;
      if (rule.kind === "daily" || rule.weekdays.includes(candidate.getDay())) return candidate.getTime();
    }
    return null;
  }

  function dueTasks(tasks, now = Date.now(), toleranceMs = 60000) {
    return (Array.isArray(tasks) ? tasks : []).filter((task) => {
      if (task.status !== "active" || !task.reminder?.enabled) return false;
      if (task.reminder.kind === "once") {
        const at = Date.parse(task.reminder.at);
        return Number.isFinite(at) && at <= now && (!task.reminder.lastTriggeredAt || task.reminder.lastTriggeredAt < at);
      }
      const previous = nextReminderAt(task.reminder, now - toleranceMs - 1);
      return previous !== null && previous <= now && (!task.reminder.lastTriggeredAt || task.reminder.lastTriggeredAt < previous);
    });
  }

  function extractJson(content) {
    const source = String(content || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const starts = [source.indexOf("{"), source.indexOf("[")].filter((index) => index >= 0);
    const start = Math.min(...starts);
    if (!Number.isFinite(start)) throw new Error("模型没有返回结构化结果。");
    const closing = source[start] === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = inString;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === source[start]) depth += 1;
      if (char === closing) depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
    throw new Error("模型返回的 JSON 不完整。");
  }

  function normalizeAiOperations(content, existingTasks = []) {
    const parsed = extractJson(content);
    const operations = Array.isArray(parsed) ? parsed : parsed.operations;
    if (!Array.isArray(operations)) throw new Error("模型变更列表无效。");
    const existingIds = new Set(existingTasks.map((task) => task.id));
    return operations.slice(0, 12).map((operation) => {
      const action = ["create", "update", "delete", "restore"].includes(operation.action) ? operation.action : "create";
      if (action !== "create" && !existingIds.has(operation.id)) throw new Error("模型引用了不存在的长期任务。");
      const existing = existingTasks.find((task) => task.id === operation.id) || {};
      return {
        action,
        id: cleanText(operation.id, 80),
        task: action === "delete" ? null : normalizeTask({ ...existing, ...operation.task, id: action === "create" ? "" : operation.id }),
      };
    });
  }

  function nextWeekdayDate(from, weekday, nextWeek = false) {
    const date = new Date(from);
    date.setHours(9, 0, 0, 0);
    const distance = (weekday - date.getDay() + 7) % 7;
    date.setDate(date.getDate() + distance + (nextWeek ? 7 : distance === 0 ? 7 : 0));
    return date;
  }

  function inferReminderFromText(text, now = Date.now()) {
    const source = String(text || "");
    if (!/提醒/.test(source)) return { kind: "none" };
    const weekdayMap = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const weekdayMatch = source.match(/(下周|下星期|本周|这周|星期|周)([日天一二三四五六])/);
    let at = null;
    if (weekdayMatch) {
      at = nextWeekdayDate(now, weekdayMap[weekdayMatch[2]], /^下/.test(weekdayMatch[1]));
    } else if (/明天/.test(source)) {
      at = new Date(now);
      at.setDate(at.getDate() + 1);
    } else if (/后天/.test(source)) {
      at = new Date(now);
      at.setDate(at.getDate() + 2);
    }
    if (!at) return { kind: "none" };
    if (/早上|上午/.test(source)) at.setHours(9, 0, 0, 0);
    else if (/中午/.test(source)) at.setHours(12, 0, 0, 0);
    else if (/下午/.test(source)) at.setHours(15, 0, 0, 0);
    else if (/晚上|晚/.test(source)) at.setHours(20, 0, 0, 0);
    const explicitTime = source.match(/([01]?\d|2[0-3])[:：点]([0-5]\d)?/);
    if (explicitTime) at.setHours(Number(explicitTime[1]), Number(explicitTime[2] || 0), 0, 0);
    const offsetDays = /提前一天/.test(source) ? 1 : /提前两天/.test(source) ? 2 : /提前三天/.test(source) ? 3 : 0;
    at.setDate(at.getDate() - offsetDays);
    return { kind: "once", at: at.toISOString(), time: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, weekdays: [] };
  }

  function inferTitleFromText(text) {
    return cleanText(String(text || "")
      .replace(/请(你)?/g, "")
      .replace(/帮我/g, "")
      .replace(/提醒我/g, "")
      .replace(/提前[一二三两0-9]+天/g, "")
      .replace(/(下周|下星期|本周|这周|星期|周)[日天一二三四五六]/g, "")
      .replace(/明天|后天|早上|上午|中午|下午|晚上|今晚|晚/g, "")
      .replace(/[，。,.；;：:]/g, " "), 80) || cleanText(text, 80);
  }

  function fallbackAiOperationsFromText(text, now = Date.now()) {
    const title = inferTitleFromText(text);
    if (!title) return [];
    const reminder = inferReminderFromText(text, now);
    const dueSoon = reminder.kind === "once" && Date.parse(reminder.at) - now <= 14 * 24 * 60 * 60 * 1000;
    return [{
      action: "create",
      id: "",
      task: normalizeTask({
        title,
        notes: "",
        quadrant: dueSoon ? "important-urgent" : "important-not-urgent",
        reminder,
      }, now),
    }];
  }

  function applyPriorityDecision(tasks, candidate, decision = {}) {
    const result = (Array.isArray(tasks) ? tasks : []).map((task) => ({ ...task }));
    const candidateTask = { ...candidate, priority: Boolean(decision.worthy), done: false };
    if (candidateTask.priority && decision.demoteId) {
      const demoted = result.find((task) => task.id === decision.demoteId && task.priority);
      if (demoted) demoted.priority = false;
    }
    result.push(candidateTask);
    return result;
  }

  function activeTasksForQuadrant(tasks, quadrant) {
    if (!QUADRANTS.includes(quadrant)) return [];
    return (Array.isArray(tasks) ? tasks : [])
      .filter((task) => task?.status === "active" && task.quadrant === quadrant)
      .slice()
      .sort((a, b) => (Number(a.order) - Number(b.order)) || (Number(a.createdAt) - Number(b.createdAt)));
  }

  function detailReturnView(view = {}) {
    const quadrant = QUADRANTS.includes(view.quadrant) ? view.quadrant : null;
    if (view.returnMode === "quadrant" && quadrant) return { mode: "quadrant", quadrant, taskId: null };
    return { mode: "board", quadrant: null, taskId: null };
  }

  function newTaskDefaultsForView(view = {}) {
    return view.mode === "quadrant" && QUADRANTS.includes(view.quadrant) ? { quadrant: view.quadrant } : {};
  }

  function resolveLongTaskView(view = {}, tasks = []) {
    const quadrant = QUADRANTS.includes(view.quadrant) ? view.quadrant : null;
    if (view.mode === "detail" && quadrant && view.taskId) {
      const task = (Array.isArray(tasks) ? tasks : []).find((item) => item?.id === view.taskId && item.status === "active");
      const returnMode = view.returnMode === "board" ? "board" : "quadrant";
      if (task) return { mode: "detail", quadrant: task.quadrant, taskId: task.id, returnMode, task };
      return { ...detailReturnView({ quadrant, returnMode }), task: null };
    }
    if (view.mode === "quadrant" && quadrant) {
      return { mode: "quadrant", quadrant, taskId: null, task: null };
    }
    return { mode: "board", quadrant: null, taskId: null, task: null };
  }

  return { QUADRANTS, activeTasksForQuadrant, applyPriorityDecision, detailReturnView, dueTasks, extractJson, fallbackAiOperationsFromText, imageInsertionLines, indentNoteLines, mergeNoteLineBackward, newTaskDefaultsForView, nextReminderAt, normalizeAiOperations, normalizeReminder, normalizeTask, parseObsidianImagePath, replaceNoteSelection, resolveLongTaskView, selectedNoteText, splitNoteLineAtOffset };
});
