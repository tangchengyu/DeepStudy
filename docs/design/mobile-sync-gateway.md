# DeepStudy Mobile and Sync Architecture

## Product scope

The first mobile release is an Android application designed for phones, not a reduced desktop window. Its primary navigation has five bottom tabs:

1. Today
2. Long
3. Focus
4. Habit
5. Mine

The Long tab keeps the four-quadrant overview. A quadrant opens a full-width task list, and a task opens a full detail page with notes that preserve line breaks.

The sync service supports the currently released Windows and macOS desktop application plus Android. The initial synchronized domains are:

- today's tasks;
- long tasks;
- focus sessions and focus-mode events;
- rest-mode events and time audit entries;
- distractions;
- daily reflections, which are the persisted basis of the current long-term habit-building mode.

AI credentials, AI chat history, custom white-noise files, volume, window state, tutorial state, gate state, and other device preferences remain local.

## Repository layout

- `deepstudy-app/`: Vue 3, Vite, and Capacitor Android client.
- `deepstudy-gateway/`: Cloudflare Worker, D1 migrations, Firebase Auth adapter, gateway sessions, and synchronization API.
- `packages/sync-contract/`: framework-neutral record envelopes, validation, import preview, and conflict rules shared by tests and clients.
- the existing root Electron app remains the released desktop product. Desktop sync is added through explicit IPC and never by replacing its local storage paths.

The old `frontend/`, `backend/`, and `electron-shell/` directories are not part of the released application and are not used as the gateway foundation.

## Authentication and secret storage

Production authentication uses Firebase Auth Email/Password. The product UI still asks only for username and password; the gateway derives a deterministic, non-deliverable internal email from the username and never lets clients choose or view that email.

Passwords are never stored or committed as plaintext. Firebase Auth stores and verifies production passwords. D1 stores only the DeepStudy user profile, gateway session token digest, sync records, and peppered recovery-code digest. `GATEWAY_SECRET`, `TURNSTILE_SECRET_KEY`, `RECOVERY_CODE_PEPPER`, and Firebase service-account credentials are Cloudflare Worker secrets, never normal Wrangler variables or GitHub files.

The gateway issues a high-entropy recovery code once at registration. D1 stores only a peppered digest. Using the code rotates it, changes the password, and revokes existing sessions.

Mobile and desktop API clients use gateway-issued bearer sessions after Firebase Auth succeeds. Mobile stores the bearer token in Android secure storage. The browser development fallback uses session-scoped storage only. Electron stores credentials in the main process and exposes authenticated operations through narrow IPC; the renderer never receives a reusable session token.

Turnstile protects registration, username sign-in, and recovery. Native Android presents the supported Turnstile WebView flow. Server-side Siteverify is mandatory. Local development bypasses are explicit and cannot be enabled in a production environment.

## Offline-first record model

Every synchronized item is represented as a record envelope:

```text
entityType, entityId, payload, deleted, revision,
clientUpdatedAt, serverUpdatedAt, deviceId
```

Supported entity types are `daily_task`, `long_task`, `focus_session`, `mode_event`, `time_audit`, `distraction`, and `reflection`.

Clients write locally first and append an idempotent mutation to an outbox. Each mutation contains a unique mutation ID and the base server revision last observed by that device. The Worker accepts a mutation only once. A global change sequence provides cursor-based pulls.

Mutation receipts are retained so a delayed retry cannot silently turn into a new write. Conflict resolution has its own stable operation ID and compact durable result receipt; a client that loses the success response retries the same operation and receives the original result even after the larger resolved-conflict row is cleaned up.

Deletes create tombstones. They are not inferred from absence, because absence during a first import must never delete data from another device.

The Worker detects revision conflicts. Routine edits can be resolved explicitly by the client. During first import, an ID collision with different content is never silently overwritten: the cloud copy is retained and the legacy local copy is forked with a `legacySourceId`, then shown in the merge report.

Import plans keep the complete pending records but only bounded, payload-free report references. This prevents a valid near-limit import plus a concurrent large cloud record from exceeding D1's per-row limit. If a report is truncated, the response says so; record data itself is never truncated.

## Existing desktop data compatibility

The desktop application keeps its existing data locations:

- `long-tasks.json` remains version 1 under Electron `userData`;
- today, session, mode event, audit, distraction, and reflection keys remain in Chromium Local Storage.

Enrollment is a staged operation:

1. Build an in-app consistent read-only snapshot and compute counts plus a hash.
2. Show the user a preview; no local data changes at this point.
3. Submit an idempotent import identified by user, device, and snapshot hash.
4. Pull the committed cloud state and verify record counts and content hashes.
5. Create recoverable per-store backups immediately before applying any merged state.
6. Atomically write only the affected store and verify it before marking enrollment complete.

Long-task import preserves original IDs, note line breaks, `plannedAt`, and unknown legacy fields. It does not normalize away fields before upload. If the source changes while a snapshot is being collected, enrollment retries rather than importing a torn snapshot.

## Active focus and rest handoff

Completed sessions and audit records are append-oriented sync records. A running timer is separate state with a single lease per user:

```text
userId, mode, ownerDeviceId, status, leaseVersion,
targetEndAt, remainingMs, plannedMs, sessionStartAt,
segmentStartAt, accumulatedMs, workType, updatedAt
```

A second device shows the current timer but cannot start accumulating time automatically. The user must click `接管并继续`. The gateway performs a compare-and-swap on `leaseVersion`, changes the owner, and increments the version. The old owner observes the new version and pauses, preventing double accounting.

## Free-tier operating boundary

The intended pilot fits within the current Cloudflare Workers, D1, and Turnstile free quotas. Free-plan quota exhaustion fails requests instead of silently billing. This is a zero-current-cost design, not a promise that vendor policies can never change.

The release gate includes repeated registration, username sign-in, recovery, push, pull, and timer takeover tests on a real Workers Free deployment. Production authentication must complete through Firebase Auth without weakening password security parameters to meet a local CPU cost target.

## Backups and operations

- D1 migrations and public configuration are versioned.
- Secrets, local databases, exports, and development variable files are ignored.
- D1 Time Travel and scheduled exports are used for recovery.
- Indexed queries are required for user, cursor, mutation, and timer lookups.
- Metrics track authentication failures, Worker CPU-limit errors, sync conflicts, D1 rows read/written, and import verification failures.
