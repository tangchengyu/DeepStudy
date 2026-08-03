(() => {
  const KEY = "deepstudy.language.v1";
  const dictionaries = {
    "zh-CN": {
      settings: "设置",
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
      importantUrgentDesc: "立即推进，避免失控",
      importantNotUrgentDesc: "持续投入，建立长期优势",
      urgentNotImportantDesc: "快速处理或减少投入",
      notImportantNotUrgentDesc: "谨慎保留，定期清理",
      longTaskSubtitle: "按重要性与紧迫性安排未来，而不是只处理眼前。",
      unfinishedTasks: "项未完成任务",
      markDone: "标记为完成",
      taskName: "任务名称",
      markdownSupport: "支持 Markdown 格式渲染",
      longAiTitle: "长期任务 AI 助手",
      longAiDesc: "变更会先预览，确认后才执行。",
      newChat: "新对话",
      generateChanges: "生成变更",
      myNoise: "我的白噪音",
      stopwatch: "秒表",
      countdown: "倒计时",
      alwaysOnTop: "窗口置顶",
      cardMode: "卡片界面",
      gateAlt: "你的注意力空间",
      gateBody: "确保至少 5 分钟闭眼静心，清除注意力残留后，进入注意力空间。",
      enterGate: "进入注意力空间",
      gateSmall: "守门员不是消灭分心，而是觉察它，并把注意力带回来。",
      focusTab: "专注模式",
      restTab: "休息模式",
      habitTab: "长期习惯构建",
      back: "返回",
      focusTitle: "现在，只做一件事",
      startFocus: "开始专注",
      focusRunning: "专注中",
      continueFocus: "继续专注",
      pause: "暂停",
      resetButton: "重置",
      workTypeTitle: "当前任务类型",
      workTypeDesc: "核心工作：高认知要求、直接推进目标",
      maintenanceWorkDesc: "维持性工作：流程化、支持性的日常事务",
      quickDistraction: "快速添加干扰",
      distractionTitle: "分心清单",
      distractionDesc: "按可控性与趣味性分类，找到下一次的应对方式。",
      distractionPlaceholder: "刚才是什么打断了你？",
      record: "记录",
      restTitle: "把注意力从专注模式切换到分散模式。",
      restLead: "把注意力从",
      restMiddle: "切换到",
      restEnd: "。",
      focusedModeTerm: "专注模式",
      diffuseModeTerm: "分散模式",
      focusedModeTip: "专注模式：大脑像聚光灯般集中资源解决具体问题。",
      diffuseModeTip: "分散模式：大脑在放松状态下让思维发散并建立新的连接。",
      restBody: "在不使用电子产品娱乐的前提下，去做习惯性的、体力性的、亲近自然的、喜欢的事吧！",
      startRest: "开始休息",
      continueRest: "继续休息",
      returnFocus: "返回专注",
      breathingTitle: "呼吸练习",
      breathingDesc: "跟随圆圈节奏呼吸，音频会在本机播放。",
      boxBreathing: "4-4-4-4 腹式呼吸",
      wimHofBreathing: "冰人呼吸法",
      boxBreathingTip: "用等时的吸气、屏息、呼气、屏息帮助身体放松并恢复注意力。",
      wimHofBreathingTip: "短时激活练习。避免饭后练习；如有不适请立即停止，不建议长期高频使用。",
      habitTarget: "长期目标",
      habitTargetValue: "争取每日总专注时长达到 6 小时，每周达到 40 小时。",
      timeAudit: "时间审计",
      auditDescription: "核心工作、维持工作、主动休息与分心的真实分配。",
      reflection: "每日反思",
      settingsTitle: "DeepStudy 设置",
      settingsIntro: "统一管理语言、API、AI 助手、好句库与使用教程。",
      navGeneral: "常规与语言",
      navApi: "新建 API 配置",
      navDailyAi: "每日任务 AI",
      navLongAi: "长期任务 AI",
      navSoul: "灵魂按摩间",
      navHelp: "使用教程",
      apiTest: "一键测试",
      saveApi: "保存 API 配置",
      dailyAiSave: "保存每日任务 AI 设置",
      longAiSave: "保存长期任务 AI 设置",
      generatePlan: "生成计划",
      plannerPlaceholder: "告诉我今天想完成什么",
      plannerTitle: "AI 计划助手",
      planEmpty: "还没有计划",
      chatConfigLoading: "正在读取 API 配置…",
      noiseRate: "播放速率",
      noiseVolume: "白噪音音量",
      customNoise: "自定义白噪音",
      dropAudio: "拖入音频文件",
      chooseFile: "选择文件",
      add: "添加",
      generalHelp: "首次安装后会先选择语言，再进入使用教程。切换语言后，主界面、教程和默认 AI 偏好提示词会随之更新。",
      interfaceLanguage: "界面语言",
      apiTutorial: "免费 API 配置教程",
      apiHelp: "支持 OpenAI 兼容接口，例如 OpenRouter、OpenAI、DeepSeek、通义千问及自建服务。这里保存的 API 可供每日任务和长期任务 AI 共同选择。",
      savedApi: "已保存的 API",
      clearNew: "清空新建",
      deleteApi: "删除此 API",
      savedCredential: "此配置的凭据已安全保存，可直接使用",
      changeApiKey: "更换 API Key",
      profileName: "配置名称",
      commonModel: "常用模型",
      customModel: "自定义模型",
      modelName: "模型名称",
      apiKey: "API Key",
      dailyAiHelp: "这里只选择已保存 API，并编辑你的偏好提示词。任务输出格式、安全解析规则由 DeepStudy 内部固定维护，避免误改后任务创建失败。",
      longAiHelp: "这里只选择已保存 API，并编辑长期任务助手的偏好提示词。任务创建格式、四象限规则和提醒规则由 DeepStudy 内部固定维护。",
      usedApi: "使用的 API",
      selectSavedApi: "选择已保存 API",
      dailyPrompt: "短期任务偏好提示词",
      longPrompt: "长期任务偏好提示词",
      quoteLabel: "好句子",
      quotePlaceholder: "写下一句你想保存的话",
      cancelEdit: "取消修改",
      addQuote: "添加句子",
      defaultQuoteLibrary: "使用默认的“好句库”",
      helpText: "教程会介绍每日任务、长期任务、右键菜单、复选框完成逻辑、AI 设置和 API 配置流程。建议第一次配置模型 API 后重新查看一遍。",
      openGuide: "打开使用教程",
      alertTitle: "提示",
      gotIt: "知道了",
      resetConfirmTitle: "清空今天的计划？",
      resetConfirmText: "确认后会移除今日所有任务，操作只影响每日计划列表。",
      cancel: "取消",
      confirmClear: "确认清空",
      maintenance: "维持性",
      core: "核心",
      focusLoop: "专注中 → 被干扰 → 觉察分心 → 注意力转回",
      controllable: "可控",
      uncontrollable: "不可控",
      interesting: "有意思",
      boring: "没意思",
      controllableInteresting: "可控 + 有意思",
      controllableBoring: "可控 + 没意思",
      uncontrollableInteresting: "不可控 + 有意思",
      uncontrollableBoring: "不可控 + 没意思",
      handleAhead: "提前处理掉",
      pauseAndReturn: "顿一下再回来",
      setBoundaries: "预设边界并规避",
      noRecords: "暂无记录",
      unnamedDistraction: "未命名干扰",
      deleteDistraction: "删除干扰",
      expand: "展开",
      collapse: "收起",
      reflectionHelp: "每周末可将前 7 天记录导出，交给自动化整理成周报。",
      reflectionPlaceholder: "今天在专注力管理方面有什么心得？今天又学到了哪些知识？见识了哪些风景？遇到了哪些挫折？哪些地方可以改进？",
      save: "保存",
      exportAll: "导出全部 TXT",
      history: "历史记录",
      selectAll: "全选",
      deselectAll: "取消全选",
      exportSelected: "导出选中 TXT",
      deleteSelected: "删除选中",
      focusDurationTitle: "选择专注时长",
      customFocusTime: "自定义专注时间",
      minutes: "分钟",
      start: "开始",
      stop: "停止",
      lap: "计次",
      notConfigured: "未配置",
      apiReady: "API 运行",
      dragSort: "拖动排序",
      removePriority: "取消优先任务",
      addPriority: "加入优先任务",
      readingConfig: "正在读取配置…",
      saving: "正在保存…",
      savedApiStatus: "API 配置已保存。",
      savingDailyAi: "正在保存每日任务 AI 设置…",
      savedDailyAi: "每日任务 AI 设置已保存。",
      savingLongAi: "正在保存长期任务 AI 设置…",
      savedLongAi: "长期任务 AI 设置已保存。",
      testingApi: "正在测试 API…",
      testSuccess: "验证成功",
      testFailed: "验证失败",
      deleteApiConfirm: "删除已保存的 API 配置",
      deletingApi: "正在删除 API 配置…",
      deletedApi: "API 配置已删除。",
      languageSaved: "语言设置已保存。",
      newApiStatus: "正在新建 API 配置，请填写名称和 API Key。",
      selectedProfile: "已选择此 API，可直接保存并使用。",
      modelChanged: "模型信息已修改，请输入 API Key 保存为新配置。",
      addPlanResult: "已添加 {count} 项到今日计划。",
      muteNoise: "静音白噪音",
      unmuteNoise: "恢复白噪音音量",
      play: "播放",
      pauseVerb: "暂停",
      loadingNoise: "正在加载{name}…",
      playingNoise: "正在播放{name}。",
      pausedNoise: "已暂停{name}。",
      selectAudioFile: "请选择音频文件。",
      selectedFile: "已选择：{name}",
      adding: "正在添加...",
      noiseAdded: "已添加到我的白噪音。",
      addFailed: "添加失败。",
      muyuNoise: "木鱼白噪音",
      rainNoise: "雨声白噪音",
      pastedImageAlt: "粘贴的图片",
      imageReadFailed: "本地图片读取失败。",
      imageSaveFailed: "本地图片保存失败。",
      dragLongTask: "拖动排序或移动象限",
      containsNotes: "包含备注",
      copyToToday: "复制到今日任务",
      delete: "删除",
      reminderPrefix: "提醒",
      reminderOnce: "单次",
      reminderDaily: "每天",
      reminderWeekly: "每周",
      taskNameRequired: "任务名称不能为空",
      autoSaving: "正在保存...",
      autoSaved: "已自动保存",
      addLongTask: "新增长期任务",
      editLongTask: "编辑长期任务",
      notes: "备注",
      quadrant: "所属象限",
      reminderType: "提醒方式",
      noReminder: "不提醒",
      onceReminder: "单次提醒",
      dailyReminder: "每天",
      weeklyReminder: "每周",
      dateAndTime: "日期和时间",
      reminderTime: "提醒时间",
      repeatWeekday: "重复星期",
      saveTask: "保存任务",
      moreTaskActions: "更多任务操作",
      minuteCount: "{count} 分钟",
      modalAlert: "注意力正在离开球门",
      modalTitle: "先停一下，觉察发生了什么",
      modalHelp: "两分钟内处理或记下干扰，然后回到当前任务。",
      modalPlaceholder: "这次干扰是什么？",
      endDistraction: "结束分心",
      continueResolving: "继续解决干扰",
      distractionTiming: "正在记录干扰处理时长。处理完后立即回到专注。",
      distractionTimeUp: "两分钟已到。请选择回到专注，或明确继续解决。",
      editRestDuration: "修改休息时长",
      hourShort: "时",
      minuteShort: "分",
      secondShort: "秒",
    },
    "en-US": {
      settings: "Settings",
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
      importantUrgentDesc: "Move now and prevent loss of control",
      importantNotUrgentDesc: "Invest steadily and build long-term advantage",
      urgentNotImportantDesc: "Handle quickly or reduce investment",
      notImportantNotUrgentDesc: "Keep selectively and clean up regularly",
      longTaskSubtitle: "Plan the future by importance and urgency, not just what is in front of you.",
      unfinishedTasks: "unfinished task(s)",
      markDone: "Mark as done",
      taskName: "Task Name",
      markdownSupport: "Supports Markdown rendering",
      longAiTitle: "Long Task AI Assistant",
      longAiDesc: "Changes are previewed first and applied only after confirmation.",
      newChat: "New Chat",
      generateChanges: "Generate Changes",
      myNoise: "White Noise",
      stopwatch: "Stopwatch",
      countdown: "Countdown",
      alwaysOnTop: "Always on Top",
      cardMode: "Card View",
      gateAlt: "Your attention space",
      gateBody: "Close your eyes for at least 5 minutes, clear attention residue, then enter your attention space.",
      enterGate: "Enter Focus Space",
      gateSmall: "The keeper does not destroy distraction. It notices it and brings attention back.",
      focusTab: "Focus Mode",
      restTab: "Rest Mode",
      habitTab: "Habit Building",
      back: "Back",
      focusTitle: "Now, Do One Thing",
      startFocus: "Start Focus",
      focusRunning: "Focusing",
      continueFocus: "Resume Focus",
      pause: "Pause",
      resetButton: "Reset",
      workTypeTitle: "Current Work Type",
      workTypeDesc: "Core work: high-cognition work that directly advances goals.",
      maintenanceWorkDesc: "Maintenance work: routine, supportive work that keeps things running.",
      quickDistraction: "Quick Add Distraction",
      distractionTitle: "Distraction List",
      distractionDesc: "Sort by control and interest, then find a better response next time.",
      distractionPlaceholder: "What interrupted you just now?",
      record: "Record",
      restTitle: "Shift from focused mode to diffuse mode.",
      restLead: "Shift attention from ",
      restMiddle: " to ",
      restEnd: ".",
      focusedModeTerm: "focused mode",
      diffuseModeTerm: "diffuse mode",
      focusedModeTip: "Focused mode concentrates mental resources on a specific problem.",
      diffuseModeTip: "Diffuse mode lets the mind relax, wander, and form new connections.",
      restBody: "Rest without digital entertainment. Move, breathe, go outside, or do something simple and restorative.",
      startRest: "Start Rest",
      continueRest: "Resume Rest",
      returnFocus: "Return to Focus",
      breathingTitle: "Breathing Practice",
      breathingDesc: "Follow the circle rhythm. Audio plays locally on this computer.",
      boxBreathing: "4-4-4-4 Box Breathing",
      wimHofBreathing: "Wim Hof Breathing",
      boxBreathingTip: "Use equal inhale, hold, exhale, and hold phases to relax and restore attention.",
      wimHofBreathingTip: "A short activation exercise. Avoid it after meals, stop if uncomfortable, and do not practice it at high frequency.",
      habitTarget: "Long-Term Goal",
      habitTargetValue: "Aim for 6 focused hours per day and 40 focused hours per week.",
      timeAudit: "Time Audit",
      auditDescription: "See the real distribution of core work, maintenance, active rest, and distraction.",
      reflection: "Daily Reflection",
      settingsTitle: "DeepStudy Settings",
      settingsIntro: "Manage language, APIs, AI tools, quote room, and the guide in one place.",
      navGeneral: "General & Language",
      navApi: "New API Configuration",
      navDailyAi: "Daily Task AI",
      navLongAi: "Long Task AI",
      navSoul: "Quote Room",
      navHelp: "Guide",
      apiTest: "Test Once",
      saveApi: "Save API Profile",
      dailyAiSave: "Save Daily AI Settings",
      longAiSave: "Save Long Task AI Settings",
      generatePlan: "Generate Plan",
      plannerPlaceholder: "Tell me what you want to finish today",
      plannerTitle: "AI Plan Assistant",
      planEmpty: "No plan yet",
      chatConfigLoading: "Reading API configuration...",
      noiseRate: "Playback Speed",
      noiseVolume: "White Noise Volume",
      customNoise: "Custom White Noise",
      dropAudio: "Drop audio file here",
      chooseFile: "Choose File",
      add: "Add",
      generalHelp: "On first launch, choose a language before the guide starts. After switching language, the main UI, guide, and default AI preference prompts update together.",
      interfaceLanguage: "Interface Language",
      apiTutorial: "Free API Setup Guide",
      apiHelp: "Supports OpenAI-compatible APIs such as OpenRouter, OpenAI, DeepSeek, Qwen, and self-hosted services. Saved APIs can be shared by Daily Task AI and Long Task AI.",
      savedApi: "Saved API",
      clearNew: "Clear for New",
      deleteApi: "Delete This API",
      savedCredential: "This profile's credential is saved securely and can be used directly.",
      changeApiKey: "Change API Key",
      profileName: "Profile Name",
      commonModel: "Common Model",
      customModel: "Custom Model",
      modelName: "Model Name",
      apiKey: "API Key",
      dailyAiHelp: "Choose a saved API and edit your preference prompt. Output format and parsing rules are maintained internally by DeepStudy so task creation stays reliable.",
      longAiHelp: "Choose a saved API and edit the long-task assistant preference prompt. Task creation format, quadrant rules, and reminder rules are maintained internally by DeepStudy.",
      usedApi: "API to Use",
      selectSavedApi: "Select Saved API",
      dailyPrompt: "Short-Term Task Preference Prompt",
      longPrompt: "Long Task Preference Prompt",
      quoteLabel: "Saved Sentence",
      quotePlaceholder: "Write a sentence you want to save",
      cancelEdit: "Cancel Edit",
      addQuote: "Add Sentence",
      defaultQuoteLibrary: "Use Default Quote Library",
      helpText: "The guide explains daily tasks, long tasks, right-click menus, checkbox completion, AI settings, and API setup. Review it again after configuring a model API.",
      openGuide: "Open Guide",
      alertTitle: "Notice",
      gotIt: "Got it",
      resetConfirmTitle: "Clear today's plan?",
      resetConfirmText: "This removes all tasks from today's Daily Plan list only.",
      cancel: "Cancel",
      confirmClear: "Clear",
      maintenance: "Maintenance",
      core: "Core",
      focusLoop: "Focused → Interrupted → Notice → Return",
      controllable: "Controllable",
      uncontrollable: "Uncontrollable",
      interesting: "Interesting",
      boring: "Boring",
      controllableInteresting: "Controllable + Interesting",
      controllableBoring: "Controllable + Boring",
      uncontrollableInteresting: "Uncontrollable + Interesting",
      uncontrollableBoring: "Uncontrollable + Boring",
      handleAhead: "Handle it ahead of time",
      pauseAndReturn: "Pause, then return",
      setBoundaries: "Set a boundary and avoid it",
      noRecords: "No records yet",
      unnamedDistraction: "Unnamed distraction",
      deleteDistraction: "Delete distraction",
      expand: "Expand",
      collapse: "Collapse",
      reflectionHelp: "At the end of the week, export the last 7 days and turn them into a weekly review.",
      reflectionPlaceholder: "What did you learn about focus today? What did you learn, see, struggle with, or want to improve?",
      save: "Save",
      exportAll: "Export All TXT",
      history: "History",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      exportSelected: "Export Selected TXT",
      deleteSelected: "Delete Selected",
      focusDurationTitle: "Choose Focus Duration",
      customFocusTime: "Custom Focus Time",
      minutes: "min",
      start: "Start",
      stop: "Stop",
      lap: "Lap",
      notConfigured: "Not configured",
      apiReady: "API Ready",
      dragSort: "Drag to reorder",
      removePriority: "Remove Priority",
      addPriority: "Mark Priority",
      readingConfig: "Reading configuration...",
      saving: "Saving...",
      savedApiStatus: "API profile saved.",
      savingDailyAi: "Saving Daily AI settings...",
      savedDailyAi: "Daily AI settings saved.",
      savingLongAi: "Saving Long Task AI settings...",
      savedLongAi: "Long Task AI settings saved.",
      testingApi: "Testing API...",
      testSuccess: "Test Passed",
      testFailed: "Test Failed",
      deleteApiConfirm: "Delete saved API profile",
      deletingApi: "Deleting API profile...",
      deletedApi: "API profile deleted.",
      languageSaved: "Language setting saved.",
      newApiStatus: "Creating a new API profile. Fill in name and API Key.",
      selectedProfile: "Selected this API. You can save and use it directly.",
      modelChanged: "Model information changed. Enter an API Key to save a new profile.",
      addPlanResult: "Added {count} item(s) to Daily Plan.",
      muteNoise: "Mute white noise",
      unmuteNoise: "Restore white noise volume",
      play: "Play",
      pauseVerb: "Pause",
      loadingNoise: "Loading {name}...",
      playingNoise: "Playing {name}.",
      pausedNoise: "Paused {name}.",
      selectAudioFile: "Choose an audio file.",
      selectedFile: "Selected: {name}",
      adding: "Adding...",
      noiseAdded: "Added to White Noise.",
      addFailed: "Add failed.",
      muyuNoise: "Wooden Fish White Noise",
      rainNoise: "Rain White Noise",
      pastedImageAlt: "Pasted image",
      imageReadFailed: "Could not read the local image.",
      imageSaveFailed: "Could not save the local image.",
      dragLongTask: "Drag to reorder or move to another quadrant",
      containsNotes: "Contains notes",
      copyToToday: "Copy to Daily Plan",
      delete: "Delete",
      reminderPrefix: "Reminder",
      reminderOnce: "Once",
      reminderDaily: "Daily",
      reminderWeekly: "Weekly",
      taskNameRequired: "Task name is required",
      autoSaving: "Saving...",
      autoSaved: "Saved automatically",
      addLongTask: "Add Long Task",
      editLongTask: "Edit Long Task",
      notes: "Notes",
      quadrant: "Quadrant",
      reminderType: "Reminder",
      noReminder: "No reminder",
      onceReminder: "Once",
      dailyReminder: "Daily",
      weeklyReminder: "Weekly",
      dateAndTime: "Date and Time",
      reminderTime: "Reminder Time",
      repeatWeekday: "Repeat On",
      saveTask: "Save Task",
      moreTaskActions: "More task actions",
      minuteCount: "{count} min",
      modalAlert: "Your attention is drifting",
      modalTitle: "Pause and notice what happened",
      modalHelp: "Handle or record the distraction within two minutes, then return to your task.",
      modalPlaceholder: "What distracted you?",
      endDistraction: "End Distraction",
      continueResolving: "Keep Resolving",
      distractionTiming: "Timing this distraction. Return to focus as soon as it is handled.",
      distractionTimeUp: "Two minutes are up. Return to focus or explicitly continue resolving it.",
      editRestDuration: "Edit rest duration",
      hourShort: "hr",
      minuteShort: "min",
      secondShort: "sec",
    },
  };

  let current = localStorage.getItem(KEY) || "zh-CN";
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function t(key, replacements = {}) {
    let value = dictionaries[current]?.[key] || dictionaries["zh-CN"][key] || key;
    Object.entries(replacements).forEach(([name, replacement]) => {
      value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
  }

  function apply() {
    document.documentElement.lang = current;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    const textUpdates = [
      ["#app-settings-open", "settings"],
      ["#chat-toggle", "aiChat"],
      ["#planner-send", "generatePlan"],
      ["#noise-menu-button", "myNoise"],
      ["#open-stopwatch", "stopwatch"],
      ["#open-countdown", "countdown"],
      ["#long-tasks-open", "longTasks"],
      ["#clear-completed", "clearCompleted"],
      ["#reset-plan", "reset"],
      [".sidebar-heading h1", "dailyPlan"],
      ["#back-to-gate span:last-child", "back"],
      ['.mode-tab[data-mode="focus"] span:last-child', "focusTab"],
      ['.mode-tab[data-mode="rest"] span:last-child', "restTab"],
      ['.mode-tab[data-mode="habit"] span:last-child', "habitTab"],
      ["#gate-view p", "gateBody"],
      ["#enter-gate", "enterGate"],
      ["#gate-view small", "gateSmall"],
      ["#focus-mode .section-header h2", "focusTitle"],
      ["#focus-start", "startFocus"],
      ["#focus-pause", "pause"],
      ["#focus-reset", "resetButton"],
      [".work-type-card strong", "workTypeTitle"],
      ["#work-type-description", "workTypeDesc"],
      ["#quick-distraction", "quickDistraction"],
      [".distraction-card h3", "distractionTitle"],
      [".distraction-card .card-title-row p", "distractionDesc"],
      ['#distraction-form button[type="submit"]', "record"],
      ["#rest-start", "startRest"],
      ["#rest-pause", "pause"],
      ["#rest-reset", "resetButton"],
      ["#rest-return-focus", "returnFocus"],
      ["#breathing-card h3", "breathingTitle"],
      ["#breathing-card > p", "breathingDesc"],
      ['.breathing-btn[data-kind="box"] .term-tip', "boxBreathing"],
      ['.breathing-btn[data-kind="wim"] .term-tip', "wimHofBreathing"],
      [".target-banner strong", "habitTarget"],
      [".target-banner span", "habitTargetValue"],
      ['#habit-mode .card h3', "timeAudit"],
      ['#habit-mode > .card .card-title-row p', "auditDescription"],
      [".reflection-card h3", "reflection"],
      ["#planner-settings-title", "settingsTitle"],
      [".app-settings-top p", "settingsIntro"],
      ['[data-settings-section="general"]', "navGeneral"],
      ['[data-settings-section="api"]', "navApi"],
      ['[data-settings-section="daily-ai"]', "navDailyAi"],
      ['[data-settings-section="long-ai"]', "navLongAi"],
      ['[data-settings-section="soul"]', "navSoul"],
      ['[data-settings-section="help"]', "navHelp"],
      ['[data-section="general"] h3', "navGeneral"],
      ['[data-section="api"] h3', "navApi"],
      ['[data-section="daily-ai"] h3', "navDailyAi"],
      ['[data-section="long-ai"] h3', "navLongAi"],
      ['[data-section="soul"] h3', "navSoul"],
      ['[data-section="help"] h3', "navHelp"],
      ["#api-test", "apiTest"],
      ["#planner-settings-save", "saveApi"],
      ["#daily-ai-save", "dailyAiSave"],
      ["#long-ai-save-main", "longAiSave"],
      [".long-task-header h1", "longTaskBoard"],
      ["#long-add", "addTask"],
      ["#quadrant-add", "addTask"],
      ["#long-ai-toggle", "aiChat"],
      ["#quadrant-ai-toggle", "aiChat"],
      [".long-task-header p", "longTaskSubtitle"],
      ['[data-quadrant="important-urgent"] .quadrant-heading strong', "importantUrgent"],
      ['[data-quadrant="important-not-urgent"] .quadrant-heading strong', "importantNotUrgent"],
      ['[data-quadrant="urgent-not-important"] .quadrant-heading strong', "urgentNotImportant"],
      ['[data-quadrant="not-important-not-urgent"] .quadrant-heading strong', "notImportantNotUrgent"],
      ['[data-quadrant="important-urgent"] .quadrant-heading small', "importantUrgentDesc"],
      ['[data-quadrant="important-not-urgent"] .quadrant-heading small', "importantNotUrgentDesc"],
      ['[data-quadrant="urgent-not-important"] .quadrant-heading small', "urgentNotImportantDesc"],
      ['[data-quadrant="not-important-not-urgent"] .quadrant-heading small', "notImportantNotUrgentDesc"],
      [".task-detail-complete span", "markDone"],
      [".task-detail-title-field span", "taskName"],
      [".task-detail-notes-field > span", "markdownSupport"],
      ["#long-ai-panel header strong", "longAiTitle"],
      ["#long-ai-panel header p", "longAiDesc"],
      ["#long-ai-new", "newChat"],
      ["#long-ai-settings", "settings"],
      ["#long-ai-send", "generateChanges"],
      ["#long-task-form-title", "addLongTask"],
      ['#long-task-form button[type="submit"]', "saveTask"],
    ];
    textUpdates.forEach(([selector, key]) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = t(key);
    });
    const setText = (selector, key) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = t(key);
    };
    const setLabelText = (selector, key) => {
      const label = document.querySelector(selector);
      if (!label) return;
      const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = t(key);
      else {
        const span = label.querySelector("span");
        if (span) span.textContent = t(key);
      }
    };
    const setSelectOption = (selector, value, key) => {
      const option = document.querySelector(`${selector} option[value="${value}"]`);
      if (option) option.textContent = t(key);
    };
    [
      ["#planner-chat .chat-header strong", "plannerTitle"],
      ["#planner-config", "chatConfigLoading"],
      ["#plan-empty", "planEmpty"],
      [".noise-rate-row label", "noiseRate"],
      ["#noise-custom-toggle", "customNoise"],
      ["#noise-dropzone", "dropAudio"],
      ["#noise-pick-file", "chooseFile"],
      ["#noise-add-file", "add"],
      ['[data-section="general"] .settings-help', "generalHelp"],
      ["#free-api-tutorial", "apiTutorial"],
      ['[data-section="api"] .settings-help', "apiHelp"],
      ["#api-profile-new", "clearNew"],
      ["#api-profile-delete", "deleteApi"],
      ["#api-saved-credential span", "savedCredential"],
      ["#api-key-change", "changeApiKey"],
      ['[data-section="daily-ai"] .settings-help', "dailyAiHelp"],
      ['[data-section="long-ai"] .settings-help', "longAiHelp"],
      ["#soul-form label span", "quoteLabel"],
      ["#soul-cancel-edit", "cancelEdit"],
      ["#soul-save", "addQuote"],
      ["#soul-default-library-toggle", "defaultQuoteLibrary"],
      ['[data-section="help"] .settings-help', "helpText"],
      ["#settings-open-tutorial", "openGuide"],
      ["#app-alert-title", "alertTitle"],
      ["#app-alert-ok", "gotIt"],
      ["#reset-confirm-title", "resetConfirmTitle"],
      ["#reset-confirm-modal p", "resetConfirmText"],
      ["#reset-confirm-cancel", "cancel"],
      ["#reset-confirm-ok", "confirmClear"],
      [".switch-row .maintenance-label", "maintenance"],
      [".switch-row .core-label", "core"],
      [".reflection-card > p", "reflectionHelp"],
      ["#reflection-save", "save"],
      ["#reflection-export", "exportAll"],
      [".history-header h4", "history"],
      ["#reflection-select-all", "selectAll"],
      ["#reflection-deselect-all", "deselectAll"],
      ["#reflection-export-selected", "exportSelected"],
      ["#reflection-delete-selected", "deleteSelected"],
      ["#focus-duration-title", "focusDurationTitle"],
      ["#focus-duration-cancel", "cancel"],
      ['#focus-duration-form button[type="submit"]', "startFocus"],
      ["#sw-start", "start"],
      ["#sw-stop", "stop"],
      ["#sw-reset", "resetButton"],
      ["#sw-lap", "lap"],
      ["#cd-start", "start"],
      ["#cd-pause", "pause"],
      ["#cd-reset", "resetButton"],
      [".modal-alert", "modalAlert"],
      ["#distraction-modal h2", "modalTitle"],
      ["#modal-help", "modalHelp"],
      ["#modal-end", "endDistraction"],
      ["#modal-continue", "continueResolving"],
    ].forEach(([selector, key]) => setText(selector, key));
    const restMessage = document.querySelector(".rest-message");
    if (restMessage) {
      const lines = restMessage.querySelectorAll(":scope > span");
      if (lines[0]) {
        const focused = document.createElement("span");
        focused.className = "term-tip";
        focused.tabIndex = 0;
        focused.title = t("focusedModeTip");
        focused.textContent = t("focusedModeTerm");
        const diffuse = document.createElement("span");
        diffuse.className = "term-tip";
        diffuse.tabIndex = 0;
        diffuse.title = t("diffuseModeTip");
        diffuse.textContent = t("diffuseModeTerm");
        lines[0].replaceChildren(document.createTextNode(t("restLead")), focused, document.createTextNode(t("restMiddle")), diffuse, document.createTextNode(t("restEnd")));
      }
      if (lines[1]) lines[1].textContent = t("restBody");
    }
    setLabelText('label:has(#app-language-select)', "interfaceLanguage");
    setLabelText('label:has(#api-profile-select)', "savedApi");
    setLabelText('label:has(#api-profile-name)', "profileName");
    setLabelText('label:has(#api-model-preset)', "commonModel");
    setLabelText('label:has(#api-model)', "modelName");
    setLabelText('label:has(#api-key)', "apiKey");
    setLabelText('label:has(#daily-ai-profile-select)', "usedApi");
    setLabelText('label:has(#long-ai-profile-select-main)', "usedApi");
    setLabelText('label:has(#planner-system-prompt)', "dailyPrompt");
    setLabelText('label:has(#long-system-prompt-main)', "longPrompt");
    setLabelText('label:has(#focus-duration-input)', "customFocusTime");
    setLabelText('label:has(#long-task-title)', "taskName");
    setLabelText('label:has(#long-task-notes)', "notes");
    setLabelText('label:has(#long-task-quadrant)', "quadrant");
    setLabelText('label:has(#long-reminder-kind)', "reminderType");
    setLabelText('label:has(#long-reminder-at)', "dateAndTime");
    setLabelText('label:has(#long-reminder-clock)', "reminderTime");
    const repeatLegend = document.querySelector("#long-reminder-weekdays legend");
    if (repeatLegend) repeatLegend.textContent = t("repeatWeekday");
    setSelectOption("#api-model-preset", "custom", "customModel");
    setSelectOption("#api-profile-select", "", "navApi");
    setSelectOption("#daily-ai-profile-select", "", "selectSavedApi");
    setSelectOption("#long-ai-profile-select-main", "", "selectSavedApi");
    setSelectOption("#long-reminder-kind", "none", "noReminder");
    setSelectOption("#long-reminder-kind", "once", "onceReminder");
    setSelectOption("#long-reminder-kind", "daily", "dailyReminder");
    setSelectOption("#long-reminder-kind", "weekly", "weeklyReminder");
    setSelectOption("#long-task-quadrant", "important-urgent", "importantUrgent");
    setSelectOption("#long-task-quadrant", "important-not-urgent", "importantNotUrgent");
    setSelectOption("#long-task-quadrant", "urgent-not-important", "urgentNotImportant");
    setSelectOption("#long-task-quadrant", "not-important-not-urgent", "notImportantNotUrgent");
    document.querySelectorAll('#distraction-control option[value="controllable"], #modal-control option[value="controllable"]').forEach((option) => option.textContent = t("controllable"));
    document.querySelectorAll('#distraction-control option[value="uncontrollable"], #modal-control option[value="uncontrollable"]').forEach((option) => option.textContent = t("uncontrollable"));
    document.querySelectorAll('#distraction-interest option[value="interesting"], #modal-interest option[value="interesting"]').forEach((option) => option.textContent = t("interesting"));
    document.querySelectorAll('#distraction-interest option[value="boring"], #modal-interest option[value="boring"]').forEach((option) => option.textContent = t("boring"));
    const noiseVolumeLabel = document.querySelector(".noise-volume-row label");
    const volumeValue = document.querySelector("#volume-value")?.textContent || "";
    if (noiseVolumeLabel) noiseVolumeLabel.innerHTML = `${t("noiseVolume")} <span id="volume-value">${volumeValue}</span>`;
    const loopBanner = document.querySelector(".loop-banner");
    if (loopBanner) {
      const parts = t("focusLoop").split("→").map((part) => part.trim());
      loopBanner.replaceChildren();
      parts.forEach((part, index) => {
        const span = document.createElement("span");
        span.textContent = part;
        loopBanner.append(span);
        if (index < parts.length - 1) {
          const arrow = document.createElement("b");
          arrow.textContent = "→";
          loopBanner.append(arrow);
        }
      });
    }
    const planInput = document.querySelector("#plan-input");
    if (planInput) planInput.placeholder = t("addTodayTask");
    const plannerInput = document.querySelector("#planner-input");
    if (plannerInput) plannerInput.placeholder = t("plannerPlaceholder");
    const distractionInput = document.querySelector("#distraction-input");
    if (distractionInput) distractionInput.placeholder = t("distractionPlaceholder");
    const soulInput = document.querySelector("#soul-input");
    if (soulInput) soulInput.placeholder = t("quotePlaceholder");
    const reflectionInput = document.querySelector("#reflection-input");
    if (reflectionInput) reflectionInput.placeholder = t("reflectionPlaceholder");
    const modalDistractionInput = document.querySelector("#modal-distraction-text");
    if (modalDistractionInput) modalDistractionInput.placeholder = t("modalPlaceholder");
    document.querySelectorAll(".focus-duration-preset").forEach((button) => {
      button.textContent = t("minuteCount", { count: button.dataset.minutes });
    });
    document.querySelectorAll(".preset-row button[data-seconds]").forEach((button) => {
      button.textContent = t("minuteCount", { count: Number(button.dataset.seconds) / 60 });
    });
    const quadrantCount = document.querySelector("#quadrant-view-count")?.parentElement;
    if (quadrantCount) {
      const countValue = document.querySelector("#quadrant-view-count")?.textContent || "0";
      quadrantCount.textContent = "";
      const countSpan = document.createElement("span");
      countSpan.id = "quadrant-view-count";
      countSpan.textContent = countValue;
      quadrantCount.append(countSpan, ` ${t("unfinishedTasks")}`);
    }
    const gateImage = document.querySelector(".attention-arena img");
    if (gateImage) {
      gateImage.src = current === "en-US" ? "assets/focus-gate-en.png" : "assets/focus-gate.png";
      gateImage.alt = t("gateAlt");
    }
    const alwaysOnTop = document.querySelector('label:has(#always-on-top)');
    if (alwaysOnTop) alwaysOnTop.lastChild.textContent = ` ${t("alwaysOnTop")}`;
    const cardMode = document.querySelector('label:has(#auto-minimize)');
    if (cardMode) cardMode.lastChild.textContent = ` ${t("cardMode")}`;
    const taskDetailMenu = document.querySelector("#task-detail-menu");
    if (taskDetailMenu) taskDetailMenu.setAttribute("aria-label", t("moreTaskActions"));
    const boxBreathing = document.querySelector('.breathing-btn[data-kind="box"]');
    if (boxBreathing) boxBreathing.title = t("boxBreathingTip");
    const wimBreathing = document.querySelector('.breathing-btn[data-kind="wim"]');
    if (wimBreathing) wimBreathing.title = t("wimHofBreathingTip");
  }

  function setLanguage(language) {
    current = ["zh-CN", "en-US"].includes(language) ? language : "zh-CN";
    localStorage.setItem(KEY, current);
    apply();
    return current;
  }

  function showLanguageChoice() {
    if (document.body.classList.contains("long-task-window") || document.body.classList.contains("timer-window")) {
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
      if (preferences?.language) {
        current = preferences.language;
        const secondaryWindow = document.body.classList.contains("long-task-window") || document.body.classList.contains("timer-window");
        if (secondaryWindow || localStorage.getItem(KEY)) localStorage.setItem(KEY, current);
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
