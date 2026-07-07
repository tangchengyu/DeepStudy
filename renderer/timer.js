const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function formatClock(ms, precise = false) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const base = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  if (!precise) return base;
  return `${base}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
}

function alarm() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 1.15);
  } catch (_) {
    // Audio permissions can vary; the countdown UI still completes normally.
  }
}

function setupAlwaysOnTop() {
  const checkbox = $("#always-on-top");
  if (!window.electronAPI || !checkbox) return;
  checkbox.addEventListener("change", async () => {
    checkbox.checked = await window.electronAPI.toggleAlwaysOnTop();
  });
  window.electronAPI.getAlwaysOnTop().then((value) => {
    checkbox.checked = value;
  });
}

function setupStopwatch() {
  let running = false;
  let startAt = 0;
  let elapsed = 0;
  let raf = 0;
  let lastLap = 0;
  let lapNo = 0;
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
  let total = 60000;
  let remaining = total;
  let running = false;
  let target = 0;
  let timer = null;
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
  $$(".preset-row button").forEach((button) =>
    button.addEventListener("click", () => set(Number(button.dataset.seconds) * 1000)),
  );
  $$("#cd-h,#cd-m,#cd-s").forEach((input) =>
    input.addEventListener("input", () => set(read())),
  );
  render();
}

const mode = new URLSearchParams(location.search).get("mode");
const safeMode = mode === "countdown" ? "countdown" : "stopwatch";
const copy = {
  stopwatch: { title: "秒表", eyebrow: "STOPWATCH" },
  countdown: { title: "倒计时", eyebrow: "COUNTDOWN" },
}[safeMode];

document.title = copy.title;
$("#timer-title").textContent = copy.title;
$("#timer-eyebrow").textContent = copy.eyebrow;
$("#stopwatch-panel").hidden = safeMode !== "stopwatch";
$("#countdown-panel").hidden = safeMode !== "countdown";
setupAlwaysOnTop();
setupStopwatch();
setupCountdown();
