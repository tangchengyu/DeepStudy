# Mobile and Sync Foundation Implementation Plan

## Milestone 1: contracts and deterministic merge rules

- Create the shared sync record and mutation contract.
- Add validation for supported entity types and payload size.
- Add deterministic snapshot hashing and first-import preview rules.
- Test union, exact duplicate, divergent-ID fork, tombstone, and idempotency cases.

## Milestone 2: Cloudflare gateway

- Create a TypeScript Worker with Hono, Firebase Auth adapter, native D1 support, username entry points, and gateway bearer sessions.
- Add D1 migrations for gateway sessions, recovery credentials, devices, sync records, mutation receipts, change log, imports, conflicts, and active timer leases.
- Add health, authenticated session, import preview/commit, push, pull, conflict, and timer takeover routes.
- Protect account entry points with Turnstile and database-backed rate limiting.
- Add local D1 integration tests and a production CPU smoke script.

## Milestone 3: Android application shell

- Create the Vue 3/Vite/Capacitor application and Android project.
- Implement the five-tab phone layout and safe-area-aware bottom navigation.
- Add local IndexedDB stores, durable outbox, secure session-token storage, device identity, and connectivity-aware sync.
- Implement username registration, sign-in, recovery-code presentation, recovery, and sign-out.

## Milestone 4: mobile product flows

- Today: task list, priority, completion, ordering, and offline changes.
- Long: four-quadrant overview, quadrant list, task detail, note preservation, create/edit/complete/delete/move.
- Focus: focus timer, distraction capture, explicit remote takeover, session finalization.
- Rest: rest timer, time audit, and return-to-focus flow inside the Focus tab.
- Habit: daily reflection and synchronized audit summary; keep future custom habit/streak entities out of the first schema.
- Mine: account, devices, last sync, conflicts, import status, and manual sync.

## Milestone 5: existing desktop enrollment and sync

- Add main-process account/session storage and authenticated gateway client.
- Add narrow IPC for enrollment preview, import, sync status, conflict resolution, and timer takeover.
- Snapshot existing `long-tasks.json` and Local Storage in the renderer without changing their paths.
- Preserve all existing fields, create pre-sync backups, verify writes, and never call `localStorage.clear()`.
- Mirror the approved desktop client changes into both desktop repositories.

## Milestone 6: verification and delivery

- Run unit, Worker/D1 integration, browser UI, isolated Electron, and Android tests.
- Verify import against copies of real legacy data, never the live profile.
- Deploy a staging Worker and pass the Workers Free authentication CPU gate.
- Build a signed or clearly labeled pilot APK through Android tooling or GitHub Actions.
- Scan Git history and tracked files for credentials, local databases, exports, and collaboration attribution before publishing.
