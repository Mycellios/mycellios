# Agent workspace integration

Reconcile the retained workspace implementation with the published Agent,
starting from main revision `6fe29681aa91309555795674a7ac1ae11bac577d`.
This is a source integration, not a replacement with an older working tree.

## Scope

- Tasks is the shared inbox of named Mico conversations in the current owner/Space,
  regardless of whether they were opened from the Mico or Tasks. Discover existing
  ordinary task threads into the existing inbox metadata, idempotently and in
  bounded batches. Exclude main/group chats, routine/workflow threads, archived
  Micos and interrupted inbox starts. Discovery never creates or starts a Run.
  Preserve per-conversation archive/read state. Classify completed turns as
  needing review, never implicitly archived or business-goal completed. Reuse
  the existing task detail, explicit archive/restore, and exact bot/thread chat
  navigation. SQL isolation and actual local browser checks qualify this bridge.

- Integrate the workspace rail and per-account/Space pins, unified integration,
  Mico and skill marketplace, help and provider menus.
- Integrate the routine diagram, editable workflow canvas, task inbox, schedule
  calendar and usage dashboard with their actual owned services and persistence.
- Retain the paper/forest chat palette, compact execution activity, current
  composer behavior and independent side questions.
- Integrate continuous voice with bounded optional native engines and the
  existing browser/provider speech paths. Preparation stays explicit; no model
  download, microphone permission or paid call is a test fixture.

## Published behavior to preserve

- Existing Mico tasks, project conversations and their immutable thread/Space
  RPC targets, separate drafts, worktree admission, leases and cancellation.
- The workflow worker, revision checks, execution snapshots, nonces and recovery
  already released in the existing workflow controls.
- Searchable account/Space settings, integrations, skill versions and secrets.
- Released Video Studio, its fixed native driver and private Apps admission.
- Desktop caption reservations, native module packaging, shutdown and profile
  isolation. No installed application or user profile is modified by integration.
- Concurrent configuration-import work remains outside this integration and
  branch cleanup; existing agent-import entry points remain available.

## Integration boundaries

Port new leaf modules first. Reconcile shared Shell, contracts, database and
native host changes by feature hunks, retaining newer branches' behavior.
Task inbox ownership and its schema additions must coexist with existing task
and project ownership. Calendar and usage reads remain bounded and account/Space
scoped. UI-only navigation never starts work. Unknown or ambiguous execution
outcomes cannot be replayed automatically.

## Verification and delivery

Use the shared scheduler for installs, incremental production typing, directly
affected tests and the necessary publication build. Use isolated local database,
worker and browser fixtures for new persistence and execution paths. Verify
task/project context isolation and real UI rendering at desktop/mobile sizes.
Full CI/platform matrices remain omitted under the selected fast-delivery mode.

Fetch and integrate the current main again before publication. Preserve immutable
source snapshots and recovery refs. Clean only branches whose changes are proven
absorbed, are not checked out by another task and have no active unmerged PR;
retain unfinished candidates and concurrent work. Capability qualification is
recorded in the canonical status document when achieved.

### Conversation follow-up

- New bot replies remain distinct from read conversations awaiting continuation.
- Pins are stored on existing owner/Space inbox metadata, rendered once at the top.
- Optional one-shot reminders persist as UTC instants; date entry uses device local time. The existing worker reconciler claims bounded due batches and uses the existing privacy-aware native/Web Push channels, with explicit task-thread links. No inference or billing is performed. A due marker remains until dismissed or rescheduled; absent/disabled delivery does not consume the reminder.
- Archive cancels reminders and unpins. Cancellation/rescheduling invalidates pending Web Push delivery. A worker crash can retry an expired claim; native network acceptance is at-least-once across a crash, while the Web Push outbox deduplicates device/reminder/date.
- Local qualification uses the additive migration and scripts/verify-task-conversations-route-db.ts with real SQL/RLS, synthetic notification transport, scoped UI tests and browser checks. Physical OS delivery requires a configured recipient and is a separate qualification.
