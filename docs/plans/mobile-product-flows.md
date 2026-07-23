# Android Product Flows

## Global constraints

- Keep the approved five-tab navigation: Today, Long, center Focus, Habit, Mine.
- Keep Long as a two-by-two quadrant board. A quadrant opens a list and a task opens a detail/editor screen.
- All writes are local-first through the durable sync repository. Offline work must remain in the outbox.
- Preserve unknown payload fields and legacy `id`, note line breaks, and `plannedAt` values when editing imported records.
- Never render note text as HTML. Use plain text with preserved line breaks.
- Use the existing system-font, light, flat visual language. Do not add remote font or icon dependencies.
- Interactive targets are at least 44 CSS pixels, focus states remain visible, safe areas are respected, and reduced-motion is honored.
- A remote active timer is read-only until the user explicitly taps `接管并继续`.

## Task 1: Today and complete Long CRUD

### Today

- List active `daily_task` records for the local calendar date, ordered by `order`, then `createdAt`.
- Create, rename, complete/reopen, delete, toggle priority, and move tasks up/down.
- New payloads remain compatible with desktop fields: `id`, `text`, `priority`, `done`, `createdAt`, `completedAt`, and `order`.
- Editing merges into the existing payload rather than replacing it, so unknown fields survive.
- Empty, offline-pending, and save-error states are visible without blocking local editing.

### Long

- Keep the four-quadrant board, quadrant list, and detail hierarchy.
- Add task creation, title and notes editing, optional `plannedAt`, completion, deletion, and moving between quadrants.
- Treat the envelope `entityId` as the routing identity. If an imported payload contains a different legacy `id`, retain that payload field unchanged on every update.
- New task payloads include desktop-compatible fields while existing unknown fields survive every update.

### Verification

- Repository tests cover unknown fields, legacy payload IDs that differ from envelope IDs, multiline notes, `plannedAt`, tombstones, ordering, and offline outbox retention.
- Component tests cover create/edit/complete/delete/move and keyboard-accessible forms.

## Task 2: Focus, Rest, distraction, and explicit takeover

- Support focus and rest modes in the existing Focus tab.
- Focus duration is configurable from 1 to 240 minutes; rest duration is configurable from 1 to 240 minutes.
- Persist active local timer state and recompute from `targetEndAt` after visibility changes or WebView suspension.
- Support start, pause, continue, reset, and completion. Focus records `focus_session`, `mode_event`, and `time_audit`; rest records `mode_event` and `time_audit`.
- Focus work type is `core` or `maintenance`; audit categories remain compatible with desktop.
- Quick distraction capture pauses focus, records a `distraction` plus distraction audit entry, and lets the user return to focus.
- Add gateway timer GET/claim/release methods and lease-version compare-and-swap handling.
- Never auto-adopt a timer owned by another device. Show its mode and remaining time with a single explicit `接管并继续` action. A stale lease refreshes the displayed remote timer.
- Offline timers may continue locally, but reconnect must surface ownership conflict before claiming remote ownership.

### Verification

- Fake-clock tests cover pause/resume, WebView suspension, completion, reset, audit/session payloads, and no double accounting.
- Gateway-client/service tests cover initial claim, stale lease, rejected takeover, explicit takeover, release, and old-owner pause after observing a newer lease.

## Task 3: Habit reflection and audit summary

- Show today's manual reflection editor and reflection history grouped by date.
- Create, edit, and delete `reflection` records while preserving unknown fields.
- Show today's and seven-day totals for `core`, `maintenance`, `rest`, and `distraction` from synchronized `time_audit` records.
- A completed Today or Long task may create/update a desktop-compatible completed-task reflection entry without duplicating an existing entry.
- Habit remains reflection/audit based in this release; do not introduce a new streak or habit entity type.

### Verification

- Tests cover reflection CRUD, multiline text, unknown fields, date grouping, completed-task de-duplication, and audit aggregation across day boundaries.

## Release UI gate

- Verify at 375 px and 768 px widths with no horizontal scrolling or content hidden behind the bottom navigation.
- Verify Android back navigation across Long board, list, detail, and editor flows.
- Verify all five tabs in an installable APK build before publishing.
