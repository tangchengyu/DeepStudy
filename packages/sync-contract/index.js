export const SUPPORTED_ENTITY_TYPES = Object.freeze([
  'daily_task',
  'long_task',
  'long_task_image_chunk',
  'focus_session',
  'mode_event',
  'time_audit',
  'distraction',
  'reflection',
  'soul_quote',
]);

const SUPPORTED_ENTITY_TYPE_SET = new Set(SUPPORTED_ENTITY_TYPES);
export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_JSON_DEPTH = 100;
export const MAX_ENTITY_ID_LENGTH = 200;
const MAX_CANONICAL_JSON_DEPTH = MAX_JSON_DEPTH + 16;

export class ContractValidationError extends TypeError {
  constructor(subject, errors) {
    super(`Invalid ${subject}: ${errors.map((error) => error.message).join(' ')}`);
    this.name = 'ContractValidationError';
    this.errors = errors;
  }
}

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function findJsonError(
  value,
  path = 'payload',
  ancestors = new Set(),
  depth = 0,
  maxDepth = MAX_CANONICAL_JSON_DEPTH,
) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : { path, code: 'not_json', message: `${path} must contain finite JSON numbers.` };
  }
  if (typeof value !== 'object') {
    return { path, code: 'not_json', message: `${path} must contain only JSON values.` };
  }
  if (depth >= maxDepth) {
    return {
      path,
      code: 'payload_too_deep',
      message: `${path} exceeds the maximum JSON nesting depth of ${maxDepth}.`,
    };
  }
  if (ancestors.has(value)) {
    return { path, code: 'not_json', message: `${path} must not contain a cycle.` };
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return { path, code: 'not_json', message: `${path} must contain only plain JSON objects.` };
  }

  ancestors.add(value);
  const entries = isArray ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
    const error = findJsonError(child, childPath, ancestors, depth + 1, maxDepth);
    if (error) {
      ancestors.delete(value);
      return error;
    }
  }
  ancestors.delete(value);
  return null;
}

function stringifyJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stringifyJson(item)).join(',')}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyJson(value[key])}`)
    .join(',')}}`;
}

export function stableStringify(value) {
  const error = findJsonError(value, '$');
  if (error) throw new ContractValidationError('JSON value', [error]);
  return stringifyJson(value);
}

export function measurePayloadBytes(payload) {
  return new TextEncoder().encode(stableStringify(payload)).byteLength;
}

export function validateRecord(record, { maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES } = {}) {
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 0) {
    throw new RangeError('maxPayloadBytes must be a non-negative safe integer.');
  }
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    errors.push({ path: '$', code: 'invalid_type', message: 'Record must be an object.' });
    return { valid: false, errors };
  }

  if (!SUPPORTED_ENTITY_TYPE_SET.has(record.entityType)) {
    errors.push({
      path: 'entityType',
      code: 'unsupported_entity_type',
      message: `Unsupported entity type: ${String(record.entityType)}.`,
    });
  }

  if (!isNonEmptyId(record.entityId)) {
    errors.push({ path: 'entityId', code: 'invalid_id', message: 'entityId must be a non-empty string.' });
  } else if (record.entityId.length > MAX_ENTITY_ID_LENGTH) {
    errors.push({
      path: 'entityId',
      code: 'id_too_long',
      message: `entityId must not exceed ${MAX_ENTITY_ID_LENGTH} characters.`,
    });
  }
  if (record.legacySourceId !== undefined && !isNonEmptyId(record.legacySourceId)) {
    errors.push({ path: 'legacySourceId', code: 'invalid_id', message: 'legacySourceId must be a non-empty string when present.' });
  } else if (record.legacySourceId?.length > MAX_ENTITY_ID_LENGTH) {
    errors.push({
      path: 'legacySourceId',
      code: 'id_too_long',
      message: `legacySourceId must not exceed ${MAX_ENTITY_ID_LENGTH} characters.`,
    });
  }

  const payloadError = findJsonError(record.payload, 'payload', new Set(), 0, MAX_JSON_DEPTH);
  if (payloadError) {
    errors.push(payloadError);
  } else {
    const payloadBytes = measurePayloadBytes(record.payload);
    if (payloadBytes > maxPayloadBytes) {
      errors.push({
        path: 'payload',
        code: 'payload_too_large',
        message: `payload is ${payloadBytes} bytes; the maximum is ${maxPayloadBytes} bytes.`,
      });
    }
  }

  if (typeof record.deleted !== 'boolean') {
    errors.push({ path: 'deleted', code: 'invalid_boolean', message: 'deleted must be a boolean.' });
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    errors.push({ path: 'revision', code: 'invalid_revision', message: 'revision must be a non-negative safe integer.' });
  }
  if (!isTimestamp(record.clientUpdatedAt)) {
    errors.push({ path: 'clientUpdatedAt', code: 'invalid_timestamp', message: 'clientUpdatedAt must be an ISO timestamp or non-negative epoch value.' });
  }
  if (!isTimestamp(record.serverUpdatedAt, { nullable: true })) {
    errors.push({ path: 'serverUpdatedAt', code: 'invalid_timestamp', message: 'serverUpdatedAt must be null, an ISO timestamp, or a non-negative epoch value.' });
  }
  if (!isNonEmptyId(record.deviceId)) {
    errors.push({ path: 'deviceId', code: 'invalid_id', message: 'deviceId must be a non-empty string.' });
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidRecord(record, options) {
  const result = validateRecord(record, options);
  if (!result.valid) throw new ContractValidationError('record', result.errors);
  return record;
}

export function validateMutation(mutation, options) {
  const errors = [];
  if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation)) {
    return {
      valid: false,
      errors: [{ path: '$', code: 'invalid_type', message: 'Mutation must be an object.' }],
    };
  }

  if (!isNonEmptyId(mutation.mutationId)) {
    errors.push({ path: 'mutationId', code: 'invalid_id', message: 'mutationId must be a non-empty string.' });
  }
  if (!Number.isSafeInteger(mutation.baseRevision) || mutation.baseRevision < 0) {
    errors.push({ path: 'baseRevision', code: 'invalid_revision', message: 'baseRevision must be a non-negative safe integer.' });
  }

  const recordResult = validateRecord(mutation.record, options);
  errors.push(...recordResult.errors.map((error) => ({
    ...error,
    path: error.path === '$' ? 'record' : `record.${error.path}`,
  })));

  return { valid: errors.length === 0, errors };
}

export function assertValidMutation(mutation, options) {
  const result = validateMutation(mutation, options);
  if (!result.valid) throw new ContractValidationError('mutation', result.errors);
  return mutation;
}

const SHA256_INITIAL_STATE = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

function sha256Hex(text) {
  const input = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const bitLength = BigInt(input.length) * 8n;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Number((bitLength >> 32n) & 0xffffffffn));
  view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn));

  const state = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + (index * 4));
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function snapshotHash(records, options) {
  if (!Array.isArray(records)) throw new TypeError('Snapshot records must be an array.');
  const sortedRecords = records.map((record) => {
    assertValidRecord(record, options);
    return record;
  }).sort((left, right) => compareStrings(stableStringify(left), stableStringify(right)));

  return sha256Hex(stableStringify({ version: 1, records: sortedRecords }));
}

function recordIdentity(record) {
  return stableStringify([record.entityType, record.entityId]);
}

function recordReference(record) {
  return { entityType: record.entityType, entityId: record.entityId };
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRecords(left, right) {
  return compareStrings(left.entityType, right.entityType)
    || compareStrings(left.entityId, right.entityId);
}

function cloneRecord(record) {
  return { ...record, payload: JSON.parse(stableStringify(record.payload)) };
}

function hasSameSemanticContent(left, right) {
  return stableStringify({ deleted: left.deleted, payload: left.payload })
    === stableStringify({ deleted: right.deleted, payload: right.payload });
}

export function createDeterministicForkId(record, occupiedEntityIds = [], options) {
  assertValidRecord(record, options);
  const occupied = occupiedEntityIds instanceof Set
    ? occupiedEntityIds
    : new Set(occupiedEntityIds);
  const digest = sha256Hex(stableStringify({
    entityType: record.entityType,
    entityId: record.entityId,
    deleted: record.deleted,
    payload: record.payload,
  }));

  for (let length = 16; length <= digest.length; length += 8) {
    const suffix = `~legacy~${digest.slice(0, length)}`;
    const candidate = `${record.entityId.slice(0, MAX_ENTITY_ID_LENGTH - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }

  let suffix = 1;
  while (true) {
    const digestSuffix = `~legacy~${digest}~${suffix}`;
    const candidate = `${record.entityId.slice(0, MAX_ENTITY_ID_LENGTH - digestSuffix.length)}${digestSuffix}`;
    if (!occupied.has(candidate)) return candidate;
    suffix += 1;
  }
}

function indexSnapshot(records, label, options) {
  if (!Array.isArray(records)) throw new TypeError(`${label} records must be an array.`);
  const indexed = new Map();
  for (const record of records) {
    assertValidRecord(record, options);
    const identity = recordIdentity(record);
    if (indexed.has(identity)) {
      throw new ContractValidationError(`${label} snapshot`, [{
        path: identity,
        code: 'duplicate_record_id',
        message: `${label} snapshot contains duplicate ${record.entityType}/${record.entityId}.`,
      }]);
    }
    indexed.set(identity, record);
  }
  return indexed;
}

export function previewFirstImport({ localRecords, cloudRecords }, options) {
  const localById = indexSnapshot(localRecords, 'local', options);
  const cloudById = indexSnapshot(cloudRecords, 'cloud', options);
  const cloudForksByLegacyIdentity = new Map();
  const additions = [];
  const duplicates = [];
  const conflicts = [];
  const mergedRecords = [];
  const occupiedIdsByType = new Map();

  for (const record of [...cloudRecords, ...localRecords]) {
    if (!occupiedIdsByType.has(record.entityType)) occupiedIdsByType.set(record.entityType, new Set());
    occupiedIdsByType.get(record.entityType).add(record.entityId);
  }

  for (const record of cloudRecords) {
    if (!record.legacySourceId) continue;
    const legacyIdentity = recordIdentity({
      entityType: record.entityType,
      entityId: record.legacySourceId,
    });
    const candidates = cloudForksByLegacyIdentity.get(legacyIdentity) ?? [];
    candidates.push(record);
    candidates.sort(compareRecords);
    cloudForksByLegacyIdentity.set(legacyIdentity, candidates);
  }

  for (const [identity, cloudRecord] of cloudById) {
    mergedRecords.push(cloneRecord(cloudRecord));
    const localRecord = localById.get(identity);
    if (localRecord && hasSameSemanticContent(localRecord, cloudRecord)) {
      duplicates.push(recordReference(cloudRecord));
    }
  }

  for (const [identity, localRecord] of localById) {
    const cloudRecord = cloudById.get(identity);
    if (!cloudRecord) {
      const matchingLegacyFork = (cloudForksByLegacyIdentity.get(identity) ?? [])
        .find((candidate) => hasSameSemanticContent(localRecord, candidate));
      if (matchingLegacyFork) {
        duplicates.push(recordReference(matchingLegacyFork));
      } else {
        mergedRecords.push(cloneRecord(localRecord));
        additions.push(recordReference(localRecord));
      }
    } else if (!hasSameSemanticContent(localRecord, cloudRecord)) {
      const matchingLegacyFork = (cloudForksByLegacyIdentity.get(identity) ?? [])
        .find((candidate) => hasSameSemanticContent(localRecord, candidate));
      if (matchingLegacyFork) {
        duplicates.push(recordReference(matchingLegacyFork));
      } else {
        const occupiedIds = occupiedIdsByType.get(localRecord.entityType);
        const forkEntityId = createDeterministicForkId(localRecord, occupiedIds, options);
        occupiedIds.add(forkEntityId);
        mergedRecords.push({
          ...cloneRecord(localRecord),
          entityId: forkEntityId,
          legacySourceId: localRecord.entityId,
        });
        conflicts.push({
          ...recordReference(localRecord),
          resolution: 'fork_local',
          forkEntityId,
        });
      }
    }
  }

  mergedRecords.sort(compareRecords);
  additions.sort(compareRecords);
  duplicates.sort(compareRecords);
  conflicts.sort(compareRecords);
  const tombstones = mergedRecords.filter((record) => record.deleted).map(recordReference);

  return {
    mergedRecords,
    additions,
    duplicates,
    conflicts,
    tombstones,
    counts: {
      local: localRecords.length,
      cloud: cloudRecords.length,
      merged: mergedRecords.length,
      additions: additions.length,
      duplicates: duplicates.length,
      conflicts: conflicts.length,
      tombstones: tombstones.length,
    },
  };
}

export function partitionMutationsByIdempotency(mutations, receivedMutationIds = [], options) {
  if (!Array.isArray(mutations)) throw new TypeError('Mutations must be an array.');
  if (typeof receivedMutationIds === 'string' || receivedMutationIds == null
    || typeof receivedMutationIds[Symbol.iterator] !== 'function') {
    throw new TypeError('receivedMutationIds must be an iterable of mutation IDs.');
  }

  const received = new Set();
  for (const mutationId of receivedMutationIds) {
    if (!isNonEmptyId(mutationId)) {
      throw new ContractValidationError('received mutation ID', [{
        path: 'receivedMutationIds',
        code: 'invalid_id',
        message: 'Every received mutation ID must be a non-empty string.',
      }]);
    }
    received.add(mutationId);
  }

  const accepted = [];
  const duplicates = [];
  for (const mutation of mutations) {
    assertValidMutation(mutation, options);
    if (received.has(mutation.mutationId)) {
      duplicates.push({ mutationId: mutation.mutationId, reason: 'already_received' });
      continue;
    }
    received.add(mutation.mutationId);
    accepted.push(mutation);
  }

  return {
    accepted,
    duplicates,
    receivedMutationIds: [...received].sort(),
  };
}
