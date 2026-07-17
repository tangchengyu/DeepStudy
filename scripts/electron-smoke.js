const port = process.argv[2] || "9333";

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP returned ${response.status}`);
  return response.json();
}

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("CDP evaluation timed out")); }, 30000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout); socket.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      }
      else resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")));
  });
}

async function waitFor(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let value;
    try {
      value = await predicate();
    } catch (_) {
      value = null;
    }
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for Electron window");
}

(async () => {
  const main = await waitFor(async () => (await targets()).find((target) => target.url.endsWith("renderer/index.html")));
  await waitFor(async () => evaluate(main, `document.readyState !== 'loading' && Boolean(document.querySelector('#long-tasks-open')) && Boolean(document.querySelector('#planner-settings-open'))`));
  const tutorialFlow = await evaluate(main, `(async () => {
    const key = 'deepstudy.tutorial.seen.v1';
    const originalSeen = localStorage.getItem(key);
    document.querySelector('.tutorial-close')?.click();
    document.querySelector('#tutorial-open').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const layer = document.querySelector('.tutorial-layer');
    const initial = {
      visible: !layer.hidden,
      title: document.querySelector('.tutorial-title')?.textContent.trim(),
      highlighted: document.querySelector('.tutorial-focus-ring')?.getBoundingClientRect().width > 0
    };
    for (let i = 0; i < 11; i += 1) {
      document.querySelector('.tutorial-next').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const shortcutStep = {
      title: document.querySelector('.tutorial-title')?.textContent.trim(),
      mentionsShortcut: document.querySelector('.tutorial-description')?.textContent.includes('Ctrl') && document.querySelector('.tutorial-description')?.textContent.includes('D'),
      focusPreview: document.querySelector('#gate-view').hidden && !document.querySelector('#mode-shell').hidden
    };
    document.querySelector('.tutorial-close').click();
    const restored = {
      gate: !document.querySelector('#gate-view').hidden,
      tutorialButton: !document.querySelector('#tutorial-open').hidden,
      seen: localStorage.getItem(key) === 'true'
    };
    if (originalSeen === null) localStorage.removeItem(key);
    else localStorage.setItem(key, originalSeen);
    return { initial, shortcutStep, restored };
  })()`);
  if (!tutorialFlow.initial.visible || tutorialFlow.initial.title !== "欢迎来到 DeepStudy" || !tutorialFlow.initial.highlighted) throw new Error("Product tutorial did not open with a highlighted target");
  if (tutorialFlow.shortcutStep.title !== "捕捉干扰，不跟着它走" || !tutorialFlow.shortcutStep.mentionsShortcut || !tutorialFlow.shortcutStep.focusPreview) throw new Error("Product tutorial did not explain the Ctrl+D distraction shortcut");
  if (!tutorialFlow.restored.gate || !tutorialFlow.restored.tutorialButton || !tutorialFlow.restored.seen) throw new Error("Product tutorial did not exit cleanly");
  const mainState = await evaluate(main, `(() => {
    let reflections = [];
    try {
      reflections = JSON.parse(localStorage.getItem('mytimer.dailyReflection.v1') || '[]');
    } catch (_) {
      reflections = [];
    }
    const completedByDate = reflections.filter(item => String(item.kind || '').startsWith('completed-task')).reduce((counts, item) => ({ ...counts, [item.date]: (counts[item.date] || 0) + 1 }), {});
    return {
      button: Boolean(document.querySelector('#long-tasks-open')),
      settings: Boolean(document.querySelector('#planner-settings-open')),
      noiseMenu: Boolean(document.querySelector('#noise-menu-button')),
      addPlaceholder: document.querySelector('#plan-input')?.getAttribute('placeholder'),
      plusRemoved: !document.querySelector('#plan-add-button'),
      title: document.title,
      gateImage: (() => {
        const image = document.querySelector('.attention-arena img');
        return {
          exists: Boolean(image),
          src: image?.getAttribute('src'),
          loaded: Boolean(image?.complete && image.naturalWidth > 0)
        };
      })(),
      maxCompletedEntriesPerDate: Math.max(0, ...Object.values(completedByDate))
    };
  })()`);
  if (!mainState.button || !mainState.settings || !mainState.noiseMenu) throw new Error("Main window controls are missing");
  if (mainState.addPlaceholder !== "添加今日任务，回车添加" || !mainState.plusRemoved) throw new Error("Daily quick-add UI was not updated");
  if (!mainState.gateImage?.exists || mainState.gateImage.src !== "assets/focus-gate.png" || !mainState.gateImage.loaded) throw new Error("Focus gate image is missing or failed to load");
  if (mainState.maxCompletedEntriesPerDate > 1) throw new Error("Completed tasks were not grouped by date");
  const quickAdd = await evaluate(main, `(() => {
    const text = 'Smoke quick add ' + Date.now();
    document.querySelector('#plan-input').value = text;
    document.querySelector('#plan-add-form').requestSubmit();
    const item = [...document.querySelectorAll('#plan-list .plan-item')].find(node => node.textContent.includes(text));
    const created = Boolean(item);
    item?.querySelector('.task-remove')?.click();
    return created;
  })()`);
  if (!quickAdd) throw new Error("Daily quick-add form did not create a task");
  const resetDialog = await evaluate(main, `(async () => {
    document.querySelector('#plan-input').value = 'Smoke reset ' + Date.now();
    document.querySelector('#plan-add-form').requestSubmit();
    const smokeItem = [...document.querySelectorAll('#plan-list .plan-item')].find(node => node.textContent.includes('Smoke reset'));
    document.querySelector('#reset-plan').click();
    const opened = !document.querySelector('#reset-confirm-modal').hidden;
    document.querySelector('#reset-confirm-cancel').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    smokeItem?.querySelector('.task-remove')?.click();
    return {
      opened,
      focusTarget: document.activeElement?.id,
      stillUsable: !document.querySelector('#plan-input').disabled && !document.querySelector('#planner-input').disabled
    };
  })()`);
  if (!resetDialog.opened || !resetDialog.stillUsable) throw new Error("Reset confirmation dialog did not keep text inputs usable");
  const noiseState = await evaluate(main, `(() => {
    document.querySelector('#noise-menu-button').click();
    const labels = [...document.querySelectorAll('.noise-track-play')].map(node => node.textContent.trim());
    document.querySelector('#noise-custom-toggle').click();
    return {
      open: !document.querySelector('#noise-popover').hidden,
      labels,
      customPanel: !document.querySelector('#noise-custom-panel').hidden
    };
  })()`);
  if (!noiseState.open || !noiseState.customPanel || !["木鱼白噪音", "雨声白噪音"].every(label => noiseState.labels.includes(label))) throw new Error("White-noise menu is incomplete");
  const volumeToggle = await evaluate(main, `(() => {
    const input = document.querySelector('#noise-volume');
    const popover = document.querySelector('#noise-popover');
    const button = document.querySelector('#noise-mute-button');
    input.value = '72';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    popover.hidden = true;
    button.click();
    const muted = {
      input: input.value,
      value: document.querySelector('#volume-value').textContent,
      icon: button.textContent.trim(),
      open: !popover.hidden,
      label: button.getAttribute('aria-label')
    };
    button.click();
    return {
      muted,
      restored: {
        input: input.value,
        value: document.querySelector('#volume-value').textContent,
        icon: button.textContent.trim(),
        open: !popover.hidden,
        label: button.getAttribute('aria-label')
      }
    };
  })()`);
  if (volumeToggle.muted.input !== "0" || volumeToggle.muted.value !== "0%" || volumeToggle.muted.icon !== "🔇" || volumeToggle.muted.open || volumeToggle.muted.label !== "恢复白噪音音量") throw new Error("White-noise mute button did not mute cleanly");
  if (volumeToggle.restored.input !== "72" || volumeToggle.restored.value !== "72%" || volumeToggle.restored.icon !== "🔊" || volumeToggle.restored.open || volumeToggle.restored.label !== "静音白噪音") throw new Error("White-noise mute button did not restore the previous volume");
  const focusDurationFlow = await evaluate(main, `(async () => {
    if (!document.querySelector('#gate-view').hidden) document.querySelector('#enter-gate').click();
    document.querySelector('[data-mode="focus"]').click();
    document.querySelector('#focus-start').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const modal = document.querySelector('#focus-duration-modal');
    const opened = !modal.hidden;
    const oldDurationButtons = document.querySelectorAll('.duration-btn').length;
    const presetButtons = [...document.querySelectorAll('.focus-duration-preset')].map(button => button.textContent.trim());
    document.querySelector('.focus-duration-preset[data-minutes="45"]').click();
    const input = document.querySelector('#focus-duration-input');
    const presetUpdatedInput = input.value;
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#focus-duration-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 80));
    const started = document.querySelector('#focus-start').textContent.trim();
    const timerText = document.querySelector('#focus-timer').textContent.trim();
    document.querySelector('#focus-reset').click();
    return { opened, oldDurationButtons, presetButtons, presetUpdatedInput, modalClosed: modal.hidden, started, timerText };
  })()`);
  if (!focusDurationFlow.opened || focusDurationFlow.oldDurationButtons !== 0 || !["25 分钟", "45 分钟"].every(label => focusDurationFlow.presetButtons.includes(label)) || focusDurationFlow.presetUpdatedInput !== "45" || !focusDurationFlow.modalClosed || focusDurationFlow.started !== "专注中" || !/^(?:01:00|00:5\\d)$/.test(focusDurationFlow.timerText)) throw new Error("Focus duration modal flow is incorrect");
  const noiseStorage = await evaluate(main, `(async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
    const created = await window.electronAPI.addCustomNoise({ name: 'smoke-noise.wav', type: 'audio/wav', buffer: bytes.buffer });
    const listed = await window.electronAPI.listCustomNoise();
    const loaded = await window.electronAPI.readCustomNoise(created.id);
    await window.electronAPI.deleteCustomNoise(created.id);
    const afterDelete = await window.electronAPI.listCustomNoise();
    return {
      created: Boolean(created.id),
      listed: listed.some(item => item.id === created.id),
      loadedBytes: loaded.buffer?.byteLength || loaded.buffer?.length || 0,
      deleted: !afterDelete.some(item => item.id === created.id)
    };
  })()`);
  if (!noiseStorage.created || !noiseStorage.listed || noiseStorage.loadedBytes < 12 || !noiseStorage.deleted) throw new Error("Custom white-noise storage failed");
  const mainAlwaysOnTopBeforeTimer = await evaluate(main, `window.electronAPI.getAlwaysOnTop()`);
  await evaluate(main, `document.querySelector('#open-stopwatch').click()`);
  const stopwatchWindow = await waitFor(async () => (await targets()).find((target) => target.url.includes("renderer/timer.html") && target.url.includes("mode=stopwatch")));
  const stopwatchState = await waitFor(async () => evaluate(stopwatchWindow, `(() => {
    const panel = document.querySelector('#stopwatch-panel');
    const state = {
      ready: document.readyState === 'complete' || document.readyState === 'interactive',
      title: document.title,
      panelVisible: panel && !panel.hidden,
      time: document.querySelector('#sw-time')?.textContent,
      alwaysOnTop: window.electronAPI ? null : false
    };
    return state.ready && state.title === '秒表' && state.panelVisible && state.time === '00:00:00.00' ? state : false;
  })()`));
  if (!stopwatchState.ready || stopwatchState.title !== "秒表" || !stopwatchState.panelVisible || stopwatchState.time !== "00:00:00.00") throw new Error("Stopwatch window did not load correctly");
  const stopwatchAlwaysOnTop = await evaluate(stopwatchWindow, `(async () => {
    const afterToggle = await window.electronAPI.toggleAlwaysOnTop();
    const current = await window.electronAPI.getAlwaysOnTop();
    return { afterToggle, current };
  })()`);
  const mainAlwaysOnTopAfterTimer = await evaluate(main, `window.electronAPI.getAlwaysOnTop()`);
  if (!stopwatchAlwaysOnTop.afterToggle || !stopwatchAlwaysOnTop.current) throw new Error("Stopwatch always-on-top did not apply to the timer window");
  if (mainAlwaysOnTopAfterTimer !== mainAlwaysOnTopBeforeTimer) throw new Error("Timer always-on-top changed the main window state");
  await evaluate(stopwatchWindow, `window.close()`);
  await evaluate(main, `document.querySelector('#open-countdown').click()`);
  const countdownWindow = await waitFor(async () => (await targets()).find((target) => target.url.includes("renderer/timer.html") && target.url.includes("mode=countdown")));
  const countdownState = await waitFor(async () => evaluate(countdownWindow, `(() => {
    const panel = document.querySelector('#countdown-panel');
    const state = {
      ready: document.readyState === 'complete' || document.readyState === 'interactive',
      title: document.title,
      panelVisible: panel && !panel.hidden,
      time: document.querySelector('#cd-time')?.textContent
    };
    return state.ready && state.title === '倒计时' && state.panelVisible && state.time === '00:01:00' ? state : false;
  })()`));
  if (!countdownState.ready || countdownState.title !== "倒计时" || !countdownState.panelVisible || countdownState.time !== "00:01:00") throw new Error("Countdown window did not load correctly");
  await evaluate(countdownWindow, `window.close()`);
  await evaluate(main, `document.querySelector('#long-tasks-open').click()`);
  const longWindow = await waitFor(async () => (await targets()).find((target) => target.url.endsWith("renderer/long-tasks.html")));
  await waitFor(async () => (await evaluate(longWindow, `document.querySelectorAll('.quadrant').length`)) === 4);
  const result = await evaluate(longWindow, `(async () => {
    if (document.querySelectorAll('.quadrant').length !== 4) throw new Error('quadrants missing');
    if (document.querySelector('.completed-section')) throw new Error('completed section should be removed');
    if (!document.querySelector('#long-ai-new') || !document.querySelector('#long-ai-settings')) throw new Error('long task AI controls missing');
    document.querySelector('#long-add').click();
    const modal = document.querySelector('#long-task-modal');
    if (modal.hidden || getComputedStyle(document.querySelector('.long-task-form')).textAlign !== 'left') throw new Error('task form styling missing');
    document.querySelector('#long-task-cancel').click();
    const quadrantStyle = getComputedStyle(document.querySelector('.quadrant'));
    const listStyle = getComputedStyle(document.querySelector('.quadrant-list'));
    if (quadrantStyle.overflow !== 'hidden' || listStyle.overflowY !== 'auto') throw new Error('quadrant scrolling layout missing');
    const saved = await window.electronAPI.saveLongTask({ title: 'Smoke task', quadrant: 'important-not-urgent', reminder: { kind: 'none' } });
    const moved = await window.electronAPI.saveLongTask({ title: 'Smoke moved long task ' + Date.now(), quadrant: 'important-not-urgent', reminder: { kind: 'none' } });
    const listed = await window.electronAPI.listLongTasks();
    await new Promise(resolve => setTimeout(resolve, 100));
    const savedCard = [...document.querySelectorAll('.long-task-card')].find(card => card.dataset.id === saved.id);
    const visibleActions = [...savedCard.querySelectorAll('[data-action]')].map(button => button.dataset.action);
    if (visibleActions.length) throw new Error('long task card should not show inline action buttons');
    if (!savedCard.querySelector('.long-task-check input')) throw new Error('long task completion checkbox is missing');
    savedCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 24 }));
    const menuActions = [...document.querySelectorAll('.long-task-menu [data-action]')].map(button => button.dataset.action);
    if (!['edit', 'copy-today', 'delete'].every(action => menuActions.includes(action))) throw new Error('long task context menu is incomplete');
    if (getComputedStyle(savedCard).display !== 'grid') throw new Error('long task card layout should use aligned grid');
    const config = await window.electronAPI.getLongTaskAiConfig();
    await window.electronAPI.addTaskToDailyPlan({ title: moved.title });
    await new Promise(resolve => setTimeout(resolve, 150));
    const moveResult = await window.electronAPI.moveLongTaskToDailyPlan({ id: moved.id });
    await new Promise(resolve => setTimeout(resolve, 150));
    const afterMove = await window.electronAPI.listLongTasks();
    const movedTask = afterMove.find(task => task.id === moved.id);
    const movedCardStillVisible = Boolean(document.querySelector(\`.long-task-card[data-id="\${moved.id}"]\`));
    const completion = await window.electronAPI.completeLongTask(saved.id);
    await new Promise(resolve => setTimeout(resolve, 150));
    await window.electronAPI.deleteLongTask(saved.id);
    return { quadrants: 4, persisted: listed.some(task => task.id === saved.id), aiMode: config.mode, menuActions, completion: completion.completed, moved: moveResult.moved, movedStatus: movedTask?.status, movedCardStillVisible, movedId: moved.id, movedTitle: moved.title };
  })()`);
  if (!result.persisted) throw new Error("Long task persistence failed");
  if (!result.completion) throw new Error("Long task completion failed");
  if (!result.moved || result.movedStatus !== "planned" || result.movedCardStillVisible) throw new Error("Moved long task did not leave the active quadrant without completion");
  const movedTitleLiteral = JSON.stringify(result.movedTitle || "");
  const movedReflectionFlow = await evaluate(main, `(async () => {
    const title = ${movedTitleLiteral};
    await new Promise(resolve => setTimeout(resolve, 150));
    const key = 'mytimer.dailyReflection.v1';
    const readReflections = () => JSON.parse(localStorage.getItem(key) || '[]');
    const beforeReflection = readReflections().some(item => String(item.content || '').includes(title));
    const item = [...document.querySelectorAll('#plan-list .plan-item')].find(node => node.textContent.includes(title));
    if (!item) return { foundInPlan: false, beforeReflection };
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 150));
    const afterReflection = readReflections().some(item => String(item.content || '').includes(title));
    item.querySelector('.task-remove')?.click();
    const cleaned = readReflections().map(item => {
      if (!String(item.content || '').includes(title)) return item;
      return { ...item, content: String(item.content || '').split('\\n').filter(line => !line.includes(title)).join('\\n').trim() };
    }).filter(item => item.content);
    localStorage.setItem(key, JSON.stringify(cleaned));
    return { foundInPlan: true, beforeReflection, afterReflection };
  })()`);
  await evaluate(longWindow, `window.electronAPI.deleteLongTask(${JSON.stringify(result.movedId)})`);
  if (!movedReflectionFlow.foundInPlan || movedReflectionFlow.beforeReflection || !movedReflectionFlow.afterReflection) throw new Error("Moved long task reflection flow is incorrect");
  const longReflection = await evaluate(main, `(() => {
    const key = 'mytimer.dailyReflection.v1';
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    const found = items.some(item => String(item.content || '').includes('Smoke task'));
    const cleaned = items.map(item => {
      if (!String(item.content || '').includes('Smoke task')) return item;
      return { ...item, content: String(item.content || '').split('\\n').filter(line => !line.includes('Smoke task')).join('\\n').trim() };
    }).filter(item => item.content);
    localStorage.setItem(key, JSON.stringify(cleaned));
    return found;
  })()`);
  if (!longReflection) throw new Error("Completed long task was not recorded in daily reflection");
  const restMessageLayout = await evaluate(main, `(() => {
    if (!document.querySelector('#gate-view').hidden) document.querySelector('#enter-gate').click();
    document.querySelector('[data-mode="rest"]').click();
    const message = document.querySelector('.rest-message');
    const spans = [...message.querySelectorAll(':scope > span')];
    const termTips = [...document.querySelectorAll('.term-tip[title], .mode-tab[title], .breathing-btn[title]')].map(node => node.getAttribute('title'));
    const restCustom = document.querySelector('.rest-custom-time');
    const restInputs = [...restCustom.querySelectorAll('label input')].map(input => input.id);
    const restCustomStyle = getComputedStyle(restCustom);
    const distractionColor = getComputedStyle(document.querySelector('.legend-dot.audit-segment.distraction')).backgroundColor;
    return {
      spanCount: spans.length,
      textAlign: getComputedStyle(message).textAlign,
      display: getComputedStyle(message).display,
      first: spans[0]?.textContent.trim(),
      second: spans[1]?.textContent.trim(),
      stacked: spans.length === 2 && spans[1].getBoundingClientRect().top > spans[0].getBoundingClientRect().top,
      termTips,
      restCustomDisplay: restCustomStyle.display,
      restInputIds: restInputs,
      distractionColor
    };
  })()`);
  if (restMessageLayout.spanCount !== 2 || restMessageLayout.textAlign !== "center" || restMessageLayout.display !== "grid" || !restMessageLayout.stacked) throw new Error("Rest message is not rendered as two centered lines");
  if (!["4-4-4-4 腹式呼吸法", "冰人呼吸法", "专注模式", "分散模式"].every(keyword => restMessageLayout.termTips.some(title => title?.includes(keyword)))) throw new Error("Mode and breathing glossary tooltips are missing");
  if (restMessageLayout.restCustomDisplay !== "grid" || !["rest-h", "rest-m", "rest-s"].every(id => restMessageLayout.restInputIds.includes(id))) throw new Error("Custom rest duration control is not grouped correctly");
  if (!/232,\s*136,\s*138/.test(restMessageLayout.distractionColor)) throw new Error("Time audit distraction color is not red");
  const gateChrome = await evaluate(main, `(() => {
    document.querySelector('#back-to-gate').click();
    const soulBefore = !document.querySelector('#soul-open').hidden;
    document.querySelector('#enter-gate').click();
    return {
      soulBefore,
      soulAfter: !document.querySelector('#soul-open').hidden
    };
  })()`);
  if (!gateChrome.soulBefore || gateChrome.soulAfter) throw new Error("Soul massage button visibility does not match the gate state");
  const stickyHeaderLayout = await evaluate(main, `(() => {
    const mainArea = document.querySelector('#main-area');
    mainArea.scrollTop = 120;
    const header = document.querySelector('.mode-sticky-header');
    const back = document.querySelector('#back-to-gate');
    const mainRect = mainArea.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const backRect = back.getBoundingClientRect();
    return {
      topGap: Math.abs(headerRect.top - mainRect.top),
      backWidth: backRect.width,
      headerWidth: headerRect.width,
      backLeftAligned: Math.abs(backRect.left - headerRect.left) < 16
    };
  })()`);
  if (stickyHeaderLayout.topGap > 12 || stickyHeaderLayout.backWidth > 140 || stickyHeaderLayout.backWidth > stickyHeaderLayout.headerWidth * 0.35 || !stickyHeaderLayout.backLeftAligned) throw new Error("Sticky mode header is misaligned or the back button is stretched");
  const gateLayout = await evaluate(main, `(async () => {
    const gateView = document.querySelector('#gate-view');
    const shell = document.querySelector('#mode-shell');
    shell.hidden = true;
    gateView.hidden = false;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const screen = document.querySelector('#focus-quote-screen');
    const text = document.querySelector('#focus-quote-text');
    const screenRect = screen.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    return {
      textAlign: getComputedStyle(text).textAlign,
      insideWidth: textRect.left >= screenRect.left && textRect.right <= screenRect.right,
      insideHeight: textRect.top >= screenRect.top && textRect.bottom <= screenRect.bottom,
      width: textRect.width,
      screenWidth: screenRect.width
    };
  })()`);
  if (gateLayout.textAlign !== "center" || !gateLayout.insideWidth || !gateLayout.insideHeight || gateLayout.width < gateLayout.screenWidth * 0.55) throw new Error("Focus gate quote layout can still collapse or overflow after returning");
  const apiSettings = await evaluate(main, `(() => {
    document.querySelector('#planner-settings-open').click();
    return {
      tutorial: Boolean(document.querySelector('#free-api-tutorial')),
      apiOnly: Boolean(document.querySelector('#api-settings')) && !document.querySelector('.provider-switch'),
      contextMenu: Boolean(document.querySelector('.task-context-menu')),
      dropTarget: Boolean(document.querySelector('.plan-list-wrap'))
    };
  })()`);
  if (!apiSettings.tutorial || !apiSettings.apiOnly || !apiSettings.contextMenu || !apiSettings.dropTarget) throw new Error("API settings or daily plan interactions are incomplete");
  process.stdout.write(JSON.stringify({ main: mainState, longTasks: result, apiSettings }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
