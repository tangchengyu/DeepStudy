(function (root) {
  const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  function createTurnstileScriptLoader({ document, getApi }) {
    let scriptPromise = null;
    return function loadTurnstileScript() {
      if (getApi()) return Promise.resolve();
      if (scriptPromise) return scriptPromise;
      let loadingScript = null;
      scriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-deepstudy-turnstile]");
        loadingScript = existing;
        const finish = () => getApi() ? resolve() : reject(new Error("人机验证加载失败"));
        const fail = () => reject(new Error("人机验证加载失败"));
        if (existing) {
          existing.addEventListener("load", finish, { once: true });
          existing.addEventListener("error", fail, { once: true });
          return;
        }
        const script = document.createElement("script");
        loadingScript = script;
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.dataset.deepstudyTurnstile = "true";
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", fail, { once: true });
        document.head.append(script);
      }).catch((error) => {
        if (loadingScript) loadingScript.remove();
        scriptPromise = null;
        throw error;
      });
      return scriptPromise;
    };
  }

  function createChallenge({ document, window, host, onToken, onError }) {
    const loadScript = createTurnstileScriptLoader({
      document,
      getApi: () => window.turnstile,
    });
    let widgetId = "";

    function clearWidget() {
      if (widgetId && window.turnstile?.remove) {
        try { window.turnstile.remove(widgetId); } catch {}
      }
      widgetId = "";
      host.replaceChildren();
      onToken("");
    }

    async function render({ siteKey, action }) {
      clearWidget();
      if (!siteKey) return;
      await loadScript();
      const api = window.turnstile;
      if (!api) throw new Error("人机验证暂不可用");
      widgetId = api.render(host, {
        sitekey: siteKey,
        action,
        theme: "light",
        size: "flexible",
        callback: (token) => onToken(String(token || "")),
        "expired-callback": () => onToken(""),
        "error-callback": () => {
          onToken("");
          onError("人机验证失败，请重试。");
        },
      });
    }

    return {
      render,
      reset: clearWidget,
    };
  }

  root.DeepStudyTurnstile = {
    TURNSTILE_SCRIPT_URL,
    createTurnstileScriptLoader,
    createChallenge,
  };
})(window);
