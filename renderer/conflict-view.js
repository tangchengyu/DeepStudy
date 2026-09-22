(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DeepStudyConflictView = api;
})(typeof window !== "undefined" ? window : null, function () {
  function comparablePayload(record) {
    const payload = record?.payload && typeof record.payload === "object"
      ? { ...record.payload }
      : {};
    delete payload.updatedAt;
    return payload;
  }

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function sameUserContent(local, remote) {
    if (!local || !remote) return local === remote;
    return Boolean(local.deleted) === Boolean(remote.deleted)
      && (local.legacySourceId ?? null) === (remote.legacySourceId ?? null)
      && canonical(comparablePayload(local)) === canonical(comparablePayload(remote));
  }

  function flatten(value, prefix = "", output = new Map()) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value).sort();
      if (!keys.length && prefix) output.set(prefix, {});
      keys.forEach((key) => flatten(value[key], prefix ? `${prefix}.${key}` : key, output));
      return output;
    }
    output.set(prefix, value);
    return output;
  }

  function changedRows(local, remote) {
    const left = flatten(local);
    const right = flatten(remote);
    return [...new Set([...left.keys(), ...right.keys()])]
      .sort((a, b) => a.localeCompare(b))
      .filter((path) => canonical(left.get(path)) !== canonical(right.get(path)))
      .map((path) => ({ path, local: left.get(path), remote: right.get(path) }));
  }

  function compareRecords(local, remote) {
    const rows = changedRows(
      local ? {
        ...comparablePayload(local),
        deleted: Boolean(local.deleted),
        ...(local.legacySourceId == null ? {} : { legacySourceId: local.legacySourceId }),
      } : null,
      remote ? {
        ...comparablePayload(remote),
        deleted: Boolean(remote.deleted),
        ...(remote.legacySourceId == null ? {} : { legacySourceId: remote.legacySourceId }),
      } : null,
    );
    const metadataFields = [
      ["payload.updatedAt", local?.payload?.updatedAt, remote?.payload?.updatedAt],
      ["revision", local?.revision, remote?.revision],
      ["clientUpdatedAt", local?.clientUpdatedAt, remote?.clientUpdatedAt],
      ["serverUpdatedAt", local?.serverUpdatedAt, remote?.serverUpdatedAt],
      ["deviceId", local?.deviceId, remote?.deviceId],
    ];
    const metadataRows = metadataFields
      .filter(([, left, right]) => canonical(left) !== canonical(right))
      .map(([path, left, right]) => ({ path, local: left, remote: right }));
    return { contentEqual: sameUserContent(local, remote), rows, metadataRows };
  }

  return { compareRecords, sameUserContent };
});
