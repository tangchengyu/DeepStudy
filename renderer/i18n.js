(() => {
  const KEY = "deepstudy.language.v1";
  const dictionaries = {
    "zh-CN": {
      settings: "设置",
      tutorial: "使用教程",
      aiChat: "AI 对话",
      longTasks: "长期任务",
      dailyPlan: "每日计划",
      addTodayTask: "添加今日任务，回车添加",
      clearCompleted: "清除已完成",
      reset: "重置",
      languageTitle: "选择语言",
      languageBody: "DeepStudy 将使用你选择的语言显示界面、使用教程和默认 AI 偏好提示词。",
      continue: "继续",
      chinese: "中文",
      english: "English",
      longTaskBoard: "长期任务备忘录",
      addTask: "新增任务",
      importantUrgent: "重要且紧急",
      importantNotUrgent: "重要不紧急",
      urgentNotImportant: "不重要但紧急",
      notImportantNotUrgent: "不重要不紧急",
    },
    "en-US": {
      settings: "Settings",
      tutorial: "Guide",
      aiChat: "AI Chat",
      longTasks: "Long Tasks",
      dailyPlan: "Daily Plan",
      addTodayTask: "Add today task, Enter to save",
      clearCompleted: "Clear Done",
      reset: "Reset",
      languageTitle: "Choose Language",
      languageBody: "DeepStudy will use this language for the interface, guide, and default AI preference prompts.",
      continue: "Continue",
      chinese: "Chinese",
      english: "English",
      longTaskBoard: "Long Task Board",
      addTask: "Add Task",
      importantUrgent: "Important & Urgent",
      importantNotUrgent: "Important, Not Urgent",
      urgentNotImportant: "Urgent, Not Important",
      notImportantNotUrgent: "Not Important, Not Urgent",
    },
  };

  let current = localStorage.getItem(KEY) || "zh-CN";
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function t(key) {
    return dictionaries[current]?.[key] || dictionaries["zh-CN"][key] || key;
  }

  function apply() {
    document.documentElement.lang = current;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    const textUpdates = [
      ["#tutorial-open", "tutorial"],
      ["#app-settings-open", "settings"],
      ["#chat-toggle", "aiChat"],
      ["#long-tasks-open", "longTasks"],
      ["#clear-completed", "clearCompleted"],
      ["#reset-plan", "reset"],
      [".sidebar-heading h1", "dailyPlan"],
      [".long-task-header h1", "longTaskBoard"],
      ["#long-add", "addTask"],
      ["#quadrant-add", "addTask"],
      ["#long-ai-toggle", "aiChat"],
      ["#quadrant-ai-toggle", "aiChat"],
    ];
    textUpdates.forEach(([selector, key]) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = t(key);
    });
    const planInput = document.querySelector("#plan-input");
    if (planInput) planInput.placeholder = t("addTodayTask");
  }

  function setLanguage(language) {
    current = ["zh-CN", "en-US"].includes(language) ? language : "zh-CN";
    localStorage.setItem(KEY, current);
    apply();
    return current;
  }

  function showLanguageChoice() {
    if (document.body.classList.contains("long-task-window")) {
      resolveReady(current);
      return;
    }
    if (localStorage.getItem(KEY)) {
      resolveReady(current);
      return;
    }
    const layer = document.createElement("div");
    layer.className = "language-choice-layer";
    layer.innerHTML = `
      <section class="language-choice-card" role="dialog" aria-modal="true" aria-labelledby="language-choice-title">
        <div class="eyebrow">LANGUAGE</div>
        <h2 id="language-choice-title">${t("languageTitle")}</h2>
        <p>${t("languageBody")}</p>
        <div class="language-choice-actions">
          <button class="primary-btn" type="button" data-language="zh-CN">${t("chinese")}</button>
          <button class="secondary-btn" type="button" data-language="en-US">${t("english")}</button>
        </div>
      </section>`;
    document.body.append(layer);
    layer.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-language]");
      if (!button) return;
      const language = setLanguage(button.dataset.language);
      try {
        await window.electronAPI?.saveAppPreferences?.({ language });
      } catch (error) {
        console.warn(error);
      }
      layer.remove();
      resolveReady(language);
    });
    layer.querySelector("button")?.focus();
  }

  window.DeepStudyI18n = {
    ready,
    t,
    language: () => current,
    setLanguage,
  };

  window.electronAPI?.getAppPreferences?.()
    .then((preferences) => {
      if (!localStorage.getItem(KEY) && preferences?.language) {
        current = preferences.language;
        if (document.body.classList.contains("long-task-window")) localStorage.setItem(KEY, current);
      }
      apply();
      showLanguageChoice();
    })
    .catch(() => {
      apply();
      showLanguageChoice();
    });
  window.electronAPI?.onAppPreferencesChanged?.((preferences) => {
    if (preferences?.language) setLanguage(preferences.language);
  });
})();
