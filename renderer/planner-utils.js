(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlannerUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const API_MODEL_PRESETS = [
    {
      id: "openrouter-gpt-oss-120b-free",
      provider: "OpenRouter",
      label: "NVIDIA Nemotron 3 Super 120B Free",
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      baseUrl: "https://openrouter.ai/api/v1",
    },
    {
      id: "openrouter-free-router",
      provider: "OpenRouter",
      label: "Free Models Router",
      model: "openrouter/free",
      baseUrl: "https://openrouter.ai/api/v1",
    },
    {
      id: "openai-gpt-5-mini",
      provider: "OpenAI",
      label: "GPT-5 mini",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "openai-gpt-5-2",
      provider: "OpenAI",
      label: "GPT-5.2",
      model: "gpt-5.2",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "openai-gpt-4-1-mini",
      provider: "OpenAI",
      label: "GPT-4.1 mini",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "openai-gpt-4o-mini",
      provider: "OpenAI",
      label: "GPT-4o mini",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "deepseek-v4-flash",
      provider: "DeepSeek",
      label: "DeepSeek V4 Flash",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
    },
    {
      id: "deepseek-v4-pro",
      provider: "DeepSeek",
      label: "DeepSeek V4 Pro",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com",
    },
    {
      id: "gemini-2-0-flash-free",
      provider: "Google Gemini",
      label: "Gemini 2.0 Flash (Free Tier)",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    {
      id: "gemini-2-0-flash-lite-free",
      provider: "Google Gemini",
      label: "Gemini 2.0 Flash Lite (Free Tier)",
      model: "gemini-2.0-flash-lite",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    {
      id: "qwen-plus",
      provider: "通义千问",
      label: "Qwen Plus",
      model: "qwen-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
      id: "qwen-max",
      provider: "通义千问",
      label: "Qwen Max",
      model: "qwen-max",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  ];

  function getApiModelPreset(id) {
    return API_MODEL_PRESETS.find((preset) => preset.id === id) || null;
  }

  function matchApiModelPreset(model, baseUrl) {
    const normalizedUrl = String(baseUrl || "").replace(/\/+$/, "");
    return (
      API_MODEL_PRESETS.find(
        (preset) =>
          preset.model === model && preset.baseUrl === normalizedUrl,
      ) || null
    );
  }

  function sanitizeChatHistory(messages, limit = 8) {
    return (Array.isArray(messages) ? messages : [])
      .filter(
        (message) =>
          ["user", "assistant"].includes(message?.role) &&
          typeof message.content === "string" &&
          message.content.trim(),
      )
      .slice(-limit)
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }));
  }

  const REFLECTION_AUTO_START = "【今日已完成任务（自动同步）】";
  const REFLECTION_AUTO_END = "【自动同步结束】";

  function mergeCompletedTasksIntoReflection(content, completedTasks) {
    const source = String(content || "");
    const start = REFLECTION_AUTO_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const end = REFLECTION_AUTO_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const manualContent = source
      .replace(new RegExp(`\\s*${start}[\\s\\S]*?${end}\\s*`, "g"), "\n\n")
      .trim();
    const tasks = [
      ...new Set(
        (Array.isArray(completedTasks) ? completedTasks : [])
          .map((task) => String(task || "").trim())
          .filter(Boolean),
      ),
    ];
    if (!tasks.length) return manualContent;
    const block = [
      REFLECTION_AUTO_START,
      ...tasks.map((task) => `- ${task}`),
      REFLECTION_AUTO_END,
    ].join("\n");
    return [manualContent, block].filter(Boolean).join("\n\n");
  }

  function buildAuditSegments(sums) {
    const categories = ["core", "maintenance", "rest", "distraction"];
    const used = categories.reduce(
      (total, category) => total + Math.max(0, Number(sums?.[category]) || 0),
      0,
    );
    if (!used) return [];
    return categories
      .map((category) => ({
        category,
        durationMs: Math.max(0, Number(sums?.[category]) || 0),
      }))
      .filter((segment) => segment.durationMs > 0)
      .map((segment) => ({
        ...segment,
        percentage: (segment.durationMs / used) * 100,
      }));
  }

  function buildTimelineSegments(entries, periodStart, periodEnd) {
    const duration = periodEnd - periodStart;
    if (!Number.isFinite(duration) || duration <= 0) return [];
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const start = Math.max(periodStart, Number(entry.start) || 0);
        const end = Math.min(periodEnd, Number(entry.end) || 0);
        if (end <= start) return null;
        return {
          category: entry.category,
          start,
          end,
          durationMs: end - start,
          leftPercentage: ((start - periodStart) / duration) * 100,
          widthPercentage: ((end - start) / duration) * 100,
        };
      })
      .filter(Boolean);
  }

  function normalizeTaskForSimilarity(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/完成|今天|今日|计划|任务|进行|一下|内容|学习/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function taskSimilarity(left, right) {
    const a = normalizeTaskForSimilarity(left);
    const b = normalizeTaskForSimilarity(right);
    if (!a || !b) return 0;
    const leftNumbers = numberedTaskTokens(left);
    const rightNumbers = numberedTaskTokens(right);
    if (leftNumbers.length && rightNumbers.length && leftNumbers.join("|") !== rightNumbers.join("|")) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))
      return 0.9;
    const aChars = new Set(a);
    const bChars = new Set(b);
    const shared = [...aChars].filter((char) => bChars.has(char)).length;
    return shared / (aChars.size + bChars.size - shared);
  }

  function numberedTaskTokens(value) {
    return String(value || "")
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .match(/\d+/g) || [];
  }

  function formatApiResponsePreview(contentType = "", body = "") {
    const text = String(body || "").replace(/\s+/g, " ").trim();
    if (/html/i.test(contentType) || /^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text)) {
      return "服务返回了网页/HTML 内容，不是 OpenAI 兼容接口需要的 JSON。请检查 API Base URL 是否填写到 /api/v1 或兼容接口根路径，或确认该模型服务是否可用。";
    }
    if (!text) return "服务没有返回错误正文。";
    return text.slice(0, 300);
  }

  function findSimilarTask(text, tasks, threshold = 0.58) {
    let best = null;
    let bestScore = threshold;
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
      const score = taskSimilarity(text, task?.text);
      if (score >= bestScore) {
        best = task;
        bestScore = score;
      }
    });
    return best;
  }

  function syncCompletedTaskEntries(
    entries,
    tasks,
    date,
    now = Date.now(),
    idFactory = () => `${now}-${Math.random().toString(36).slice(2, 8)}`,
  ) {
    const result = (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry }));
    const isCompletedEntry = (entry) =>
      entry.date === date && ["completed-task", "completed-task-summary"].includes(entry.kind);
    const existingEntries = result.filter(isCompletedEntry).sort(
      (left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0),
    );
    const ordered = [];
    const knownTexts = new Set();
    const sourceTaskIds = [];
    const append = (text, taskId = "") => {
      const clean = String(text || "").replace(/^已完成[：:]\s*/, "").trim();
      if (!clean || knownTexts.has(clean)) return;
      knownTexts.add(clean);
      ordered.push(clean);
      if (taskId) sourceTaskIds.push(taskId);
    };

    existingEntries.forEach((entry) => {
      String(entry.content || "").split("\n").forEach((line) => append(line));
      if (entry.sourceTaskId) sourceTaskIds.push(entry.sourceTaskId);
      (entry.sourceTaskIds || []).forEach((id) => sourceTaskIds.push(id));
    });
    (Array.isArray(tasks) ? tasks : [])
      .filter((task) => task.done && task.id && task.text)
      .sort(
        (left, right) =>
          Number(left.completedAt || left.createdAt || 0) -
          Number(right.completedAt || right.createdAt || 0),
      )
      .forEach((task) => append(task.text, task.id));

    if (!ordered.length) return result;
    const retained = result.filter((entry) => !isCompletedEntry(entry));
    const previousContent = existingEntries.map((entry) => entry.content).join("\n");
    const content = ordered.map((text) => `已完成：${text}`).join("\n");
    retained.push({
      id: existingEntries[0]?.id || idFactory(),
      date,
      content,
      kind: "completed-task-summary",
      sourceTaskIds: [...new Set(sourceTaskIds)],
      updatedAt:
        content === previousContent
          ? Math.max(...existingEntries.map((entry) => Number(entry.updatedAt || 0)))
          : now,
    });
    return retained;
  }

  function upsertApiProfile(profiles, input, idFactory) {
    const result = (Array.isArray(profiles) ? profiles : []).map((profile) => ({
      ...profile,
    }));
    let profile = result.find((item) => item.id === input?.id);
    if (!profile && !input?.forceNew) {
      profile = result.find(
        (item) =>
          item.baseUrl === input?.baseUrl && item.model === input?.model,
      );
    }
    if (!profile) {
      profile = { id: idFactory() };
      result.push(profile);
    }
    profile.label = String(input?.label || input?.model || "API 配置").trim();
    profile.baseUrl = input.baseUrl;
    profile.model = input.model;
    profile.apiKey = input.apiKey || profile.apiKey || "";
    return { profiles: result, activeProfileId: profile.id, apiKey: profile.apiKey };
  }

  function parsePlanItems(content) {
    const source = String(content || "");
    const jsonItems = parsePlanItemsFromJson(source);
    if (jsonItems.length) return jsonItems;
    const marker = source.match(
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?PLAN_ITEMS\s*[:：]?(?:\*\*)?\s*\n([\s\S]*)$/i,
    );
    const lines = source.split("\n");
    const candidate = marker
      ? marker[1]
      : lines.some((line) => /\[PRIORITY\]/i.test(line))
        ? lines.filter((line) => /\[PRIORITY\]/i.test(line)).join("\n")
        : lines.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).join("\n");
    const items = candidate
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*•]|^\d+[.)]/.test(line))
      .map((line) =>
        line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, ""),
      )
      .map((line) => line.replace(/^\*\*(\[PRIORITY\])\*\*/i, "$1"))
      .map((line) => line.trim())
      .filter(isMeaningfulPlanItem);

    return items;
  }

  function parsePlanItemsFromJson(content) {
    const source = String(content || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const candidates = [];
    const firstObject = source.indexOf("{");
    const firstArray = source.indexOf("[");
    [firstObject, firstArray]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)
      .forEach((start) => {
        const endChar = source[start] === "{" ? "}" : "]";
        const end = source.lastIndexOf(endChar);
        if (end > start) candidates.push(source.slice(start, end + 1));
      });
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const rawItems = Array.isArray(parsed)
          ? parsed
          : parsed.plan_items || parsed.planItems || parsed.tasks || parsed.items;
        if (!Array.isArray(rawItems)) continue;
        return rawItems
          .map((item) => typeof item === "string" ? item : item?.text || item?.title || item?.task)
          .map((item) => String(item || "").trim())
          .filter(isMeaningfulPlanItem);
      } catch {
        // Try the next candidate.
      }
    }
    return [];
  }

  function isMeaningfulPlanItem(item) {
    const text = String(item || "")
      .replace(/^\[PRIORITY\]\s*/i, "")
      .trim();
    if (text.length < 2) return false;
    if (/^[\s[\]{}()（）,，.。:：;；'"`-]+$/.test(text)) return false;
    if (/^(null|undefined|none|无)$/i.test(text)) return false;
    return /[\p{L}\p{N}]/u.test(text);
  }

  function cleanFallbackTask(segment) {
    let text = String(segment || "")
      .replace(/\s+/g, " ")
      .replace(/^(我)?(今天|今日)?(先)?/g, "")
      .replace(/^(先|然后|再|接着|之后|并且|同时)/g, "")
      .replace(/^(去|去一趟|做一下)/g, "")
      .replace(/^把(.+?)(过完|看完|整理完|处理完)$/g, "$2$1")
      .replace(/^把/g, "")
      .replace(/看个/g, "看")
      .trim();
    text = text.replace(/[，。,.；;：:、]+$/g, "").trim();
    if (/^(我|今天|今日|安排|计划|任务)$/.test(text)) return "";
    return text.slice(0, 80);
  }

  function fallbackPlanItemsFromText(text) {
    const source = String(text || "").trim();
    if (!source) return [];
    const segments = source
      .replace(/然后再/g, "然后")
      .split(/(?:，|,|。|；|;|\n|然后|再|接着|之后|并且|同时)+/g)
      .map(cleanFallbackTask)
      .filter(isMeaningfulPlanItem);
    return [...new Set(segments)].slice(0, 8);
  }

  function completePriorityItems(items, options = {}) {
    if (!Array.isArray(items) || !items.length) return [];
    const result = [...items];
    if (!options.fillPriorityGaps) return result;

    const cleanText = (item) =>
      String(item || "")
        .replace(/^\[PRIORITY\]\s*/i, "")
        .trim()
        .toLowerCase();
    const existingTasks = Array.isArray(options.existingTasks)
      ? options.existingTasks
      : [];
    const priorityTexts = new Set(
      existingTasks
        .filter((task) => task.priority)
        .map((task) => cleanText(task.text)),
    );
    result.forEach((item) => {
      if (/^\[PRIORITY\]/i.test(item)) priorityTexts.add(cleanText(item));
    });
    for (const fallback of ["读书", "运动"]) {
      if (priorityTexts.size >= 3) break;
      const key = cleanText(fallback);
      if (priorityTexts.has(key)) continue;
      const resultIndex = result.findIndex((item) => cleanText(item) === key);
      if (resultIndex >= 0) result[resultIndex] = `[PRIORITY] ${fallback}`;
      else result.push(`[PRIORITY] ${fallback}`);
      priorityTexts.add(key);
    }
    return result;
  }

  return {
    API_MODEL_PRESETS,
    buildAuditSegments,
    buildTimelineSegments,
    completePriorityItems,
    formatApiResponsePreview,
    findSimilarTask,
    getApiModelPreset,
    matchApiModelPreset,
    mergeCompletedTasksIntoReflection,
    fallbackPlanItemsFromText,
    parsePlanItems,
    sanitizeChatHistory,
    syncCompletedTaskEntries,
    upsertApiProfile,
  };
});
