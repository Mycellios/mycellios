### Added

- When a routine runs in its own conversation, the Mico's main chat now shows a short line such
  as "Morning brief ran · Open" that opens that conversation. Several runs of the same routine
  in a row share one line ("3 runs of Morning brief") that lists them when you open it.
- A routine can mark its own run as failed and say why, for example when a site it checks asks
  for a new login. The reason shows in the run history and in the failure notice.
- The routine run history labels each run by what started it (schedule, change, you, a local
  script, a chat mention, a webhook, GitHub or an automatic retry), shows runs with nothing new,
  runs that started late, and how many earlier runs did not happen and why. It loads 100 runs
  at a time instead of 20.
- When a routine pauses itself because its job is done, it says so, and the routine shows
  "Paused by its … run".

### Changed

- A routine run with nothing new no longer marks the Mico's main chat unread, changes its
  preview or moves it up the list; its line in the main chat says "nothing new". A Test or Run
  you start, or a routine you mention in chat, always answers.
- A routine's conversation now follows the routine's new name unless you renamed the
  conversation yourself, comes back from Archived when the routine runs again, and is archived
  (with its history) when you delete the routine.

### Self-host upgrade notes

- The `20261122180000_routine_run_markers` migration adds columns to `runs` (`quiet`,
  `missedRuns`, `missedReason`) and `routines` (`pausedByRunId`, `pausedByRunAt`). It is
  additive with constant defaults and rewrites no table; older releases ignore the columns.
