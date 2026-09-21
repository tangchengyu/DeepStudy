function withSyncError(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return {
        __deepStudySyncError: {
          message: String(error?.message || "同步操作失败，请稍后重试。"),
          code: String(error?.code || "SYNC_ERROR"),
          status: Number(error?.status) || 0,
          retryAfterSeconds: Math.max(0, Number(error?.retryAfterSeconds ?? error?.details?.retryAfterSeconds) || 0),
          details: error?.details ?? null,
        },
      };
    }
  };
}

module.exports = { withSyncError };
