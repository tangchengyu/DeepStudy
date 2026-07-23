import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ContractValidationError,
  DEFAULT_MAX_PAYLOAD_BYTES,
  MAX_ENTITY_ID_LENGTH,
  MAX_JSON_DEPTH,
  assertValidMutation,
  assertValidRecord,
  createDeterministicForkId,
  measurePayloadBytes,
  partitionMutationsByIdempotency,
  previewFirstImport,
  snapshotHash,
  SUPPORTED_ENTITY_TYPES,
  validateMutation,
  validateRecord,
} from '../index.js';

const makeRecord = (overrides = {}) => ({
  entityType: 'long_task',
  entityId: 'task-1',
  payload: { title: 'Read', notes: 'line one\nline two' },
  deleted: false,
  revision: 0,
  clientUpdatedAt: '2026-07-22T12:00:00.000Z',
  serverUpdatedAt: null,
  deviceId: 'device-a',
  ...overrides,
});

test('record validation accepts every supported entity type', () => {
  assert.deepEqual([...SUPPORTED_ENTITY_TYPES], [
    'daily_task',
    'long_task',
    'focus_session',
    'mode_event',
    'time_audit',
    'distraction',
    'reflection',
  ]);

  for (const entityType of SUPPORTED_ENTITY_TYPES) {
    assert.deepEqual(validateRecord(makeRecord({ entityType })), {
      valid: true,
      errors: [],
    });
  }
});

test('record validation reports malformed envelope fields without throwing', () => {
  const result = validateRecord(makeRecord({
    entityType: 'unknown',
    entityId: '',
    payload: { invalid: undefined },
    deleted: 'no',
    revision: -1,
    clientUpdatedAt: 'yesterday',
    serverUpdatedAt: {},
    deviceId: '',
  }));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ path, code }) => [path, code]), [
    ['entityType', 'unsupported_entity_type'],
    ['entityId', 'invalid_id'],
    ['payload.invalid', 'not_json'],
    ['deleted', 'invalid_boolean'],
    ['revision', 'invalid_revision'],
    ['clientUpdatedAt', 'invalid_timestamp'],
    ['serverUpdatedAt', 'invalid_timestamp'],
    ['deviceId', 'invalid_id'],
  ]);
  assert.throws(
    () => assertValidRecord(makeRecord({ entityId: '' })),
    (error) => error instanceof ContractValidationError
      && error.errors[0].path === 'entityId',
  );
  assert.equal(validateRecord(makeRecord({ clientUpdatedAt: '2026-07-22' })).valid, false);
});

test('payload size validation measures UTF-8 bytes and enforces the exact boundary', () => {
  const record = makeRecord({ payload: { note: '你' } });
  const size = measurePayloadBytes(record.payload);

  assert.equal(size, new TextEncoder().encode('{"note":"你"}').byteLength);
  assert.equal(validateRecord(record, { maxPayloadBytes: size }).valid, true);

  const result = validateRecord(record, { maxPayloadBytes: size - 1 });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ path, code }) => [path, code]), [
    ['payload', 'payload_too_large'],
  ]);
  assert.equal(DEFAULT_MAX_PAYLOAD_BYTES, 256 * 1024);
});

test('entity IDs use one shared limit and deterministic forks stay within it', () => {
  const maximumId = 'x'.repeat(MAX_ENTITY_ID_LENGTH);
  assert.equal(validateRecord(makeRecord({ entityId: maximumId })).valid, true);
  assert.deepEqual(
    validateRecord(makeRecord({ entityId: `${maximumId}x` })).errors.map(({ path, code }) => [path, code]),
    [['entityId', 'id_too_long']],
  );

  const forkId = createDeterministicForkId(makeRecord({ entityId: maximumId }));
  assert.match(forkId, /~legacy~[0-9a-f]{16}$/);
  assert.equal(forkId.length, MAX_ENTITY_ID_LENGTH);
});

test('payload validation rejects cycles and non-finite numbers as non-JSON data', () => {
  const cyclic = {};
  cyclic.self = cyclic;

  assert.deepEqual(
    validateRecord(makeRecord({ payload: cyclic })).errors.map(({ path, code }) => [path, code]),
    [['payload.self', 'not_json']],
  );
  assert.deepEqual(
    validateRecord(makeRecord({ payload: { duration: Number.POSITIVE_INFINITY } }))
      .errors.map(({ path, code }) => [path, code]),
    [['payload.duration', 'not_json']],
  );
});

test('payload validation rejects excessive nesting without overflowing the runtime stack', () => {
  const nested = (depth) => {
    let value = null;
    for (let index = 0; index < depth; index += 1) value = [value];
    return value;
  };

  assert.equal(validateRecord(makeRecord({ payload: nested(MAX_JSON_DEPTH) })).valid, true);
  const result = validateRecord(makeRecord({ payload: nested(MAX_JSON_DEPTH + 1) }));
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'payload_too_deep');
  assert.doesNotThrow(() => validateRecord(makeRecord({ payload: nested(5_000) })));
});

test('maximum-depth payloads remain usable across hashing, forking, and import preview', () => {
  const nested = (depth, leaf = null) => {
    let value = leaf;
    for (let index = 0; index < depth; index += 1) value = [value];
    return value;
  };
  const local = makeRecord({ payload: nested(MAX_JSON_DEPTH) });
  const duplicate = makeRecord({
    ...local,
    revision: 7,
    serverUpdatedAt: '2026-07-22T13:00:00.000Z',
    deviceId: 'cloud-device',
  });
  const divergent = makeRecord({
    ...duplicate,
    payload: nested(MAX_JSON_DEPTH, 'cloud'),
  });

  assert.doesNotThrow(() => snapshotHash([local]));
  assert.doesNotThrow(() => createDeterministicForkId(local));
  assert.equal(previewFirstImport({ localRecords: [local], cloudRecords: [duplicate] }).counts.duplicates, 1);
  assert.equal(previewFirstImport({ localRecords: [local], cloudRecords: [divergent] }).counts.conflicts, 1);
});

test('mutation validation composes mutation and record envelope rules', () => {
  const mutation = {
    mutationId: 'mutation-1',
    baseRevision: 3,
    record: makeRecord({ revision: 4 }),
  };

  assert.deepEqual(validateMutation(mutation), { valid: true, errors: [] });
  assert.equal(assertValidMutation(mutation), mutation);

  const result = validateMutation({
    mutationId: '',
    baseRevision: -1,
    record: makeRecord({ entityType: 'other' }),
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ path, code }) => [path, code]), [
    ['mutationId', 'invalid_id'],
    ['baseRevision', 'invalid_revision'],
    ['record.entityType', 'unsupported_entity_type'],
  ]);
});

test('snapshot hash is stable across record order and object key order', () => {
  const first = makeRecord();
  const second = makeRecord({
    entityType: 'daily_task',
    entityId: 'today-1',
    payload: { priority: 2, title: 'Plan' },
  });
  const reorderedSecond = {
    ...second,
    payload: { title: 'Plan', priority: 2 },
  };

  const originalHash = snapshotHash([first, second]);
  assert.match(originalHash, /^[a-f0-9]{64}$/);
  assert.equal(
    snapshotHash([first]),
    '8bbb7564650d81abbca97e647f96f81188eb1227efe4d841536a01fa21190c50',
  );
  assert.equal(snapshotHash([reorderedSecond, first]), originalHash);
  assert.notEqual(
    snapshotHash([makeRecord({ payload: { title: 'Read', notes: 'line one line two' } }), second]),
    originalHash,
  );
});

test('first-import preview unions local and cloud records without inferring deletion from absence', () => {
  const localOnly = makeRecord({ entityId: 'local-only' });
  const cloudOnly = makeRecord({
    entityType: 'daily_task',
    entityId: 'cloud-only',
    revision: 8,
    serverUpdatedAt: '2026-07-22T13:00:00.000Z',
  });

  const preview = previewFirstImport({
    localRecords: [localOnly],
    cloudRecords: [cloudOnly],
  });

  assert.deepEqual(
    preview.mergedRecords.map(({ entityType, entityId, deleted }) => ({ entityType, entityId, deleted })),
    [
      { entityType: 'daily_task', entityId: 'cloud-only', deleted: false },
      { entityType: 'long_task', entityId: 'local-only', deleted: false },
    ],
  );
  assert.deepEqual(preview.additions, [
    { entityType: 'long_task', entityId: 'local-only' },
  ]);
  assert.deepEqual(preview.counts, {
    local: 1,
    cloud: 1,
    merged: 2,
    additions: 1,
    duplicates: 0,
    conflicts: 0,
    tombstones: 0,
  });
});

test('first-import preview collapses an exact semantic duplicate and keeps cloud metadata', () => {
  const local = makeRecord({ revision: 0, serverUpdatedAt: null, deviceId: 'legacy-device' });
  const cloud = makeRecord({
    revision: 7,
    serverUpdatedAt: '2026-07-22T13:00:00.000Z',
    deviceId: 'cloud-device',
  });

  const preview = previewFirstImport({ localRecords: [local], cloudRecords: [cloud] });

  assert.deepEqual(preview.mergedRecords, [cloud]);
  assert.deepEqual(preview.duplicates, [
    { entityType: 'long_task', entityId: 'task-1' },
  ]);
  assert.equal(preview.counts.duplicates, 1);
  assert.equal(preview.counts.merged, 1);
});

test('first-import preview retains cloud content and deterministically forks a divergent local ID', () => {
  const local = makeRecord({
    payload: { title: 'Legacy title', notes: 'first line\nsecond line' },
  });
  const cloud = makeRecord({
    payload: { title: 'Cloud title', notes: 'cloud note' },
    revision: 5,
    serverUpdatedAt: '2026-07-22T13:00:00.000Z',
  });

  const expectedForkId = createDeterministicForkId(local);
  assert.equal(createDeterministicForkId({
    ...local,
    revision: 99,
    serverUpdatedAt: '2026-07-22T14:00:00.000Z',
  }), expectedForkId);
  assert.notEqual(
    createDeterministicForkId({ ...local, payload: { ...local.payload, title: 'Changed' } }),
    expectedForkId,
  );

  const preview = previewFirstImport({ localRecords: [local], cloudRecords: [cloud] });
  assert.deepEqual(preview.conflicts, [{
    entityType: 'long_task',
    entityId: 'task-1',
    resolution: 'fork_local',
    forkEntityId: expectedForkId,
  }]);
  assert.equal(preview.counts.conflicts, 1);
  assert.equal(preview.counts.merged, 2);

  const retainedCloud = preview.mergedRecords.find(({ entityId }) => entityId === 'task-1');
  const forkedLocal = preview.mergedRecords.find(({ entityId }) => entityId === expectedForkId);
  assert.deepEqual(retainedCloud, cloud);
  assert.equal(forkedLocal.legacySourceId, 'task-1');
  assert.deepEqual(forkedLocal.payload, local.payload);
  assert.equal(forkedLocal.payload.notes, 'first line\nsecond line');
});

test('deterministic fork IDs extend their digest when the short ID is already occupied', () => {
  const record = makeRecord();
  const shortId = createDeterministicForkId(record);
  const extendedId = createDeterministicForkId(record, new Set([shortId]));

  assert.notEqual(extendedId, shortId);
  assert.equal(extendedId.startsWith(shortId), true);
  assert.equal(createDeterministicForkId(record, new Set([shortId])), extendedId);
});

test('another device importing the same legacy conflict reuses the existing semantic fork', () => {
  const local = makeRecord({
    payload: { title: 'Same legacy copy', notes: 'must appear once' },
    deviceId: 'second-legacy-device',
  });
  const originalCloud = makeRecord({
    payload: { title: 'Cloud copy', notes: 'different content' },
    revision: 3,
    serverUpdatedAt: '2026-07-22T13:00:00.000Z',
    deviceId: 'cloud-device',
  });
  const forkId = createDeterministicForkId(local);
  const existingFork = {
    ...local,
    entityId: forkId,
    legacySourceId: local.entityId,
    revision: 1,
    serverUpdatedAt: '2026-07-22T13:05:00.000Z',
    deviceId: 'first-legacy-device',
  };

  const preview = previewFirstImport({
    localRecords: [local],
    cloudRecords: [originalCloud, existingFork],
  });

  assert.equal(preview.counts.merged, 2);
  assert.equal(preview.counts.conflicts, 0);
  assert.equal(preview.counts.duplicates, 1);
  assert.deepEqual(preview.duplicates, [{ entityType: 'long_task', entityId: forkId }]);
  assert.deepEqual(preview.mergedRecords, [originalCloud, existingFork]);
});

test('first-import preview preserves explicit tombstones but never invents one for a missing record', () => {
  const localTombstone = makeRecord({
    entityType: 'distraction',
    entityId: 'deleted-locally',
    payload: null,
    deleted: true,
  });
  const cloudActive = makeRecord({ entityId: 'cloud-stays-active' });

  const preview = previewFirstImport({
    localRecords: [localTombstone],
    cloudRecords: [cloudActive],
  });

  assert.deepEqual(preview.tombstones, [
    { entityType: 'distraction', entityId: 'deleted-locally' },
  ]);
  assert.equal(
    preview.mergedRecords.find(({ entityId }) => entityId === 'cloud-stays-active').deleted,
    false,
  );
  assert.equal(preview.counts.tombstones, 1);
});

test('first-import preview rejects duplicate IDs inside either source snapshot', () => {
  assert.throws(
    () => previewFirstImport({
      localRecords: [makeRecord(), makeRecord({ payload: { title: 'other' } })],
      cloudRecords: [],
    }),
    (error) => error instanceof ContractValidationError
      && error.errors[0].code === 'duplicate_record_id',
  );
});

test('mutation idempotency helper accepts each mutation ID at most once', () => {
  const existing = {
    mutationId: 'already-applied',
    baseRevision: 0,
    record: makeRecord(),
  };
  const fresh = {
    mutationId: 'fresh',
    baseRevision: 0,
    record: makeRecord({ entityId: 'task-2' }),
  };

  const result = partitionMutationsByIdempotency(
    [existing, fresh, { ...fresh }],
    new Set(['already-applied']),
  );

  assert.deepEqual(result.accepted, [fresh]);
  assert.deepEqual(result.duplicates, [
    { mutationId: 'already-applied', reason: 'already_received' },
    { mutationId: 'fresh', reason: 'already_received' },
  ]);
  assert.deepEqual(result.receivedMutationIds, ['already-applied', 'fresh']);
});
