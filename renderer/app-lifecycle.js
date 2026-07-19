function createAppReadyRunner(app) {
  if (!app || typeof app.isReady !== "function" || typeof app.whenReady !== "function") {
    throw new TypeError("A valid Electron app instance is required.");
  }

  return function runWhenAppReady(callback) {
    const ready = app.isReady() ? Promise.resolve() : app.whenReady();
    return ready.then(callback);
  };
}

module.exports = { createAppReadyRunner };
