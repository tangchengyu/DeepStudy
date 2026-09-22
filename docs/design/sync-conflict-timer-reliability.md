# Sync Conflict Clarity and Timer Reliability

## Scope

This change improves conflict handling across the desktop and Android clients, prevents content-identical writes from becoming user-facing conflicts, and makes focus timers continue locally when the sync service is temporarily unavailable. It also produces synchronized desktop and Android release artifacts for version 1.2.53.

## Conflict detection and convergence

The gateway will compare the user-visible record state when a mutation arrives with an outdated base revision. Records are equivalent when their entity identity, deletion state, legacy source identity, and canonical payload are equal. Transport metadata such as revision, server timestamp, client timestamp, and device ID does not make otherwise equal content a conflict.

When equivalent content is detected, the gateway records an idempotent mutation receipt that points at the existing authoritative revision instead of creating a conflict. Existing open conflicts remain resolvable by older clients. Updated clients recognize content-identical conflict pairs and safely choose the authoritative cloud copy so stale local outbox entries can converge without a meaningless user decision.

True content differences remain explicit and never auto-select a winner.

## Conflict presentation

The desktop account button shows the current unresolved conflict count as soon as continuous sync reports it. Opening account sync automatically loads the conflict list; the separate refresh button remains available.

Each conflict card presents:

- a clear entity label;
- a notice when user content is identical and only synchronization metadata differs;
- changed fields in a side-by-side comparison, with changed rows visually emphasized;
- synchronization metadata in a separate section;
- expandable complete records for troubleshooting.

The Android conflict list uses the same distinction between content and metadata and retains its compact, human-readable summary.

Both clients provide `Keep all local` and `Keep all cloud` controls. Bulk operations use the existing idempotent per-conflict operation IDs and run sequentially to avoid rate spikes. Choosing all cloud versions requires confirmation because it discards pending local edits. Progress remains visible, successful items disappear, and any failed items remain available with a partial-failure summary.

## Focus timer behavior

Starting a focus or rest timer remains guarded by the remote lease check when the gateway is reachable:

- a confirmed timer owned by another device blocks local start and shows a visible takeover message;
- a successful claim starts normally and continues publishing heartbeats;
- an unavailable gateway, expired session request, or interrupted readback allows the local timer to start immediately with an offline-sync warning.

An offline local timer keeps using an absolute target timestamp rather than counting interval callbacks. Window focus and document visibility changes force an immediate tick so macOS WebView/Electron timer throttling cannot leave a stale display. When connectivity returns, the next publish attempts to claim the lease. If another device is then confirmed as owner, the local timer pauses and the user is asked to take over explicitly.

The start button exposes `starting`, `running`, `offline`, and `blocked` feedback so a failed network operation can no longer look like a successful but frozen timer.

## Testing

Regression tests cover:

- gateway mutation handling for equal payloads with stale revisions;
- existing identical-conflict convergence;
- field-level difference extraction and metadata-only conflicts;
- conflict-count badges and automatic list loading;
- bulk local/cloud resolution, confirmation, progress, and partial failure;
- offline timer start, confirmed remote-owner blocking, and recovery publication;
- immediate timer recomputation after focus and visibility changes;
- existing desktop, gateway, and Android test suites;
- desktop, Android, and macOS package builds through their supported build environments.

## Release and delivery

All package versions advance to 1.2.53. The repository is checked for unintended attribution, co-author metadata, generated artifacts, and unrelated working-tree changes before committing and pushing. A `master-v1.2.53` release receives the Windows installer, macOS disk image, and Android APK. The Windows desktop shortcut is recreated at `C:\Users\DELL\Desktop\DeepStudy.lnk` and targets the current packaged application from `G:\my_code\deepstudy\deepstudy-vue`.
