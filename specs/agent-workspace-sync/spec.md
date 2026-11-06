# Agent workspace integration

Reconcile the retained workspace implementation with the published Agent,
starting from main revision `6fe29681aa91309555795674a7ac1ae11bac577d`.
This is a source integration, not a replacement with an older working tree.

## Scope

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
