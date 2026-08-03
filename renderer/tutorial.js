(() => {
  const SEEN_KEY = "deepstudy.tutorial.seen.v1";
  const launchButton = document.querySelector("#tutorial-open");
  const timerMode = new URLSearchParams(location.search).get("mode");
  if (!launchButton || timerMode) return;

  const steps = [
    {
      target: "#top-bar",
      title: "欢迎来到DeepStudy",
      description: "DeepStudy——一款“超级专注力管理”桌面应用。精选最科学、最有效的专注力管理办法，形成一个完整的专注力工作流。将“每日计划 + AI 辅助规划、短期 + 长期任务规划、专注计时 + 分心记录、呼吸练习 + 白噪音、时间审计 + 周报总结”等功能整合在一个应用中，助你在信息爆炸的时代做回专注的自己。",
      view: "gate",
    },
    {
      target: "#daily-plan-sidebar",
      title: "先把今天变得清晰",
      description: "在每日计划中输入任务并按回车添加，勾选即可完成。完成记录会自动进入“长期习惯构建”的每日反思；右键今日任务可加入或取消优先任务，底部的“清除已完成”用于整理当天列表。",
      view: "gate",
    },
    {
      target: "#chat-toggle",
      title: "让 AI 帮你拆解计划",
      description: "打开 AI 对话后，可以描述今天的目标，由计划助手整理成可执行任务；右上角设置按钮用于配置你自己的 API。",
      view: "gate",
    },
    {
      target: "#noise-control",
      title: "用稳定声音保护注意力",
      description: "“我的白噪音”提供内置音轨、音量和倍速控制，也支持拖入本地音频。它适合掩蔽突发环境噪声。",
      view: "gate",
    },
    {
      target: "#open-stopwatch",
      title: "独立秒表与倒计时",
      description: "秒表适合开放式投入，倒计时适合有明确边界的任务。两者会在独立小窗口中打开，不打断主界面。",
      view: "gate",
    },
    {
      target: "#long-tasks-open",
      title: "管理长期任务",
      description: "长期任务使用重要/紧急四象限整理目标，并可把下一步拖入今日计划，适合承接跨天项目。勾选长期任务会完成它并同步到每日反思，误触后同样可在 10 秒内撤回。",
      view: "gate",
    },
    {
      target: "#long-tasks-open",
      title: "长期任务的操作方式",
      description: "长期任务左侧色块是拖拽控制区，可在象限之间移动或调整同象限顺序；点击任务卡片其他区域会进入详情编辑。右键菜单包含“复制到今日任务”和“删除”。详情页可以直接编辑任务名称和支持 Markdown 渲染的备注，系统会自动保存。",
      view: "gate",
    },
    {
      target: "#soul-open",
      title: "维护你的灵魂按摩间",
      description: "这里保存能让你恢复方向感的句子。入口页会随机展示你的收藏，也可以启用内置好句库。",
      view: "gate",
    },
    {
      target: "#focus-quote-screen",
      title: "进入前，先清理注意力残留",
      description: "点击好句卡片可随机刷新一句话。真正开始前，建议闭眼静心几分钟，让上一件事从工作记忆中退出。",
      view: "gate",
    },
    {
      target: "#enter-gate",
      title: "进入注意力空间",
      description: "准备好后点击这里进入工作区。教程下一步会先带你预览内部功能，预览结束后仍会回到这个入口。",
      view: "gate",
    },
    {
      target: ".mode-tabs",
      title: "三种状态，职责分明",
      description: "专注模式负责单任务投入，休息模式负责恢复，长期习惯构建用于时间审计与复盘。你可以随时切换。",
      view: "focus",
    },
    {
      target: "#focus-mode .section-header",
      title: "设定边界，再开始专注",
      description: "在专注模式中设置时长、区分核心或维持性工作，然后开始、暂停或重置本次专注。计时记录会进入复盘数据。",
      view: "focus",
    },
    {
      target: "#quick-distraction",
      title: "捕捉干扰，不跟着它走",
      description: "分心出现时点击“快速添加干扰”，或直接按 <kbd>Ctrl</kbd> + <kbd>D</kbd>。先记下来，再把注意力带回当前任务。",
      view: "focus",
    },
    {
      target: "#breathing-card",
      title: "休息不是继续接收信息",
      description: "休息模式包含计时、呼吸练习与本地音频提示。让身体动起来或跟随呼吸节奏，比继续刷信息更有助于恢复。",
      view: "rest",
    },
    {
      target: "#habit-mode",
      title: "用记录建立长期反馈",
      description: "在长期习惯构建中查看时间审计、专注记录与每日反思，观察核心工作占比，并据此调整下一天。",
      view: "habit",
    },
    {
      target: "#back-to-gate",
      title: "教程完成",
      description: "“返回”会带你回到注意力空间入口。以后只要尚未进入工作区，点击顶栏的“使用教程”就能重新查看本教程。",
      view: "focus",
    },
  ];

  const layer = document.createElement("div");
  layer.className = "tutorial-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="tutorial-scrim" data-side="top"></div>
    <div class="tutorial-scrim" data-side="left"></div>
    <div class="tutorial-scrim" data-side="right"></div>
    <div class="tutorial-scrim" data-side="bottom"></div>
    <div class="tutorial-target-blocker" aria-hidden="true"></div>
    <div class="tutorial-focus-ring" aria-hidden="true"></div>
    <section class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-description">
      <div class="tutorial-progress-track"><div class="tutorial-progress"></div></div>
      <div class="tutorial-card-body">
        <div class="tutorial-card-header">
          <div>
            <div class="tutorial-kicker">使用教程</div>
            <h2 id="tutorial-title" class="tutorial-title"></h2>
          </div>
          <button class="tutorial-close" type="button" aria-label="退出使用教程">×</button>
        </div>
        <p id="tutorial-description" class="tutorial-description"></p>
        <div class="tutorial-footer">
          <span class="tutorial-count"></span>
          <div class="tutorial-actions">
            <button class="tutorial-action tutorial-skip" type="button">跳过教程</button>
            <button class="tutorial-action tutorial-prev" type="button">上一步</button>
            <button class="tutorial-action primary tutorial-next" type="button">下一步</button>
          </div>
        </div>
      </div>
    </section>`;
  document.body.append(layer);

  const card = layer.querySelector(".tutorial-card");
  const ring = layer.querySelector(".tutorial-focus-ring");
  const blocker = layer.querySelector(".tutorial-target-blocker");
  const title = layer.querySelector(".tutorial-title");
  const description = layer.querySelector(".tutorial-description");
  const count = layer.querySelector(".tutorial-count");
  const progress = layer.querySelector(".tutorial-progress");
  const previousButton = layer.querySelector(".tutorial-prev");
  const nextButton = layer.querySelector(".tutorial-next");
  const closeButton = layer.querySelector(".tutorial-close");
  const skipButton = layer.querySelector(".tutorial-skip");
  const scrims = Object.fromEntries(
    Array.from(layer.querySelectorAll(".tutorial-scrim")).map((item) => [item.dataset.side, item]),
  );

  let active = false;
  let index = 0;
  let target = null;
  let previousFocus = null;
  let renderToken = 0;

  function applyView(view) {
    if (view === "gate") {
      setGateVisible(true);
      switchMode("focus");
      return;
    }
    setGateVisible(false);
    switchMode(view);
  }

  function setBox(element, { top, left, width, height }) {
    element.style.top = `${Math.max(0, top)}px`;
    element.style.left = `${Math.max(0, left)}px`;
    element.style.width = `${Math.max(0, width)}px`;
    element.style.height = `${Math.max(0, height)}px`;
  }

  function positionCard(rect) {
    const margin = 14;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    const cardWidth = cardRect.width;
    const cardHeight = cardRect.height;
    const availableRight = viewportWidth - rect.right;
    const availableLeft = rect.left;
    const availableBottom = viewportHeight - rect.bottom;
    let left;
    let top;

    if (availableRight >= cardWidth + margin * 2) {
      left = rect.right + margin;
      top = rect.top;
    } else if (availableLeft >= cardWidth + margin * 2) {
      left = rect.left - cardWidth - margin;
      top = rect.top;
    } else if (availableBottom >= cardHeight + margin * 2) {
      left = rect.left;
      top = rect.bottom + margin;
    } else {
      left = rect.left;
      top = rect.top - cardHeight - margin;
    }

    left = Math.min(Math.max(margin, left), viewportWidth - cardWidth - margin);
    top = Math.min(Math.max(margin, top), viewportHeight - cardHeight - margin);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function positionOverlay() {
    if (!active || !target) return;
    const gap = 7;
    const raw = target.getBoundingClientRect();
    const rect = {
      top: Math.max(6, raw.top - gap),
      left: Math.max(6, raw.left - gap),
      right: Math.min(window.innerWidth - 6, raw.right + gap),
      bottom: Math.min(window.innerHeight - 6, raw.bottom + gap),
    };
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;

    setBox(scrims.top, { top: 0, left: 0, width: window.innerWidth, height: rect.top });
    setBox(scrims.left, { top: rect.top, left: 0, width: rect.left, height: rect.height });
    setBox(scrims.right, { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.height });
    setBox(scrims.bottom, { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom });
    setBox(ring, rect);
    setBox(blocker, rect);
    positionCard(rect);
  }

  function renderStep() {
    const token = ++renderToken;
    const step = steps[index];
    applyView(step.view);
    target = document.querySelector(step.target);
    if (!target) {
      if (index < steps.length - 1) {
        index += 1;
        renderStep();
      } else {
        finish();
      }
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    title.textContent = step.title;
    description.innerHTML = step.description;
    count.textContent = `${index + 1} / ${steps.length}`;
    progress.style.width = `${((index + 1) / steps.length) * 100}%`;
    previousButton.disabled = index === 0;
    nextButton.textContent = index === steps.length - 1 ? "完成" : "下一步";
    skipButton.hidden = index === steps.length - 1;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!active || token !== renderToken) return;
        positionOverlay();
        nextButton.focus({ preventScroll: true });
      });
    });
  }

  function start() {
    if (active) return;
    active = true;
    index = 0;
    previousFocus = document.activeElement;
    document.body.classList.remove("is-minimized");
    layer.hidden = false;
    renderStep();
  }

  function finish() {
    if (!active) return;
    active = false;
    localStorage.setItem(SEEN_KEY, "true");
    layer.hidden = true;
    target = null;
    setGateVisible(true);
    switchMode("focus");
    document.querySelector("#main-area")?.scrollTo({ top: 0, behavior: "auto" });
    const focusTarget = previousFocus?.isConnected ? previousFocus : launchButton;
    focusTarget?.focus({ preventScroll: true });
  }

  function next() {
    if (index >= steps.length - 1) {
      finish();
      return;
    }
    index += 1;
    renderStep();
  }

  function previous() {
    if (index === 0) return;
    index -= 1;
    renderStep();
  }

  function onKeydown(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(card.querySelectorAll("button:not([disabled]):not([hidden])"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  launchButton.addEventListener("click", start);
  nextButton.addEventListener("click", next);
  previousButton.addEventListener("click", previous);
  closeButton.addEventListener("click", finish);
  skipButton.addEventListener("click", finish);
  window.addEventListener("resize", positionOverlay);
  window.addEventListener("scroll", positionOverlay, true);
  document.addEventListener("keydown", onKeydown, true);

  if (localStorage.getItem(SEEN_KEY) !== "true") {
    window.setTimeout(start, 550);
  }
})();
