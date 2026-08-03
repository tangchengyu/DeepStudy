const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const KEYS = {
  dailyPlan: "mytimer.dailyPlan.v1",
  chat: "mytimer.plannerChat.v1",
  sessions: "mytimer.focusSessions.v1",
  distractions: "mytimer.distractionList.v1",
  tracker: "mytimer.focusTracker.v1",
  audit: "mytimer.timeAudit.v1",
  reflections: "mytimer.dailyReflection.v1",
  gate: "mytimer.gateEntered.v1",
  soulQuotes: "deepstudy.soulQuotes.v1",
  defaultSoulQuotesEnabled: "deepstudy.defaultSoulQuotes.enabled.v1",
};

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function todayKey(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}
function formatClock(ms, hundredths = false) {
  const n = Math.max(0, ms);
  const total = Math.floor(n / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return hundredths
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(Math.floor((n % 1000) / 10))}`
    : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function formatMinutes(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
function formatFlexibleClock(ms) {
  const value = formatClock(ms);
  return ms >= 3600000 ? value : value.slice(3);
}
function isTyping(event) {
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) ||
    event.target?.isContentEditable
  );
}
const PlannerBridge = ElectronBridge.createElectronBridge(window.electronAPI);

function alarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.3, 0.6].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + offset + 0.18,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch (error) {
    console.warn(error);
  }
}

function playFocusRestPrompt() {
  const prompt = $("#audio-focus-rest-prompt");
  if (!prompt) return;
  try {
    prompt.pause();
    prompt.currentTime = 0;
    prompt.play().catch((error) => console.warn(error));
  } catch (error) {
    console.warn(error);
  }
}

function playReminderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    gain.connect(ctx.destination);
    for (let offset = 0; offset < 3; offset += 0.5) {
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = offset % 1 ? 720 : 880;
      oscillator.connect(gain);
      oscillator.start(ctx.currentTime + offset);
      oscillator.stop(ctx.currentTime + offset + 0.22);
    }
    setTimeout(() => ctx.close(), 3200);
  } catch (error) { console.warn(error); }
}

const FocusTracker = (() => {
  function log(state, details = {}) {
    const items = readJSON(KEYS.tracker, []);
    items.push({ id: createId(), state, timestamp: Date.now(), ...details });
    writeJSON(KEYS.tracker, items.slice(-500));
  }
  return { log };
})();

const TimeAudit = (() => {
  function add(
    category,
    durationMs,
    start = Date.now() - durationMs,
    details = {},
  ) {
    if (durationMs < 1000) return;
    const items = readJSON(KEYS.audit, []);
    items.push({
      id: createId(),
      category,
      durationMs: Math.round(durationMs),
      start,
      end: start + durationMs,
      ...details,
    });
    writeJSON(KEYS.audit, items.slice(-3000));
    render();
  }
  function scopeBounds(days) {
    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);
    const start =
      days === 1
        ? startDay.getTime()
        : startDay.getTime() - (days - 1) * 86400000;
    return { start, end: start + days * 86400000 };
  }
  function scoped(days) {
    const { start } = scopeBounds(days);
    const end = Date.now();
    return readJSON(KEYS.audit, [])
      .filter((x) => x.end >= start && x.start <= end)
      .map((x) => {
        const clippedStart = Math.max(start, x.start);
        const clippedEnd = Math.min(end, x.end);
        return {
          ...x,
          start: clippedStart,
          end: clippedEnd,
          durationMs: Math.max(0, clippedEnd - clippedStart),
        };
      })
      .filter((x) => x.durationMs > 0)
      .sort((a, b) => a.start - b.start);
  }
  function aggregate(entries) {
    const sums = { core: 0, maintenance: 0, rest: 0, distraction: 0 };
    entries.forEach((x) => {
      if (sums[x.category] !== undefined) sums[x.category] += x.durationMs;
    });
    return sums;
  }
  function block(title, days, baseline) {
    const entries = scoped(days);
    const bounds = scopeBounds(days);
    const sums = aggregate(entries);
    const used = Object.values(sums).reduce((a, b) => a + b, 0);
    const remaining = Math.max(0, baseline - used);
    const labels = [
      ["core", "核心工作"],
      ["maintenance", "维持工作"],
      ["rest", "主动休息"],
      ["distraction", "分心"],
    ];
    const segments = PlannerUtils.buildTimelineSegments(
      entries,
      bounds.start,
      bounds.end,
    )
      .map(
        (segment) =>
          `<div class="audit-segment ${segment.category}" style="left:${segment.leftPercentage}%;width:${segment.widthPercentage}%" title="${new Intl.DateTimeFormat("zh-CN", { month: days === 1 ? undefined : "numeric", day: days === 1 ? undefined : "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(segment.start))}–${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(segment.end))} · ${formatMinutes(segment.durationMs)}"></div>`,
      )
      .join("");
    const tickCount = days === 1 ? 4 : 7;
    const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
      const time = bounds.start + ((bounds.end - bounds.start) * index) / tickCount;
      const label =
        days === 1
          ? `${String(index * 6).padStart(2, "0")}:00`
          : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time));
      return `<span style="left:${(index / tickCount) * 100}%">${label}</span>`;
    }).join("");
    const legend =
      labels
        .map(
          ([key, label]) =>
            `<div class="legend-item"><i class="legend-dot audit-segment ${key}"></i>${label}<br><strong>${formatMinutes(sums[key])}</strong></div>`,
        )
        .join("") +
      `<div class="legend-item"><i class="legend-dot"></i>剩余<br><strong>${formatMinutes(remaining)}</strong></div>`;
    return `<div class="audit-block"><div class="audit-heading"><strong>${title}</strong><span>已记录 ${formatMinutes(used)}</span></div><div class="audit-track" aria-label="实际时间线">${segments}</div><div class="audit-ruler">${ticks}</div><div class="audit-legend">${legend}</div></div>`;
  }
  function render() {
    const root = $("#time-audit");
    if (root)
      root.innerHTML =
        block("今日 · 24 小时", 1, 86400000) +
        block("近 7 天 · 168 小时", 7, 604800000);
    const status = $("#audit-refresh-status");
    if (status)
      status.textContent = `每 10 分钟刷新 · ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  }
  return { add, render };
})();

const DailyPlan = (() => {
  let state = readJSON(KEYS.dailyPlan, { date: todayKey(), tasks: [] });
  if (state.date !== todayKey() || !Array.isArray(state.tasks))
    state = { date: todayKey(), tasks: [] };
  state.tasks.forEach((task, index) => {
    if (!Number.isFinite(Number(task.order))) task.order = index;
  });
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeJSON(KEYS.dailyPlan, state);
      window.electronAPI?.syncDailyPlan({ date: state.date, tasks: state.tasks }).catch(() => {});
    }, 0);
  };
  let undoTimer = null;
  let lastCheckboxAction = null;
  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "undo-complete-button";
  undoButton.hidden = true;
  undoButton.textContent = "撤回完成状态";
  $("#daily-plan-sidebar").append(undoButton);
  function showCheckboxUndo(action) {
    lastCheckboxAction = action;
    undoButton.hidden = false;
    undoButton.textContent = `撤回：${action.text}`;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      undoButton.hidden = true;
      lastCheckboxAction = null;
    }, 10000);
  }
  undoButton.addEventListener("click", () => {
    if (!lastCheckboxAction) return;
    const task = state.tasks.find((item) => item.id === lastCheckboxAction.id);
    if (task) {
      task.done = lastCheckboxAction.previousDone;
      task.completedAt = lastCheckboxAction.previousCompletedAt;
      save();
      render();
      Reflections.syncCompletedTasks(state.tasks);
    }
    undoButton.hidden = true;
    lastCheckboxAction = null;
    clearTimeout(undoTimer);
  });
  save();
  function parse(value) {
    const raw = String(value || "")
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();
    const priority = /^\[PRIORITY\]/i.test(raw);
    return {
      text: raw
        .replace(/^\[PRIORITY\]\s*/i, "")
        .replace(/\s+/g, " ")
        .slice(0, 120),
      priority,
    };
  }
  function addTasks(items, options = {}) {
    const existing = new Map(state.tasks.map((x) => [x.text.toLowerCase(), x]));
    const limitPriority = options.limitPriority === true;
    let availablePrioritySlots = limitPriority
      ? Math.max(0, 3 - state.tasks.filter((task) => task.priority).length)
      : Infinity;
    let nextOrder = Math.max(-1, ...state.tasks.map((task) => Number(task.order) || 0)) + 1;
    const added = [];
    (Array.isArray(items) ? items : [items]).forEach((item) => {
      const parsed = typeof item === "object" ? item : parse(item);
      if (!parsed.text) return;
      const existingTask = existing.get(parsed.text.toLowerCase());
      if (existingTask) {
        if (
          parsed.priority &&
          !existingTask.priority &&
          (!limitPriority || availablePrioritySlots > 0)
        ) {
          existingTask.priority = true;
          if (limitPriority) availablePrioritySlots -= 1;
          added.push(existingTask);
        }
        return;
      } else if (options.confirmSimilar) {
        const similarTask = PlannerUtils.findSimilarTask(parsed.text, state.tasks);
        if (similarTask) return;
      }
      const priority = Boolean(parsed.priority) && (!limitPriority || availablePrioritySlots > 0);
      if (priority && limitPriority) availablePrioritySlots -= 1;
      const task = {
        id: createId(),
        text: parsed.text,
        priority,
        done: false,
        createdAt: Date.now(),
        order: nextOrder,
      };
      nextOrder += 1;
      state.tasks.push(task);
      existing.set(task.text.toLowerCase(), task);
      added.push(task);
    });
    if (added.length) {
      save();
      render();
    }
    return added;
  }
  function getTasks() {
    return state.tasks.map((x) => ({ ...x }));
  }
  function orderedTasks() {
    return [...state.tasks].sort(
      (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0),
    );
  }
  function normalizeOrder() {
    const sorted = orderedTasks();
    const needsUpdate = sorted.some(
      (task, index) => (Number(task.order) || 0) !== index,
    );
    if (!needsUpdate) return;
    state.tasks = sorted.map((task, index) => ({ ...task, order: index }));
  }
  function togglePriority(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    task.priority = !task.priority;
    save();
    render();
  }
  function moveTaskBefore(taskId, beforeId) {
    if (!taskId || taskId === beforeId) return;
    const ordered = orderedTasks();
    const moving = ordered.find((task) => task.id === taskId);
    if (!moving) return;
    const rest = ordered.filter((task) => task.id !== taskId);
    const index = beforeId ? rest.findIndex((task) => task.id === beforeId) : -1;
    if (index >= 0) rest.splice(index, 0, moving);
    else rest.push(moving);
    state.tasks = rest.map((task, order) => ({ ...task, order }));
    save();
    render();
  }
  function render() {
    $("#plan-date").textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date());
    const list = $("#plan-list");
    list.replaceChildren();
    $("#plan-empty").hidden = state.tasks.length > 0;
    $("#clear-completed").disabled = !state.tasks.some((x) => x.done);
    $("#reset-plan").disabled = !state.tasks.length;
    normalizeOrder();
    orderedTasks()
      .forEach((task) => {
        const li = document.createElement("li");
        li.className = `plan-item${task.priority ? " priority" : ""}${task.done ? " completed" : ""}`;
        li.draggable = true;
        li.dataset.id = task.id;
        li.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-deepstudy-daily-task", task.id);
          li.classList.add("dragging");
        });
        li.addEventListener("dragend", () => {
          li.classList.remove("dragging");
          clearDragPlaceholder();
        });
        li.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          showTaskMenu(task, event.clientX, event.clientY);
        });
        const handle = document.createElement("span");
        handle.className = "task-drag-handle";
        handle.title = "拖动排序";
        const label = document.createElement("label");
        label.className = "plan-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = task.done;
        check.addEventListener("change", () => {
          const previousDone = task.done;
          const previousCompletedAt = task.completedAt || null;
          task.done = check.checked;
          task.completedAt = check.checked ? Date.now() : null;
          showCheckboxUndo({
            id: task.id,
            text: task.text,
            previousDone,
            previousCompletedAt,
          });
          save();
          render();
          Reflections.syncCompletedTasks(state.tasks);
        });
        const span = document.createElement("span");
        if (task.priority) {
          const star = document.createElement("b");
          star.className = "priority-star";
          star.textContent = "⭐";
          span.append(star);
        }
        span.append(document.createTextNode(task.text));
        label.append(check, span);
        const remove = document.createElement("button");
        remove.className = "task-remove";
        remove.type = "button";
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          state.tasks = state.tasks.filter((x) => x.id !== task.id);
          save();
          render();
        });
        li.append(handle, label, remove);
        list.append(li);
      });
  }
  const contextMenu = document.createElement("div");
  contextMenu.className = "task-context-menu";
  contextMenu.hidden = true;
  document.body.append(contextMenu);
  function hideTaskMenu() {
    contextMenu.hidden = true;
  }
  function showTaskMenu(task, x, y) {
    contextMenu.replaceChildren();
    const priority = document.createElement("button");
    priority.type = "button";
    priority.textContent = task.priority ? "取消优先任务" : "加入优先任务";
    priority.addEventListener("click", () => {
      togglePriority(task.id);
      hideTaskMenu();
    });
    contextMenu.append(priority);
    contextMenu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - 44)}px`;
    contextMenu.hidden = false;
  }
  function dropTargetId(event) {
    const items = [...$("#plan-list").querySelectorAll(".plan-item:not(.dragging)")];
    const target = items.find((item) => {
      const rect = item.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return target?.dataset.id || "";
  }
  const dragPlaceholder = document.createElement("li");
  dragPlaceholder.className = "plan-item-placeholder";
  function placeholderTargetId() {
    if (dragPlaceholder.parentElement !== $("#plan-list")) return "";
    return dragPlaceholder.nextElementSibling?.dataset.id || "";
  }
  function updateDragPlaceholder(event) {
    const list = $("#plan-list");
    const items = [...list.querySelectorAll(".plan-item:not(.dragging)")];
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    if (index < items.length) {
      list.insertBefore(dragPlaceholder, items[index]);
    } else {
      list.append(dragPlaceholder);
    }
  }
  function clearDragPlaceholder() {
    dragPlaceholder.remove();
  }
  async function handleLongTaskDrop(event) {
    const types = Array.from(event.dataTransfer.types || []);
    if (
      !types.includes("application/x-deepstudy-long-task") &&
      !types.includes("text/plain")
    ) {
      return false;
    }
    const raw = event.dataTransfer.getData("application/x-deepstudy-long-task");
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = null; }
    }
    if (!payload?.id) {
      const plain = event.dataTransfer.getData("text/plain");
      if (!/^lt-/.test(String(plain || ""))) return false;
      payload = await window.electronAPI?.getLongTaskDragPayload?.();
    }
    if (!payload?.id || !payload.title) return false;
    event.preventDefault();
    const added = addTasks({ text: payload.title, priority: false }, { confirmSimilar: true });
    if (!added.length) return true;
    await window.electronAPI?.moveLongTaskToDailyPlan({ id: payload.id }).catch((error) => alert(error.message));
    return true;
  }
  $(".plan-list-wrap").addEventListener("dragover", (event) => {
    const types = Array.from(event.dataTransfer.types || []);
    const acceptsDaily = types.includes("application/x-deepstudy-daily-task");
    const acceptsLongTask = types.includes("application/x-deepstudy-long-task");
    const acceptsText = types.includes("text/plain");
    if (!acceptsDaily && !acceptsLongTask && !acceptsText) return;
    event.preventDefault();
    $(".plan-list-wrap").classList.add("drag-over");
    if (acceptsDaily) updateDragPlaceholder(event);
  });
  $(".plan-list-wrap").addEventListener("dragleave", (event) => {
    if (!$(".plan-list-wrap").contains(event.relatedTarget)) {
      $(".plan-list-wrap").classList.remove("drag-over");
      clearDragPlaceholder();
    }
  });
  $(".plan-list-wrap").addEventListener("drop", async (event) => {
    $(".plan-list-wrap").classList.remove("drag-over");
    if (await handleLongTaskDrop(event)) {
      clearDragPlaceholder();
      return;
    }
    const taskId = event.dataTransfer.getData("application/x-deepstudy-daily-task");
    if (taskId) {
      event.preventDefault();
      const beforeId = placeholderTargetId() || dropTargetId(event);
      clearDragPlaceholder();
      moveTaskBefore(taskId, beforeId);
      return;
    }
    clearDragPlaceholder();
  });
  document.addEventListener("click", hideTaskMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideTaskMenu(); });
  function submitQuickTask(event) {
    event.preventDefault();
    const input = $("#plan-input");
    if (addTasks(input.value).length) input.value = "";
  }
  function restoreTextEntryFocus() {
    requestAnimationFrame(() => {
      const planner = $("#planner-chat").hidden ? null : $("#planner-input");
      (planner || $("#plan-input")).focus();
    });
  }
  function confirmReset() {
    const modal = $("#reset-confirm-modal");
    const ok = $("#reset-confirm-ok");
    const cancel = $("#reset-confirm-cancel");
    return new Promise((resolve) => {
      const finish = (confirmed) => {
        modal.hidden = true;
        ok.removeEventListener("click", onOk);
        cancel.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKeydown);
        restoreTextEntryFocus();
        resolve(confirmed);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onBackdrop = (event) => {
        if (event.target === modal) finish(false);
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Enter") finish(true);
      };
      ok.addEventListener("click", onOk);
      cancel.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKeydown);
      modal.hidden = false;
      requestAnimationFrame(() => ok.focus());
    });
  }
  $("#plan-add-form").addEventListener("submit", submitQuickTask);
  $("#clear-completed").addEventListener("click", () => {
    state.tasks = state.tasks.filter((x) => !x.done);
    save();
    render();
  });
  $("#reset-plan").addEventListener("click", async () => {
    if (state.tasks.length && await confirmReset()) {
      state.tasks = [];
      save();
      render();
    }
  });
  window.electronAPI?.onDailyPlanReplace((snapshot) => {
    if (!snapshot || snapshot.date !== todayKey() || !Array.isArray(snapshot.tasks)) return;
    state = { date: snapshot.date, tasks: snapshot.tasks };
    save();
    render();
  });
  window.electronAPI?.onDailyPlanAdd((payload) => {
    const added = addTasks(
      { text: payload?.text || payload?.title, priority: Boolean(payload?.priority) },
      { confirmSimilar: true },
    );
    if (added.length) Reflections.syncCompletedTasks(state.tasks);
  });
  window.electronAPI?.syncDailyPlan({ date: state.date, tasks: state.tasks }).catch(() => {});
  render();
  return { addTasks, getTasks };
})();

const PlannerSettings = (() => {
  const modal = $("#planner-settings-modal");
  const status = $("#planner-settings-status");
  let apiProfiles = [];
  let applyingProfile = false;

  function populateApiPresets() {
    const select = $("#api-model-preset");
    const groups = new Map();
    PlannerUtils.API_MODEL_PRESETS.forEach((preset) => {
      if (!groups.has(preset.provider)) groups.set(preset.provider, []);
      groups.get(preset.provider).push(preset);
    });
    groups.forEach((presets, provider) => {
      const group = document.createElement("optgroup");
      group.label = provider;
      presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.label;
        group.append(option);
      });
      select.append(group);
    });
  }
  function selectMatchingApiPreset() {
    const preset = PlannerUtils.matchApiModelPreset(
      $("#api-model").value.trim(),
      $("#api-base-url").value.trim(),
    );
    $("#api-model-preset").value = preset?.id || "custom";
  }
  function renderCredentialState(showKeyInput = false) {
    const hasSavedProfile = Boolean($("#api-profile-select").value);
    $("#api-saved-credential").hidden = !hasSavedProfile || showKeyInput;
    $("#api-key-entry").hidden = hasSavedProfile && !showKeyInput;
    if (!showKeyInput) $("#api-key").value = "";
  }
  function populateSavedProfiles(config) {
    apiProfiles = config.apiProfiles || [];
    const select = $("#api-profile-select");
    select.replaceChildren(new Option("新建 API 配置", ""));
    apiProfiles.forEach((profile) =>
      select.append(new Option(profile.label, profile.id)),
    );
    select.value = config.activeApiProfileId || "";
    $("#api-profile-delete").disabled = !select.value;
  }
  function startNewApiProfile() {
    const select = $("#api-profile-select");
    const currentBaseUrl = $("#api-base-url").value;
    const currentModel = $("#api-model").value;
    select.value = "";
    $("#api-profile-name").value = "";
    $("#api-key").value = "";
    $("#api-base-url").value = currentBaseUrl;
    $("#api-model").value = currentModel;
    $("#api-profile-delete").disabled = true;
    renderCredentialState(true);
    setStatus("正在新建 API 配置，请填写名称和 API Key。", "");
    $("#api-profile-name").focus();
  }
  function applySavedProfile() {
    const profile = apiProfiles.find(
      (item) => item.id === $("#api-profile-select").value,
    );
    if (!profile) {
      $("#api-profile-name").value = "";
      renderCredentialState(true);
      $("#api-profile-delete").disabled = true;
      return;
    }
    $("#api-profile-name").value = profile.label;
    $("#api-base-url").value = profile.baseUrl;
    $("#api-model").value = profile.model;
    selectMatchingApiPreset();
    renderCredentialState(false);
    $("#api-profile-delete").disabled = false;
    setStatus(`已选择"${profile.label}"，可直接保存并使用。`, "success");
  }
  function detachSavedProfileIfChanged() {
    if (applyingProfile || !$("#api-profile-select").value) return;
    const profile = apiProfiles.find(
      (item) => item.id === $("#api-profile-select").value,
    );
    if (
      profile &&
      (profile.baseUrl !== $("#api-base-url").value.trim().replace(/\/+$/, "") ||
        profile.model !== $("#api-model").value.trim())
    ) {
      $("#api-profile-select").value = "";
      $("#api-profile-name").value = "";
      renderCredentialState(true);
      setStatus("模型信息已修改，请输入 API Key 保存为新配置。", "");
    }
  }
  function applyApiPreset() {
    const preset = PlannerUtils.getApiModelPreset(
      $("#api-model-preset").value,
    );
    if (!preset) {
      $("#api-model").focus();
      return;
    }
    $("#api-base-url").value = preset.baseUrl;
    $("#api-model").value = preset.model;
    detachSavedProfileIfChanged();
    setStatus(`已选择 ${preset.provider} · ${preset.label}`, "success");
  }

  function selectedMode() {
    return "api";
  }
  function setStatus(message = "", kind = "") {
    status.textContent = message;
    status.className = `settings-status${kind ? ` ${kind}` : ""}`;
  }
  function renderMode() {
    $("#api-settings").hidden = false;
  }
  function renderSummary(config) {
    $("#planner-config").textContent = `${config.api.model || "未配置"} · API 运行`;
  }
  async function refreshSummary() {
    const config = await PlannerBridge.getPlannerConfig();
    renderSummary(config);
    return config;
  }
  async function open() {
    modal.hidden = false;
    setStatus("正在读取配置…");
    try {
      const config = await refreshSummary();
      populateSavedProfiles(config);
      if (config.activeApiProfileId) applySavedProfile();
      else {
        $("#api-base-url").value = config.api.baseUrl;
        $("#api-model").value = config.api.model;
        selectMatchingApiPreset();
        renderCredentialState(true);
      }
      $("#planner-system-prompt").value = config.systemPrompt || "";
      renderMode();
      if (!config.activeApiProfileId) setStatus("");
      $("#api-model-preset").focus();
    } catch (error) {
      setStatus(error.message, "error");
    }
  }
  function close() {
    modal.hidden = true;
    requestAnimationFrame(() => {
      const plannerInput = $("#planner-chat").hidden ? null : $("#planner-input");
      (plannerInput || $("#planner-settings-open")).focus();
    });
  }
  async function save() {
    const button = $("#planner-settings-save");
    button.disabled = true;
    setStatus("正在保存…");
    try {
      const config = await PlannerBridge.savePlannerConfig({
        mode: selectedMode(),
        api: {
          profileId: $("#api-profile-select").value,
          label: $("#api-profile-name").value,
          baseUrl: $("#api-base-url").value,
          model: $("#api-model").value,
          apiKey: $("#api-key").value,
          forceNewProfile: !$("#api-profile-select").value,
        },
        systemPrompt: $("#planner-system-prompt").value,
      });
      renderSummary(config);
      setStatus("配置已保存，下一次对话将使用新模型。", "success");
      setTimeout(close, 450);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  async function deleteSelectedProfile() {
    const select = $("#api-profile-select");
    const profileId = select.value;
    const profile = apiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (!confirm(`删除已保存的 API 配置"${profile.label}"？`)) return;
    $("#api-profile-delete").disabled = true;
    setStatus("正在删除 API 配置…");
    try {
      const config = await PlannerBridge.deletePlannerApiProfile(profileId);
      populateSavedProfiles(config);
      if (config.activeApiProfileId) applySavedProfile();
      else {
        $("#api-profile-name").value = "";
        $("#api-base-url").value = config.api.baseUrl;
        $("#api-model").value = config.api.model;
        selectMatchingApiPreset();
        renderCredentialState(true);
      }
      renderSummary(config);
      setStatus("API 配置已删除。", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      $("#api-profile-delete").disabled = !select.value;
    }
  }

  $("#planner-settings-open").addEventListener("click", open);
  $("#planner-settings-close").addEventListener("click", close);
  $("#planner-settings-cancel").addEventListener("click", close);
  $("#planner-settings-save").addEventListener("click", save);
  $("#api-profile-select").addEventListener("change", applySavedProfile);
  $("#api-profile-new").addEventListener("click", () => startNewApiProfile());
  $("#api-profile-delete").addEventListener("click", deleteSelectedProfile);
  $("#api-key-change").addEventListener("click", () => {
    renderCredentialState(true);
    $("#api-key").focus();
  });
  $("#free-api-tutorial").addEventListener("click", () => PlannerBridge.openFreeApiTutorial());
  $("#api-model-preset").addEventListener("change", applyApiPreset);
  $("#api-base-url").addEventListener("input", () => {
    selectMatchingApiPreset();
    detachSavedProfileIfChanged();
  });
  $("#api-model").addEventListener("input", () => {
    selectMatchingApiPreset();
    detachSavedProfileIfChanged();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });
  populateApiPresets();
  refreshSummary().catch((error) => {
    $("#planner-config").textContent = error.message;
    $("#planner-config").classList.add("bridge-warning");
    $("#planner-send").disabled = true;
    $("#planner-settings-save").disabled = true;
  });
  return { refreshSummary };
})();

const PlannerChat = (() => {
  let state = readJSON(KEYS.chat, { date: todayKey(), messages: [] });
  if (state.date !== todayKey()) {
    state = { date: todayKey(), messages: [], priorityFillApplied: false };
  } else if (typeof state.priorityFillApplied !== "boolean") {
    // Existing installations may not have this flag. Any saved conversation
    // means today's first planner conversation has already happened.
    state.priorityFillApplied = state.messages.length > 0;
  }
  let busy = false;
  function save() {
    writeJSON(KEYS.chat, state);
  }
  function render() {
    const root = $("#planner-messages");
    root.replaceChildren();
    state.messages.forEach((m) => {
      const node = document.createElement("div");
      node.className = `chat-message ${m.role}`;
      node.textContent = m.content;
      root.append(node);
    });
    root.scrollTop = root.scrollHeight;
  }
  function setOpen(open) {
    $("#planner-chat").hidden = !open;
    $("#chat-toggle").classList.toggle("active", open);
    $("#chat-toggle").setAttribute("aria-pressed", String(open));
    if (open) $("#planner-input").focus();
  }
  function parseItems(content) {
    return PlannerUtils.parsePlanItems(content);
  }
  $("#chat-toggle").addEventListener("click", () =>
    setOpen($("#planner-chat").hidden),
  );
  $("#chat-close").addEventListener("click", () => setOpen(false));
  $("#chat-new").addEventListener("click", () => {
    if (busy) return;
    state.messages = [];
    save();
    render();
    requestAnimationFrame(() => {
      $("#planner-input").disabled = false;
      $("#planner-input").focus();
    });
  });
  $("#planner-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#planner-input");
    const message = input.value.trim();
    if (!message || busy || !PlannerBridge.available) return;
    const history = PlannerUtils.sanitizeChatHistory(state.messages);
    busy = true;
    $("#planner-send").disabled = true;
    $("#chat-new").disabled = true;
    state.messages.push({ role: "user", content: message });
    input.value = "";
    render();
    try {
      const reply = await PlannerBridge.chatWithPlanner({
        message,
        date: todayKey(),
        history,
      });
      const content = String(reply.content || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .trim();
      state.messages.push({ role: "assistant", content });
      const rawPlanItems = parseItems(content);
      const planItems = PlannerUtils.completePriorityItems(
        rawPlanItems.length ? rawPlanItems : PlannerUtils.fallbackPlanItemsFromText(message),
        {
          fillPriorityGaps: !state.priorityFillApplied,
          existingTasks: DailyPlan.getTasks(),
        },
      );
      state.priorityFillApplied = true;
      const added = DailyPlan.addTasks(planItems, { confirmSimilar: true, limitPriority: true });
      if (added.length)
        state.messages.push({
          role: "system",
          content: `已添加 ${added.length} 项到今日计划。`,
        });
    } catch (error) {
      state.messages.push({
        role: "system",
        content: `AI 模型暂不可用：${error.message}`,
      });
    } finally {
      busy = false;
      $("#planner-send").disabled = false;
      $("#chat-new").disabled = false;
      save();
      render();
    }
  });
  render();
  return {};
})();

const SoulQuotes = (() => {
  const DEFAULT_QUOTE = "Attention Is All You Need";
  const modal = $("#soul-modal");
  const openButton = $("#soul-open");
  const closeButton = $("#soul-close");
  const form = $("#soul-form");
  const editIdInput = $("#soul-edit-id");
  const textInput = $("#soul-input");
  const saveButton = $("#soul-save");
  const defaultLibraryButton = $("#soul-default-library-toggle");
  const cancelEditButton = $("#soul-cancel-edit");
  const list = $("#soul-list");
  const quoteScreen = $("#focus-quote-screen");
  const quoteText = $("#focus-quote-text");
  const defaultLibrary = Array.isArray(window.DeepStudyDefaultQuotes)
    ? window.DeepStudyDefaultQuotes.map((text) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  let defaultLibraryEnabled = readJSON(KEYS.defaultSoulQuotesEnabled, false) === true;
  let fitFrame = 0;

  function normalizeItem(item) {
    const text =
      typeof item === "string"
        ? item
        : typeof item?.text === "string"
          ? item.text
          : "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    return {
      id: typeof item?.id === "string" && item.id ? item.id : createId(),
      text: trimmed.slice(0, 240),
    };
  }
  function load() {
    const stored = readJSON(KEYS.soulQuotes, null);
    const items = Array.isArray(stored)
      ? stored.map(normalizeItem).filter(Boolean)
      : [];
    if (items.length) return items;
    const seeded = [{ id: createId(), text: DEFAULT_QUOTE }];
    writeJSON(KEYS.soulQuotes, seeded);
    return seeded;
  }
  let quotes = load();

  function save() {
    writeJSON(KEYS.soulQuotes, quotes);
  }
  function quotePool() {
    const texts = quotes.map((quote) => quote.text);
    if (defaultLibraryEnabled) texts.push(...defaultLibrary);
    const seen = new Set();
    return texts.filter((text) => {
      const key = text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function renderDefaultLibraryButton() {
    if (!defaultLibraryButton) return;
    defaultLibraryButton.textContent = defaultLibraryEnabled
      ? "取消默认的“好句库”"
      : "使用默认的“好句库”";
    defaultLibraryButton.classList.toggle("active", defaultLibraryEnabled);
    defaultLibraryButton.setAttribute("aria-pressed", String(defaultLibraryEnabled));
    defaultLibraryButton.title = defaultLibraryEnabled
      ? "已启用默认好句库；再次点击后，欢迎界面只随机展示自定义好句子。"
      : "点击后，欢迎界面会从默认好句库和自定义好句子中随机展示；默认库句子不会出现在下方列表。";
  }
  function clearForm() {
    editIdInput.value = "";
    textInput.value = "";
    saveButton.textContent = "添加句子";
    cancelEditButton.hidden = true;
  }
  function setModalOpen(open) {
    modal.hidden = !open;
    if (open) {
      renderDefaultLibraryButton();
      renderList();
      textInput.focus();
    } else {
      clearForm();
    }
  }
  function pickRandomQuote(currentText = "") {
    const pool = quotePool();
    if (!pool.length) return DEFAULT_QUOTE;
    const candidates =
      pool.length > 1
        ? pool.filter((text) => text !== currentText)
        : pool;
    return candidates[Math.floor(Math.random() * candidates.length)] || DEFAULT_QUOTE;
  }
  function fitGateQuote() {
    const maxSize = 34;
    const minSize = 12;
    if (quoteScreen.offsetParent === null) return false;
    const quoteStyle = getComputedStyle(quoteScreen);
    const availableWidth =
      quoteScreen.clientWidth -
      parseFloat(quoteStyle.paddingLeft) -
      parseFloat(quoteStyle.paddingRight);
    const availableHeight =
      quoteScreen.clientHeight -
      parseFloat(quoteStyle.paddingTop) -
      parseFloat(quoteStyle.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0) return false;
    quoteText.style.width = `${Math.max(120, availableWidth)}px`;
    quoteText.style.height = `${Math.max(40, availableHeight)}px`;
    quoteText.style.fontSize = `${maxSize}px`;
    quoteText.style.lineHeight = "1.16";
    quoteText.style.letterSpacing = "0";
    quoteText.style.display = "grid";
    quoteText.style.placeItems = "center";
    const fits = () =>
      quoteText.scrollHeight <= quoteText.clientHeight &&
      quoteText.scrollWidth <= quoteText.clientWidth;
    for (let size = maxSize; size >= minSize && !fits(); size -= 1) {
      quoteText.style.fontSize = `${size}px`;
    }
    return true;
  }
  function scheduleGateQuoteFit() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => fitGateQuote());
    });
  }
  function renderGateQuote(text = pickRandomQuote(quoteText.textContent)) {
    quoteText.textContent = text;
    quoteText.title = text;
    scheduleGateQuoteFit();
    quoteText.style.animation = "none";
    void quoteText.offsetWidth;
    quoteText.style.animation = "";
  }
  function renderList() {
    list.replaceChildren();
    if (!quotes.length) {
      const empty = document.createElement("div");
      empty.className = "soul-empty";
      empty.textContent = "还没有好句子";
      list.append(empty);
      return;
    }
    quotes.forEach((quote) => {
      const row = document.createElement("div");
      row.className = "soul-item";

      const text = document.createElement("div");
      text.className = "soul-item-text";
      text.textContent = quote.text;

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-btn compact";
      edit.textContent = "修改";
      edit.addEventListener("click", () => {
        editIdInput.value = quote.id;
        textInput.value = quote.text;
        saveButton.textContent = "保存修改";
        cancelEditButton.hidden = false;
        textInput.focus();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-btn compact danger-lite";
      remove.textContent = "删除";
      remove.addEventListener("click", () => {
        quotes = quotes.filter((item) => item.id !== quote.id);
        save();
        if (editIdInput.value === quote.id) clearForm();
        renderList();
      });

      row.append(text, edit, remove);
      list.append(row);
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!text) {
      textInput.focus();
      return;
    }
    const editId = editIdInput.value;
    if (editId) {
      quotes = quotes.map((quote) =>
        quote.id === editId ? { ...quote, text } : quote,
      );
    } else {
      quotes = [{ id: createId(), text }, ...quotes];
    }
    save();
    clearForm();
    renderList();
  });
  openButton.addEventListener("click", () => setModalOpen(true));
  closeButton.addEventListener("click", () => setModalOpen(false));
  cancelEditButton.addEventListener("click", clearForm);
  defaultLibraryButton?.addEventListener("click", () => {
    defaultLibraryEnabled = !defaultLibraryEnabled;
    writeJSON(KEYS.defaultSoulQuotesEnabled, defaultLibraryEnabled);
    renderDefaultLibraryButton();
    renderGateQuote();
  });
  quoteScreen.addEventListener("click", (event) => {
    if (event.button === 0) renderGateQuote();
  });
  quoteScreen.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    renderGateQuote();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) setModalOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) setModalOpen(false);
  });
  window.addEventListener("resize", scheduleGateQuoteFit);
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleGateQuoteFit).observe(quoteScreen);
  }
  document.fonts?.ready?.then(scheduleGateQuoteFit).catch(() => {});
  renderDefaultLibraryButton();
  renderGateQuote();
  renderList();
  return { fitGateQuote: scheduleGateQuoteFit };
})();

const AudioControls = (() => {
  const defaultTracks = [
    { id: "muyu", name: "木鱼白噪音", kind: "default", player: $("#audio-muyu") },
    { id: "rain", name: "雨声白噪音", kind: "default", player: $("#audio-rain") },
  ];
  let customTracks = [];
  let selectedFile = null;
  let activeTrackId = "";
  const customPlayers = new Map();
  const menuButton = $("#noise-menu-button");
  const popover = $("#noise-popover");
  const noiseList = $("#noise-list");
  const customToggle = $("#noise-custom-toggle");
  const customPanel = $("#noise-custom-panel");
  const dropzone = $("#noise-dropzone");
  const fileInput = $("#noise-file-input");
  const pickFile = $("#noise-pick-file");
  const addFile = $("#noise-add-file");
  const status = $("#noise-status");
  const volumeInput = $("#noise-volume");
  const volumeValue = $("#volume-value");
  const muteButton = $("#noise-mute-button");
  const VOLUME_KEY = "deepstudy.noiseVolume.v1";
  const LAST_VOLUME_KEY = "deepstudy.lastNoiseVolume.v1";
  let rate = 1;
  function normalizeVolume(value, fallback = 0.7) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
  }
  let volume = normalizeVolume(readJSON(VOLUME_KEY, 0.7));
  let lastNonZeroVolume = Math.max(0.01, normalizeVolume(
    readJSON(LAST_VOLUME_KEY, volume || 0.7),
    volume || 0.7,
  ));
  function allTracks() {
    return defaultTracks.concat(customTracks);
  }
  function allPlayers() {
    return defaultTracks.map((track) => track.player).concat([...customPlayers.values()]);
  }
  function applyVolume() {
    allPlayers().forEach((player) => {
      player.volume = volume;
    });
    volumeInput.value = String(Math.round(volume * 100));
    volumeValue.textContent = `${Math.round(volume * 100)}%`;
    const volumeLevel = volume === 0 ? "muted" : volume < 0.5 ? "low" : "high";
    const muteTitle = volume === 0 ? "恢复白噪音音量" : "静音白噪音";
    muteButton.dataset.volumeLevel = volumeLevel;
    muteButton.title = muteTitle;
    muteButton.setAttribute("aria-label", muteTitle);
    muteButton.classList.toggle("active", volume === 0);
  }
  function setVolume(nextVolume) {
    volume = Math.max(0, Math.min(1, Number(nextVolume) || 0));
    if (volume > 0) {
      lastNonZeroVolume = volume;
      writeJSON(LAST_VOLUME_KEY, lastNonZeroVolume);
    }
    writeJSON(VOLUME_KEY, volume);
    applyVolume();
  }
  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }
  function playbackErrorMessage(track, player, error) {
    const mediaCode = player?.error?.code;
    const detail = mediaCode ? `（媒体错误 ${mediaCode}）` : "";
    return `${track.name}播放失败${detail}。${error?.message ? ` ${error.message}` : ""}`;
  }
  function stopOtherTracks(trackId) {
    allTracks().forEach((track) => {
      const player = playerForExistingTrack(track);
      if (!player || track.id === trackId) return;
      player.pause();
      player.currentTime = 0;
    });
  }
  function playerForExistingTrack(track) {
    return track.kind === "default" ? track.player : customPlayers.get(track.id);
  }
  async function loadCustomPlayer(track) {
    if (customPlayers.has(track.id)) return customPlayers.get(track.id);
    const item = await window.electronAPI?.readCustomNoise(track.id);
    if (!item?.buffer) throw new Error("未读取到音频文件。");
    const blob = new Blob([item.buffer], { type: item.type || "audio/mpeg" });
    const player = new Audio(URL.createObjectURL(blob));
    player.loop = true;
    player.preload = "auto";
    player.volume = volume;
    player.playbackRate = rate;
    customPlayers.set(track.id, player);
    return player;
  }
  async function playerForTrack(track) {
    return track.kind === "default" ? track.player : loadCustomPlayer(track);
  }
  function renderTracks() {
    noiseList.replaceChildren();
    allTracks().forEach((track) => {
      const row = document.createElement("div");
      row.className = "noise-track";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "noise-track-play secondary-btn";
      const state = document.createElement("span");
      state.className = "noise-track-state";
      state.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "noise-track-label";
      label.textContent = track.name;
      play.append(state, label);
      play.title = track.name;
      play.classList.toggle("active", activeTrackId === track.id);
      play.setAttribute("aria-pressed", String(activeTrackId === track.id));
      play.setAttribute("aria-label", `${activeTrackId === track.id ? "暂停" : "播放"}${track.name}`);
      play.addEventListener("click", () => toggleTrack(track));
      row.append(play);
      if (track.kind === "custom") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "noise-remove";
        remove.textContent = "×";
        remove.title = "删除";
        remove.addEventListener("click", async () => {
          if (activeTrackId === track.id) {
            const player = customPlayers.get(track.id);
            player?.pause();
            activeTrackId = "";
          }
          await window.electronAPI?.deleteCustomNoise(track.id);
          const cached = customPlayers.get(track.id);
          if (cached?.src) URL.revokeObjectURL(cached.src);
          customPlayers.delete(track.id);
          customTracks = customTracks.filter((item) => item.id !== track.id);
          renderTracks();
        });
        row.append(remove);
      }
      noiseList.append(row);
    });
  }
  async function toggleTrack(track) {
    try {
      const player = await playerForTrack(track);
      if (activeTrackId === track.id && !player.paused) {
        player.pause();
        activeTrackId = "";
        setStatus(`已暂停${track.name}。`);
        renderTracks();
        return;
      }
      stopOtherTracks(track.id);
      if (volume === 0) setVolume(lastNonZeroVolume || 0.7);
      player.volume = volume;
      player.playbackRate = rate;
      setStatus(`正在加载${track.name}…`);
      await player.play();
      activeTrackId = track.id;
      setStatus(`正在播放${track.name}。`);
      renderTracks();
    } catch (error) {
      console.warn(error);
      activeTrackId = "";
      setStatus(playbackErrorMessage(track, playerForExistingTrack(track), error), true);
      renderTracks();
    }
  }
  async function refreshCustomTracks() {
    try {
      const items = await window.electronAPI?.listCustomNoise();
      customTracks = (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        kind: "custom",
      }));
      renderTracks();
    } catch (error) {
      console.warn(error);
      renderTracks();
    }
  }
  function chooseFile(file) {
    selectedFile = file && file.type.startsWith("audio/") ? file : null;
    addFile.disabled = !selectedFile;
    setStatus(selectedFile ? `已选择：${selectedFile.name}` : "请选择音频文件。", !selectedFile);
  }
  function toggleMute() {
    if (volume > 0) {
      lastNonZeroVolume = volume;
      setVolume(0);
    } else {
      setVolume(lastNonZeroVolume || 0.7);
    }
  }
  function setMenuOpen(open) {
    popover.hidden = !open;
    menuButton.classList.toggle("active", open || Boolean(activeTrackId));
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenuOpen(popover.hidden);
  });
  muteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMute();
  });
  popover.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", (event) => {
    if (!$("#noise-control").contains(event.target)) setMenuOpen(false);
  });
  customToggle.addEventListener("click", () => {
    customPanel.hidden = !customPanel.hidden;
  });
  pickFile.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => chooseFile(fileInput.files?.[0]));
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag-over");
    chooseFile(event.dataTransfer.files?.[0]);
  });
  addFile.addEventListener("click", async () => {
    if (!selectedFile) return;
    addFile.disabled = true;
    setStatus("正在添加...");
    try {
      const buffer = await selectedFile.arrayBuffer();
      const item = await window.electronAPI?.addCustomNoise({
        name: selectedFile.name,
        type: selectedFile.type,
        buffer,
      });
      customTracks.push({ ...item, kind: "custom" });
      selectedFile = null;
      fileInput.value = "";
      setStatus("已添加到我的白噪音。");
      renderTracks();
    } catch (error) {
      addFile.disabled = false;
      setStatus(error.message || "添加失败。", true);
    }
  });
  $$(".audio-rate").forEach((button) =>
    button.addEventListener("click", () => {
      rate = Number(button.dataset.rate);
      allPlayers().forEach((x) => {
        x.playbackRate = rate;
      });
      $$(".audio-rate").forEach((x) =>
        x.classList.toggle("active", x === button),
      );
    }),
  );
  volumeInput.addEventListener("input", () => {
    setVolume(Number(volumeInput.value) / 100);
  });
  renderTracks();
  applyVolume();
  refreshCustomTracks();
  return {};
})();

let activeMode = "focus";
function switchMode(mode) {
  activeMode = mode;
  $$(".mode-tab").forEach((x) =>
    x.classList.toggle("active", x.dataset.mode === mode),
  );
  $$(".mode-panel").forEach((x) =>
    x.classList.toggle("active", x.id === `${mode}-mode`),
  );
  if (mode === "habit") TimeAudit.render();
}

function setGateVisible(visible) {
  $("#gate-view").hidden = !visible;
  $("#mode-shell").hidden = visible;
  $("#soul-open").hidden = !visible;
  $("#tutorial-open").hidden = !visible;
}

$$(".mode-tab").forEach((button) =>
  button.addEventListener("click", () => switchMode(button.dataset.mode)),
);
$("#enter-gate").addEventListener("click", () => {
  writeJSON(KEYS.gate, { date: todayKey(), entered: true });
  setGateVisible(false);
  FocusTracker.log("gate-entered");
});
// 始终从封面主界面开始，只有点击"进入注意力空间"才进入功能主界面
setGateVisible(true);
$("#back-to-gate").addEventListener("click", () => {
  writeJSON(KEYS.gate, {});
  setGateVisible(true);
  SoulQuotes.fitGateQuote();
});

// Collapse/expand mode tabs — can be triggered programmatically or by click
function setTabsCollapsed(collapsed) {
  const header = document.querySelector(".mode-sticky-header");
  const btn = $("#collapse-tabs");
  if (!header) return;
  header.classList.toggle("collapsed", collapsed);
  btn.textContent = collapsed ? "▸" : "▾";
  btn.title = collapsed ? "展开" : "收起";
}
$("#collapse-tabs").addEventListener("click", () => {
  const header = document.querySelector(".mode-sticky-header");
  if (!header) return;
  const nowCollapsed = !header.classList.contains("collapsed");
  setTabsCollapsed(nowCollapsed);
});

const DistractionList = (() => {
  const configs = {
    "controllable-interesting": ["可控 + 有意思", "提前处理掉"],
    "controllable-boring": ["可控 + 没意思", "提前处理掉"],
    "uncontrollable-interesting": ["不可控 + 有意思", "顿一下再回来"],
    "uncontrollable-boring": ["不可控 + 没意思", "预设边界并规避"],
  };
  function add(text, control, interest, durationMs = 0, resolved = true) {
    const items = readJSON(KEYS.distractions, []);
    const item = {
      id: createId(),
      text: String(text || "").trim() || "未命名干扰",
      control,
      interest,
      quadrant: `${control}-${interest}`,
      durationMs,
      resolved,
      timestamp: Date.now(),
    };
    items.push(item);
    writeJSON(KEYS.distractions, items.slice(-1000));
    TimeAudit.add("distraction", durationMs, item.timestamp - durationMs, {
      distractionId: item.id,
    });
    render();
    return item;
  }
  function remove(id) {
    const items = readJSON(KEYS.distractions, []);
    writeJSON(
      KEYS.distractions,
      items.filter((item) => item.id !== id),
    );
    render();
  }
  function render() {
    const root = $("#distraction-grid");
    root.replaceChildren();
    const items = readJSON(KEYS.distractions, []).filter(
      (x) => todayKey(new Date(x.timestamp)) === todayKey(),
    );
    Object.entries(configs).forEach(([key, [title, advice]]) => {
      const matched = items.filter((x) => x.quadrant === key);
      const details = document.createElement("details");
      details.className = "quadrant";
      details.innerHTML = `<summary><div class="quadrant-head"><span>${title}</span><span class="quadrant-count">${matched.length}</span></div><div class="quadrant-advice">${advice}</div></summary><ul class="quadrant-list">${matched.length ? matched.map((x) => `<li><span>${escapeHTML(x.text)}${x.durationMs ? ` · ${formatMinutes(x.durationMs)}` : ""}</span><button class="distraction-delete" type="button" data-id="${x.id}" title="删除干扰">删除</button></li>`).join("") : '<li class="subtle">暂无记录</li>'}</ul>`;
      root.append(details);
    });
  }
  $("#distraction-grid").addEventListener("click", (event) => {
    const button = event.target.closest(".distraction-delete");
    if (!button) return;
    event.preventDefault();
    remove(button.dataset.id);
  });
  $("#distraction-form").addEventListener("submit", (event) => {
    event.preventDefault();
    add(
      $("#distraction-input").value,
      $("#distraction-control").value,
      $("#distraction-interest").value,
    );
    $("#distraction-input").value = "";
  });
  render();
  return { add, render, remove };
})();
function escapeHTML(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

const FocusMode = (() => {
  let selectedMs = 25 * 60000,
    remaining = selectedMs,
    running = false,
    target = 0,
    timer = null,
    segmentStart = 0,
    segmentType = "core",
    sessionStart = 0,
    sessionFocusedMs = 0,
    sessionTypes = new Set(),
    pausedByModal = false;
  const display = $("#focus-timer");
  const durationModal = $("#focus-duration-modal");
  const durationForm = $("#focus-duration-form");
  const durationInput = $("#focus-duration-input");
  function type() {
    return $("#work-type-toggle").checked ? "core" : "maintenance";
  }
  function render() {
    display.textContent = formatClock(remaining).slice(3);
    $("#focus-start").textContent = running
      ? "专注中"
      : remaining < selectedMs
        ? "继续专注"
        : "开始专注";
    $("#focus-start").disabled = running;
    $("#focus-pause").disabled = !running;
  }
  function recordSegment() {
    if (!segmentStart) return;
    const duration = Date.now() - segmentStart;
    sessionFocusedMs += duration;
    TimeAudit.add(segmentType, duration, segmentStart);
    segmentStart = 0;
  }
  function tick() {
    remaining = Math.max(0, target - Date.now());
    render();
    if (remaining <= 0) finish();
  }
  function setDuration(minutes) {
    const safeMinutes = Math.max(1, Math.min(240, Number(minutes) || 25));
    selectedMs = safeMinutes * 60000;
    remaining = selectedMs;
    durationInput.value = String(safeMinutes);
    $$(".focus-duration-preset").forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.minutes) === safeMinutes),
    );
    render();
  }
  function closeDurationModal() {
    durationModal.hidden = true;
  }
  function openDurationModal() {
    durationInput.value = String(Math.round(selectedMs / 60000));
    $$(".focus-duration-preset").forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.minutes) === Number(durationInput.value)),
    );
    durationModal.hidden = false;
    durationInput.focus();
    durationInput.select();
  }
  function beginFocus() {
    if (running || remaining <= 0) return;
    running = true;
    target = Date.now() + remaining;
    segmentStart = Date.now();
    segmentType = type();
    sessionTypes.add(segmentType);
    if (!sessionStart) sessionStart = Date.now();
    timer = setInterval(tick, 200);
    FocusTracker.log("focus-started", {
      type:
        sessionTypes.size > 1
          ? "mixed"
          : (sessionTypes.values().next().value ?? type()),
      types: [...sessionTypes],
      plannedMinutes: selectedMs / 60000,
    });
    render();
  }
  function start() {
    if (running || remaining <= 0) return;
    if (!sessionStart && remaining === selectedMs) {
      openDurationModal();
      return;
    }
    beginFocus();
  }
  function pause(reason = "manual") {
    if (!running) return;
    remaining = Math.max(0, target - Date.now());
    running = false;
    clearInterval(timer);
    timer = null;
    recordSegment();
    FocusTracker.log("focus-paused", { reason, remainingMs: remaining });
    render();
  }
  function saveSession(completed) {
    if (!sessionStart) return;
    const sessions = readJSON(KEYS.sessions, []);
    sessions.push({
      id: createId(),
      start: sessionStart,
      end: Date.now(),
      plannedMs: selectedMs,
      focusedMs: Math.round(sessionFocusedMs),
      type:
        sessionTypes.size > 1
          ? "mixed"
          : (sessionTypes.values().next().value ?? type()),
      types: [...sessionTypes],
      completed,
    });
    writeJSON(KEYS.sessions, sessions.slice(-1000));
  }
  function reset() {
    if (running) pause("reset");
    saveSession(false);
    remaining = selectedMs;
    sessionStart = 0;
    sessionFocusedMs = 0;
    sessionTypes = new Set();
    FocusTracker.log("focus-reset");
    render();
  }
  function finish() {
    clearInterval(timer);
    running = false;
    recordSegment();
    remaining = 0;
    saveSession(true);
    FocusTracker.log("focus-completed", { type: type() });
    alarm();
    render();
    setTimeout(() => {
      remaining = selectedMs;
      sessionStart = 0;
      sessionFocusedMs = 0;
      sessionTypes = new Set();
      render();
      switchMode("rest");
      playFocusRestPrompt();
    }, 900);
  }
  function pauseForModal() {
    pausedByModal = running;
    if (running) pause("distraction");
    return pausedByModal;
  }
  function resumeAfterModal() {
    if (pausedByModal) {
      pausedByModal = false;
      beginFocus();
    }
  }
  function checkpoint() {
    if (!running || !segmentStart) return;
    recordSegment();
    segmentStart = Date.now();
    segmentType = type();
    sessionTypes.add(segmentType);
  }
  $$(".focus-duration-preset").forEach((button) =>
    button.addEventListener("click", () => {
      setDuration(Number(button.dataset.minutes));
    }),
  );
  durationInput.addEventListener("input", () => {
    $$(".focus-duration-preset").forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.minutes) === Number(durationInput.value)),
    );
  });
  durationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setDuration(durationInput.value);
    closeDurationModal();
    beginFocus();
  });
  $("#focus-duration-close").addEventListener("click", closeDurationModal);
  $("#focus-duration-cancel").addEventListener("click", closeDurationModal);
  durationModal.addEventListener("click", (event) => {
    if (event.target === durationModal) closeDurationModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !durationModal.hidden) closeDurationModal();
  });
  $("#focus-start").addEventListener("click", start);
  $("#focus-pause").addEventListener("click", () => pause());
  $("#focus-reset").addEventListener("click", reset);
  $("#work-type-toggle").checked =
    readJSON("mytimer.workType.v1", "core") === "core";
  $("#work-type-toggle").addEventListener("change", (event) => {
    if (running) {
      recordSegment();
      segmentStart = Date.now();
      segmentType = type();
      sessionTypes.add(segmentType);
    }
    writeJSON(
      "mytimer.workType.v1",
      event.target.checked ? "core" : "maintenance",
    );
    $("#work-type-description").textContent = event.target.checked
      ? "核心工作：高认知要求、直接推进目标"
      : "维持性工作：流程化、支持性的日常事务";
  });
  $("#work-type-toggle").dispatchEvent(new Event("change"));
  render();
  return { pauseForModal, resumeAfterModal, checkpoint };
})();

const DistractionModal = (() => {
  let openedAt = 0,
    interval = null,
    deadline = 0,
    solving = false;
  function render() {
    const elapsed = Date.now() - openedAt;
    if (solving) {
      $("#modal-timer").textContent = `+${formatClock(elapsed).slice(3)}`;
      $("#modal-help").textContent =
        "正在记录干扰处理时长。处理完后立即回到专注。";
    } else {
      $("#modal-timer").textContent = formatClock(
        Math.max(0, deadline - Date.now()),
      ).slice(3);
      if (Date.now() >= deadline)
        $("#modal-help").textContent =
          "两分钟已到。请选择回到专注，或明确继续解决。";
    }
  }
  function open() {
    if (
      activeMode !== "focus" ||
      $("#mode-shell").hidden ||
      !$("#distraction-modal").hidden
    )
      return;
    openedAt = Date.now();
    deadline = openedAt + 120000;
    solving = false;
    FocusMode.pauseForModal();
    $("#distraction-modal").hidden = false;
    $("#modal-distraction-text").focus();
    interval = setInterval(render, 200);
    render();
    FocusTracker.log("distraction-opened");
  }
  function close() {
    const duration = Date.now() - openedAt;
    DistractionList.add(
      $("#modal-distraction-text").value,
      $("#modal-control").value,
      $("#modal-interest").value,
      duration,
      solving,
    );
    $("#modal-distraction-text").value = "";
    clearInterval(interval);
    $("#distraction-modal").hidden = true;
    FocusTracker.log("distraction-ended", {
      durationMs: duration,
      continued: solving,
    });
    FocusMode.resumeAfterModal();
  }
  $("#quick-distraction").addEventListener("click", open);
  $("#modal-end").addEventListener("click", close);
  $("#modal-continue").addEventListener("click", () => {
    solving = true;
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.code === "KeyD" && !isTyping(event)) {
      event.preventDefault();
      open();
    }
  });
  return { open };
})();

if (window.electronAPI?.onOpenDistraction)
  window.electronAPI.onOpenDistraction(() => DistractionModal.open());

const RestMode = (() => {
  let total = 15 * 60000,
    remaining = total,
    running = false,
    target = 0,
    timer = null,
    segmentStart = 0,
    completedSegments = [];
  function render() {
    $("#rest-timer").textContent = formatFlexibleClock(remaining);
    $("#rest-start").disabled = running || remaining <= 0;
    $("#rest-start").textContent = remaining < total ? "继续休息" : "开始休息";
    $("#rest-pause").disabled = !running;
  }
  function captureSegment() {
    if (segmentStart) {
      completedSegments.push({
        start: segmentStart,
        durationMs: Date.now() - segmentStart,
      });
      segmentStart = 0;
    }
  }
  function recordCompletedSession() {
    completedSegments.forEach((segment) =>
      TimeAudit.add("rest", segment.durationMs, segment.start),
    );
    completedSegments = [];
  }
  function tick() {
    remaining = Math.max(0, target - Date.now());
    render();
    if (!remaining) {
      clearInterval(timer);
      running = false;
      captureSegment();
      recordCompletedSession();
      Breathing.stop();
      FocusTracker.log("rest-completed");
      alarm();
      render();
    }
  }
  function start() {
    if (running || remaining <= 0) return;
    running = true;
    target = Date.now() + remaining;
    segmentStart = Date.now();
    timer = setInterval(tick, 200);
    FocusTracker.log("rest-started");
    render();
  }
  function pause() {
    if (!running) return;
    remaining = Math.max(0, target - Date.now());
    running = false;
    clearInterval(timer);
    captureSegment();
    Breathing.stop();
    FocusTracker.log("rest-paused");
    render();
  }
  function reset() {
    if (running) pause();
    completedSegments = [];
    total = 15 * 60000;
    remaining = total;
    Breathing.stop();
    render();
  }
  function returnToFocus() {
    if (running) {
      clearInterval(timer);
      running = false;
      timer = null;
      captureSegment();
    }
    if (completedSegments.length) recordCompletedSession();
    completedSegments = [];
    total = 15 * 60000;
    remaining = total;
    Breathing.stop();
    FocusTracker.log("rest-return-focus");
    render();
    switchMode("focus");
  }

  // Click-to-edit timer: clicking the rest-timer (when idle) shows inline inputs
  function setupTimerEdit() {
    const timer = $("#rest-timer");
    timer.addEventListener("click", () => {
      if (running || completedSegments.length > 0 || remaining < total) return;
      // Parse current time
      const totalSec = Math.floor(remaining / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      // Build inline edit UI
      timer.innerHTML = `
        <div class="rest-edit-inline" role="group" aria-label="修改休息时长">
          <label><span>时</span><input id="rest-edit-h" type="number" min="0" max="23" value="${h}" aria-label="小时" /></label>
          <span class="rest-edit-sep">:</span>
          <label><span>分</span><input id="rest-edit-m" type="number" min="0" max="59" value="${m}" aria-label="分钟" /></label>
          <span class="rest-edit-sep">:</span>
          <label><span>秒</span><input id="rest-edit-s" type="number" min="0" max="59" value="${s}" aria-label="秒" /></label>
        </div>`;
      const hInput = $("#rest-edit-h");
      const mInput = $("#rest-edit-m");
      const sInput = $("#rest-edit-s");
      function confirmEdit() {
        const hours = Math.max(0, Math.min(23, Number(hInput.value) || 0));
        const minutes = Math.max(0, Math.min(59, Number(mInput.value) || 0));
        const seconds = Math.max(0, Math.min(59, Number(sInput.value) || 0));
        const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
        if (ms > 0) {
          total = ms;
          remaining = total;
        }
        render();
      }
      [hInput, mInput, sInput].forEach((input) => {
        input.addEventListener("change", confirmEdit);
        input.addEventListener("blur", () => {
          setTimeout(() => {
            if (!timer.contains(document.activeElement)) confirmEdit();
          }, 200);
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.target.blur(); }
        });
      });
      hInput.focus();
      hInput.select();
    });
  }

  $("#rest-start").addEventListener("click", start);
  $("#rest-pause").addEventListener("click", pause);
  $("#rest-reset").addEventListener("click", reset);
  $("#rest-return-focus").addEventListener("click", returnToFocus);
  setupTimerEdit();
  render();
  return {};
})();

const Breathing = (() => {
  let frame = null,
    audio = null,
    runId = 0;
  const stage = $("#breathing-stage");
  const plans = {
    box: {
      audio: $("#audio-breathing"),
    },
    wim: {
      audio: $("#audio-wim"),
    },
  };
  const cuesPromise = fetch("assets/audio/breathing_cues.json").then(
    (response) => {
      if (!response.ok) throw new Error("呼吸提示时间轴加载失败");
      return response.json();
    },
  );
  const brainwave = (() => {
    let ctx = null;
    let nodes = [];
    let master = null;
    function addPair(carrier, beat, gainValue) {
      const left = ctx.createOscillator();
      const right = ctx.createOscillator();
      const leftGain = ctx.createGain();
      const rightGain = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      left.type = "sine";
      right.type = "sine";
      left.frequency.value = carrier - beat / 2;
      right.frequency.value = carrier + beat / 2;
      leftGain.gain.setValueAtTime(0, ctx.currentTime);
      rightGain.gain.setValueAtTime(0, ctx.currentTime);
      leftGain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 1.4);
      rightGain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 1.4);
      left.connect(leftGain);
      right.connect(rightGain);
      leftGain.connect(merger, 0, 0);
      rightGain.connect(merger, 0, 1);
      merger.connect(master);
      left.start();
      right.start();
      nodes.push(left, right, leftGain, rightGain, merger);
    }
    function start() {
      stop();
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = 0.82;
        master.connect(ctx.destination);
        addPair(220, 10, 0.014);
        addPair(174, 6, 0.01);
        ctx.resume?.();
      } catch (error) {
        console.warn(error);
        stop();
      }
    }
    function stop() {
      if (!ctx) return;
      const closing = ctx;
      try {
        const now = closing.currentTime;
        nodes.forEach((node) => {
          if (node.gain) {
            node.gain.cancelScheduledValues(now);
            node.gain.setTargetAtTime(0.0001, now, 0.08);
          }
          if (node.stop) node.stop(now + 0.35);
          if (node.disconnect) setTimeout(() => node.disconnect(), 420);
        });
        master?.disconnect();
        setTimeout(() => closing.close?.(), 450);
      } catch (error) {
        console.warn(error);
      }
      ctx = null;
      nodes = [];
      master = null;
    }
    return { start, stop };
  })();
  function stop() {
    runId += 1;
    cancelAnimationFrame(frame);
    frame = null;
    brainwave.stop();
    if (audio) {
      audio.onended = null;
      audio.pause();
      audio.currentTime = 0;
    }
    stage.hidden = true;
    $("#breathing-circle").style.transform = "scale(1)";
  }
  async function start(kind) {
    stop();
    const activeRun = runId;
    const plan = plans[kind];
    let timeline;
    try {
      timeline = (await cuesPromise)[kind];
    } catch (error) {
      $("#breathing-label").textContent = error.message;
      stage.hidden = false;
      return;
    }
    if (activeRun !== runId) return;

    stage.hidden = false;
    audio = plan.audio;
    audio.playbackRate = timeline.playbackRate;
    audio.preservesPitch = false;
    audio.onended = stop;
    const circle = $("#breathing-circle");
    const update = () => {
      if (activeRun !== runId || audio.paused) return;
      const currentTime = audio.currentTime;
      let cueIndex = timeline.cues.findIndex(
        (cue) => currentTime >= cue.start && currentTime < cue.end,
      );
      if (cueIndex < 0) cueIndex = timeline.cues.length - 1;
      const cue = timeline.cues[cueIndex];
      const cueDuration = Math.max(0.001, cue.end - cue.start);
      const progress = Math.max(
        0,
        Math.min(1, (currentTime - cue.start) / cueDuration),
      );
      const previousScale = timeline.cues[cueIndex - 1]?.scale ?? 1;
      const scale = previousScale + (cue.scale - previousScale) * progress;
      const secondsLeft = Math.ceil(
        Math.max(0, cue.end - currentTime) / timeline.playbackRate,
      );
      $("#breathing-label").textContent = cue.countdown
        ? `${cue.label} ${secondsLeft}秒`
        : cue.label;
      const groupLabel = timeline.groupLabel || "组";
      const groupTotal = timeline.groupTotal || 3;
      $("#breathing-count").textContent = cue.group
        ? `语音同步 · 第 ${cue.group} / ${groupTotal} ${groupLabel}`
        : `语音同步 · ${cueIndex + 1} / ${timeline.cues.length}`;
      circle.style.transform = `scale(${scale})`;
      frame = requestAnimationFrame(update);
    };
    audio
      .play()
      .then(() => {
        if (activeRun === runId) {
          update();
        }
      })
      .catch(() => {
        brainwave.stop();
        $("#breathing-label").textContent = "音频播放失败，请重试";
      });
  }
  $$(".breathing-btn").forEach((button) =>
    button.addEventListener("click", () => start(button.dataset.kind)),
  );
  $("#breathing-stop").addEventListener("click", stop);
  return { stop };
})();

const Reflections = (() => {
  let items = readJSON(KEYS.reflections, []);
  let editingId = null;
  const input = $("#reflection-input");

  function migrateLegacyAutoBlock() {
    const migrated = [];
    items.forEach((item) => {
      if (["completed-task", "completed-task-summary"].includes(item.kind)) {
        migrated.push(item);
        return;
      }
      const block = String(item.content || "").match(
        /【今日已完成任务（自动同步）】\s*([\s\S]*?)\s*【自动同步结束】/,
      );
      if (block) {
        block[1]
          .split("\n")
          .map((line) => line.replace(/^\s*-\s*/, "").trim())
          .filter(Boolean)
          .forEach((text, index) =>
            migrated.push({
              id: `${item.id}-task-${index + 1}`,
              date: item.date,
              content: `已完成：${text}`,
              kind: "completed-task",
              updatedAt: item.updatedAt + index + 1,
            }),
          );
      }
      const content = PlannerUtils.mergeCompletedTasksIntoReflection(
        item.content,
        [],
      );
      if (content)
        migrated.push({ ...item, kind: item.kind || "manual", content });
    });
    items = migrated;
    const completedDates = [
      ...new Set(
        items
          .filter((item) => item.kind?.startsWith("completed-task"))
          .map((item) => item.date),
      ),
    ];
    completedDates.forEach((date) => {
      items = PlannerUtils.syncCompletedTaskEntries(
        items,
        [],
        date,
        Date.now(),
        createId,
      );
    });
  }

  function syncCompletedTasks(tasks) {
    const next = PlannerUtils.syncCompletedTaskEntries(
      items,
      tasks,
      todayKey(),
      Date.now(),
      createId,
    );
    if (JSON.stringify(next) === JSON.stringify(items)) return;
    items = next;
    writeJSON(KEYS.reflections, items);
    render();
  }

  function syncCompletedLongTask(task) {
    if (!task?.id || !task.title) return;
    syncCompletedTasks([
      ...DailyPlan.getTasks(),
      {
        id: `long-${task.id}`,
        text: task.title,
        done: true,
        createdAt: Number(task.createdAt) || Number(task.completedAt) || Date.now(),
        completedAt: Number(task.completedAt) || Date.now(),
      },
    ]);
  }

  function removeCompletedLongTask(task) {
    if (!task?.id || !task.title) return;
    const sourceId = `long-${task.id}`;
    const completedLine = `已完成：${task.title}`;
    items = items
      .map((item) => {
        if (item.date !== todayKey() || !item.kind?.startsWith("completed-task")) return item;
        if (item.sourceTaskId === sourceId) return null;
        if (Array.isArray(item.sourceTaskIds) && item.sourceTaskIds.includes(sourceId)) {
          const lines = String(item.content || "")
            .split("\n")
            .filter((line) => line.trim() && line.trim() !== completedLine);
          if (!lines.length) return null;
          return {
            ...item,
            content: lines.join("\n"),
            sourceTaskIds: item.sourceTaskIds.filter((id) => id !== sourceId),
            updatedAt: Date.now(),
          };
        }
        return item;
      })
      .filter(Boolean);
    writeJSON(KEYS.reflections, items);
    render();
  }

  const selectedIds = new Set();

  function groupItemsByDate() {
    const groups = new Map();
    [...items].sort((a, b) => a.date.localeCompare(b.date) || (b.updatedAt - a.updatedAt)).forEach((item) => {
      if (!groups.has(item.date)) groups.set(item.date, []);
      groups.get(item.date).push(item);
    });
    return groups;
  }

  function render() {
    $("#reflection-count").textContent = `${input.value.length} / 300–500`;
    const root = $("#reflection-list");
    root.replaceChildren();
    if (!items.length) {
      root.innerHTML = '<p class="subtle">暂无记录</p>';
    } else {
      groupItemsByDate().forEach((dayItems, date) => {
        const day = document.createElement("div");
        day.className = "reflection-day";
        const allDaySelected = dayItems.length > 0 && dayItems.every((item) => selectedIds.has(item.id));
        const dayHeader = document.createElement("div");
        dayHeader.className = "reflection-day-header";
        dayHeader.innerHTML = `<label><input type="checkbox" data-date="${escapeHTML(date)}" ${allDaySelected ? "checked" : ""}> ${escapeHTML(date)} · ${dayItems.length} 条</label>`;
        day.append(dayHeader);
        dayItems.forEach((item) => {
          const entry = document.createElement("div");
          entry.className = `reflection-entry ${item.kind?.startsWith("completed-task") ? "auto-task" : ""}`;
          entry.innerHTML = `<input type="checkbox" data-select-id="${escapeHTML(item.id)}" ${selectedIds.has(item.id) ? "checked" : ""}><p>${escapeHTML(item.content)}</p><div class="reflection-entry-actions"><button class="reflection-action edit" type="button" data-action="edit" data-id="${escapeHTML(item.id)}">编辑</button><button class="reflection-action delete" type="button" data-action="delete" data-id="${escapeHTML(item.id)}">删除</button></div>`;
          day.append(entry);
        });
        root.append(day);
      });
    }
    $("#reflection-save").textContent = editingId ? "更新" : "保存";
    $("#reflection-cancel").hidden = !editingId;
    $(".reflection-card").classList.toggle("editing", Boolean(editingId));
  }
  input.addEventListener("input", render);
  $("#reflection-save").addEventListener("click", () => {
    const content = input.value.trim();
    if (!content) return;
    const existing = editingId
      ? items.find((item) => item.id === editingId)
      : items.find(
          (item) => item.date === todayKey() && !item.kind?.startsWith("completed-task"),
        );
    if (existing) {
      existing.content = content;
      existing.updatedAt = Date.now();
    } else
      items.push({
        id: createId(),
        date: todayKey(),
        content,
        kind: "manual",
        updatedAt: Date.now(),
      });
    writeJSON(KEYS.reflections, items);
    editingId = null;
    input.value = "";
    render();
  });
  $("#reflection-cancel").addEventListener("click", () => {
    editingId = null;
    input.value =
      items.find(
        (item) => item.date === todayKey() && !item.kind?.startsWith("completed-task"),
      )?.content || "";
    render();
  });
  $("#reflection-list").addEventListener("click", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]') || event.target.closest("label")?.querySelector('input[type="checkbox"]');
    if (checkbox) {
      const date = checkbox.dataset.date;
      if (date) {
        const dayItems = items.filter((item) => item.date === date);
        const allSelected = dayItems.every((item) => selectedIds.has(item.id));
        dayItems.forEach((item) => {
          if (allSelected) selectedIds.delete(item.id);
          else selectedIds.add(item.id);
        });
      } else {
        const id = checkbox.dataset.selectId;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
      }
      render();
      return;
    }
    const button = event.target.closest(".reflection-action");
    if (!button) return;
    const item = items.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "edit") {
      editingId = item.id;
      input.value = item.content;
      input.focus();
      render();
      return;
    }
    if (!confirm(`删除 ${item.date} 的这条记录？`)) return;
    items = items.filter((entry) => entry.id !== item.id);
    selectedIds.delete(item.id);
    if (editingId === item.id) {
      editingId = null;
      input.value = "";
    }
    writeJSON(KEYS.reflections, items);
    render();
  });
  $("#reflection-select-all").addEventListener("click", () => {
    items.forEach((item) => selectedIds.add(item.id));
    render();
  });
  $("#reflection-deselect-all").addEventListener("click", () => {
    selectedIds.clear();
    render();
  });
  $("#reflection-delete-selected").addEventListener("click", () => {
    if (!selectedIds.size) return alert("请先选择要删除的记录。");
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录？`)) return;
    items = items.filter((entry) => !selectedIds.has(entry.id));
    if (editingId && selectedIds.has(editingId)) {
      editingId = null;
      input.value = "";
    }
    selectedIds.clear();
    writeJSON(KEYS.reflections, items);
    render();
  });
  $("#reflection-export-selected").addEventListener("click", async () => {
    if (!selectedIds.size) return alert("请先选择要导出的记录。");
    const selected = items.filter((item) => selectedIds.has(item.id)).sort((a, b) => a.date.localeCompare(b.date));
    const content = [
      "专注力历史记录（已选）",
      "",
      ...selected.flatMap((x) => [`【${x.date}】`, x.content, ""]),
    ].join("\r\n");
    if (window.electronAPI)
      await window.electronAPI.saveFile({
        content,
        defaultName: `专注力历史记录_${todayKey()}.txt`,
      });
  });
  $("#reflection-export").addEventListener("click", async () => {
    const all = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const content = [
      "专注力每日反思（全部历史记录）",
      "",
      ...all.flatMap((x) => [`【${x.date}】`, x.content, ""]),
    ].join("\r\n");
    if (window.electronAPI)
      await window.electronAPI.saveFile({
        content,
        defaultName: `专注力反思_${todayKey()}.txt`,
      });
  });
  migrateLegacyAutoBlock();
  writeJSON(KEYS.reflections, items);
  syncCompletedTasks(DailyPlan.getTasks());
  window.electronAPI?.onLongTaskCompleted(syncCompletedLongTask);
  window.electronAPI?.onLongTaskCompletionUndone?.(removeCompletedLongTask);
  const today = items.find(
    (item) => item.date === todayKey() && !item.kind?.startsWith("completed-task"),
  );
  if (today) input.value = today.content;
  render();
  return { syncCompletedTasks, syncCompletedLongTask, removeCompletedLongTask };
})();

function setupStopwatch() {
  let running = false,
    startAt = 0,
    elapsed = 0,
    raf = 0,
    lastLap = 0,
    lapNo = 0;
  const display = $("#sw-time");
  const render = () => {
    const current = elapsed + (running ? performance.now() - startAt : 0);
    display.textContent = formatClock(current, true);
    if (running) raf = requestAnimationFrame(render);
  };
  $("#sw-start").addEventListener("click", () => {
    if (running) return;
    running = true;
    startAt = performance.now();
    $("#sw-start").disabled = true;
    $("#sw-stop").disabled = false;
    $("#sw-lap").disabled = false;
    render();
  });
  $("#sw-stop").addEventListener("click", () => {
    if (!running) return;
    elapsed += performance.now() - startAt;
    running = false;
    cancelAnimationFrame(raf);
    $("#sw-start").disabled = false;
    $("#sw-stop").disabled = true;
    $("#sw-lap").disabled = true;
    render();
  });
  $("#sw-reset").addEventListener("click", () => {
    if (running) return;
    elapsed = 0;
    lastLap = 0;
    lapNo = 0;
    $("#lap-list").replaceChildren();
    render();
  });
  $("#sw-lap").addEventListener("click", () => {
    if (!running) return;
    const total = elapsed + performance.now() - startAt;
    const li = document.createElement("li");
    li.innerHTML = `<span>#${++lapNo}</span><span>${formatClock(total - lastLap, true)}</span><span>${formatClock(total, true)}</span>`;
    lastLap = total;
    $("#lap-list").append(li);
  });
  render();
}

function setupCountdown() {
  let total = 60000,
    remaining = total,
    running = false,
    target = 0,
    timer = null;
  const display = $("#cd-time");
  const read = () =>
    ((Number($("#cd-h").value) || 0) * 3600 +
      (Number($("#cd-m").value) || 0) * 60 +
      (Number($("#cd-s").value) || 0)) *
    1000;
  const render = () => {
    display.textContent = formatClock(remaining);
    $("#cd-progress").style.width = `${total ? (remaining / total) * 100 : 0}%`;
    $("#cd-start").disabled = running || remaining <= 0;
    $("#cd-pause").disabled = !running;
  };
  const tick = () => {
    remaining = Math.max(0, target - Date.now());
    render();
    if (!remaining) {
      clearInterval(timer);
      running = false;
      alarm();
      render();
    }
  };
  const set = (ms) => {
    if (running) return;
    total = remaining = ms;
    const sec = Math.floor(ms / 1000);
    $("#cd-h").value = Math.floor(sec / 3600);
    $("#cd-m").value = Math.floor((sec % 3600) / 60);
    $("#cd-s").value = sec % 60;
    render();
  };
  $("#cd-start").addEventListener("click", () => {
    if (running || !remaining) return;
    running = true;
    target = Date.now() + remaining;
    timer = setInterval(tick, 100);
    render();
  });
  $("#cd-pause").addEventListener("click", () => {
    if (!running) return;
    remaining = Math.max(0, target - Date.now());
    running = false;
    clearInterval(timer);
    render();
  });
  $("#cd-reset").addEventListener("click", () => {
    if (running) return;
    set(read());
  });
  $$(".preset-row button").forEach((x) =>
    x.addEventListener("click", () => set(Number(x.dataset.seconds) * 1000)),
  );
  $$("#cd-h,#cd-m,#cd-s").forEach((x) =>
    x.addEventListener("input", () => set(read())),
  );
  render();
}
setupStopwatch();
setupCountdown();
TimeAudit.render();
setInterval(
  () => {
    FocusMode.checkpoint();
    TimeAudit.render();
  },
  10 * 60 * 1000,
);

if (window.electronAPI) {
  $("#always-on-top").addEventListener("change", async () => {
    $("#always-on-top").checked = await window.electronAPI.toggleAlwaysOnTop();
  });
  window.electronAPI.getAlwaysOnTop().then((value) => {
    $("#always-on-top").checked = value;
  });

  $("#auto-minimize").addEventListener("click", (e) => {
    if (e.target.checked) {
      window.electronAPI.autoMinimize().catch(() => {});
    } else {
      // 取消勾选 = 恢复窗口大小
      window.electronAPI.autoRestore().catch(() => {});
    }
  });

  window.electronAPI.onMinimizedChanged((minimized) => {
    document.body.classList.toggle("is-minimized", minimized);
    if (minimized) {
      switchMode("focus");
      // 卡片界面同时收起模式切换按钮行
      setTabsCollapsed(true);
      // 确保复选框保持勾选，与窗口最小化状态同步
      $("#auto-minimize").checked = true;
    } else {
      document.body.classList.remove("is-minimized");
      $("#auto-minimize").checked = false;
      setTabsCollapsed(false);
    }
  });

  $("#open-stopwatch").addEventListener("click", () =>
    window.electronAPI.openTimerWindow("stopwatch"),
  );
  $("#open-countdown").addEventListener("click", () =>
    window.electronAPI.openTimerWindow("countdown"),
  );
  $("#long-tasks-open").addEventListener("click", async () => {
    $("#long-tasks-open").classList.remove("reminder-alert");
    await window.electronAPI.acknowledgeReminders();
    await window.electronAPI.openLongTasks();
  });
  window.electronAPI.onRemindersDue(() => {
    $("#long-tasks-open").classList.add("reminder-alert");
    playReminderSound();
  });
  window.electronAPI.onRemindersCleared(() => $("#long-tasks-open").classList.remove("reminder-alert"));
}

const timerMode = new URLSearchParams(location.search).get("mode");
if (timerMode === "stopwatch" || timerMode === "countdown") {
  document.body.classList.add("timer-window");
  $("#gate-view").hidden = true;
  $("#mode-shell").hidden = true;
  $("#timer-only").hidden = false;
  $("#stopwatch-panel").hidden = timerMode !== "stopwatch";
  $("#countdown-panel").hidden = timerMode !== "countdown";
  document.title = timerMode === "stopwatch" ? "秒表" : "倒计时";
}
