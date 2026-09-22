(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DeepStudyConflictActions = api;
})(typeof window !== "undefined" ? window : null, function () {
  function resolutionInput(conflict, resolution) {
    const operationId = `desktop:resolve:${conflict.id}:${resolution}`;
    if (resolution === "keep_remote") return { resolution, operationId };
    return {
      resolution,
      mutationId: operationId,
      operationId,
      expectedRemoteRevision: Number(conflict.remote?.revision) || 0,
    };
  }

  async function resolveAllConflicts({ conflicts, resolution, resolve, onProgress = () => {} }) {
    const resolved = [];
    const failed = [];
    const total = conflicts.length;
    for (let index = 0; index < conflicts.length; index += 1) {
      const conflict = conflicts[index];
      try {
        await resolve(conflict, resolution);
        resolved.push(conflict);
      } catch (error) {
        failed.push({ conflict, error });
      }
      onProgress({ completed: index + 1, total, conflict });
    }
    return { resolved, failed };
  }

  return { resolutionInput, resolveAllConflicts };
});
