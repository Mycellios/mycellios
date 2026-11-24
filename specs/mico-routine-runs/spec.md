# Routine runs in their own conversation, as the main chat sees them

A routine works in a conversation of its own (one per routine, `taskKey = routine:<id>`), so
its answers never crowd the Mico's main chat. Until now the main chat did not show that a
routine had run at all, a run with nothing to say could not be told apart from one that never
happened, a routine could not say that it failed, and missed schedule times were invisible.
This spec covers what the main chat, the run history and the routine conversation show.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Kept as it is

- Routines run in their own conversation by default; only the per-routine setting below moves
  them to the main chat.
- Routine runs keep excluding screen, browser and PC app control tools at offering and
  execution.
- A fresh routine session keeps receiving only the bounded, redacted handoff from its own
  conversation; nothing from the main chat or other conversations is added, and no digest of
  a run is written into the main chat's model history.
- There is no limit on open conversations and nothing is archived automatically.

## Main-chat marker

When a run of a routine that works in its own conversation ends (`finalizeRun`, completed or
failed, including `failRunBeforeTurn`), the same transaction adds one system message to the
Mico's main chat with a `routine_run` block: Mico, routine id and name, the routine
conversation (`taskId`), the run, and its outcome in `status` (a key that stays plain when
blocks are sealed, so queries can filter on it):

- `reported`: it answered;
- `quiet`: it had nothing new;
- `failed`: it failed, or reported its own failure;
- `paused`: it turned its own routine off.

The message nonce `routine-run:<run>` makes a repeated finalize add nothing. Runs in an older
target (the main chat itself or a group), runs of a deleted routine and runs of an archived
Mico add no marker. Any outcome except `quiet` marks the main chat unread; a quiet marker leaves
the unread state alone, is never the sidebar preview and never moves the Mico up the list
(the sidebar queries leave quiet markers out, still reading one row per Mico for other
Spaces). A non-quiet marker's preview is the
routine's name. Markers are never part of the model's history (`loadRunHistoryMessages`
excludes them and their history text is empty).

The web draws a marker as one compact line ("{routine} ran · Open", with "nothing new",
"failed" or "paused itself" when that applies); Open opens the routine conversation as the
Mico's tab (`?task=`). Consecutive markers of the same routine, with nothing else between them,
share one closed line ("N runs of {routine} · Open") that lists each run's time and outcome when
opened. Notifications follow the existing rules: a quiet run notifies nobody.

## Quiet runs

A routine run may end silent through the existing `NO_RESPONSE` path. It is quiet when silence
was allowed and it posted nothing (no reply, no mid-turn message), did not pause its routine and
did not report a failure; the executor passes `quiet` to `finalizeRun`, which stores
`runs.quiet`. A Test or Run started by the person and a routine mentioned in chat (every
`routines.testRun` call now carries a `routine-test:` nonce, with `local:` for local scripts and
`routine-mention:` for chat) are never quiet: they get the normal reply guidance and an answer.
Scheduled, change-triggered and local-script runs may be quiet. Webhook runs keep their current
behavior (no silent finish).

## Reporting a failure

`routine_report_failure {reason 1-500}` is offered only to a run of a routine (`routine`, or a
`webhook` run of a routine, outside messaging channels) and refused elsewhere with an
explanation. The run keeps its turn: its reply is posted as usual, its steering counts as
answered, and only its status becomes `failed` with the reason as the run, attempt, task and
conversation error. It is never quiet, notifies as a failure under the routine's notify setting
and is never retried automatically. The routine history shows reasons up to 500 characters.

## Pausing itself

A scheduled routine run may call `schedule_update` only to pause its own routine
(`{routineId, active: false}`); any other edit is refused. The routine records the run
(`routines.pausedByRunId`, `pausedByRunAt`), the tool result tells the run to say so with the
reason, the run is never quiet and its marker reads "paused itself". The routine shows "Paused
by its {time} run" until someone changes the switch, which clears the record. The run's prompt
names its routine and id for this purpose.

## Run history

`routines.history` returns 100 runs per page. Each run carries what started it, read from
columns every run has (`trigger`, `clientNonce`, `retryOfRunId`, and the routine's watch):
schedule, watch, manual, script, chat, webhook, github or retry; the scheduled time of a timer
run; whether it was quiet; and how many earlier runs it covers. The web labels each row, shows
"Nothing new" for a quiet run, "Ran late: it was due {time}" when a timer run started 15 minutes
or more after its time, and the missed runs with their reason.

## Missed schedule times

A late wake-up still runs once for the time it was due and moves past the times that passed
meanwhile. Those are counted on the run (`runs.missedRuns`, reason `offline`, at most 1,000).
When an earlier timer run has not started yet, the new time folds into it instead: its count
grows by one (plus any skipped times) and its reason is `busy` unless it already was
`offline`. The late-run note the model receives says how many runs did not happen and why.

## The routine conversation

- Renaming a routine (editor or `schedule_update`) renames its own conversation, unless the
  person named that conversation (`titleSource = 'user'`). Other targets keep their title.
- A run brings an archived routine conversation back (`ensureRoutineThread` reopens it and its
  Tasks mirror); a change check that starts no run does not.
- Deleting a routine (editor, `schedule_cancel`, undoing an import) archives its own
  conversation in the same transaction, keeping its history; work still running there is not
  stopped. The main chat and group targets are never archived.
- The Routines UI stays paused by default (`VITE_MYCELLIOS_ROUTINES`); the server behavior is
  the same either way.

## Where a routine runs

A run in the main chat waits behind anything pending there (an unanswered question, a computer
takeover, a long turn), so a routine can stay queued for as long as that lasts. Each routine
therefore says where it runs, as `runIn` on the routine (derived from `routines.threadId`, no
new column):

- `thread`: its own conversation (the default). No thread yet means the next run creates it.
- `chat`: the Mico's main chat (`threadId` is the main chat's id).
- `group`: the group it was created in. It keeps that place and cannot be moved.

`routines.create` and `routines.update` take an optional `runIn` of `thread` or `chat`; older
clients that send none keep the current place (create: its own conversation). Moving to the
main chat keeps the routine's conversation and its history; new runs simply stop using it.
Moving back points the routine at that same conversation again, found by its key
(`routine:<id>`, archived ones too; the next run reopens it as usual), or clears `threadId` so
the next run creates one. `ensureRoutineThread` also adopts an existing conversation with that key
when `threadId` is null, so it never collides with the unique key. Deleting a routine archives its
conversation by key, so one that runs in the main chat still archives it. A group routine refuses
the move.

`schedule_create` and `schedule_update` take the same optional `runIn`. A routine a Mico creates
outside a group runs in its own conversation unless it asks for `chat`; one created in a group
runs in that group (and `runIn` there is refused), and the fleet tools' explicit target keeps its
thread. Duplicate names are matched per group thread in a group and across all non-group
routines elsewhere, which is what `schedule_update` reaches from each place. The routine editor
shows one switch, "Run in its own conversation", hidden for group routines and for servers that
do not report the place. Existing routines are not moved; that is a separate decision.

## Migration

`20261122180000_routine_run_markers` adds `runs.quiet` (default false), `runs.missedRuns`
(default 0), `runs.missedReason` (checked: offline or busy; NOT VALID so no scan), and
`routines.pausedByRunId` / `pausedByRunAt`. It is additive with constant defaults, rewrites no
table and needs no backfill: existing rows read as not quiet, nothing missed and not paused by a
run. Older releases ignore the columns.

## Verification

`node --import tsx --test scripts/verify-routine-isolation-db.ts` on a fresh loopback
PostgreSQL cluster (migration, markers, unread/preview, failure, self-pause, model history,
rename, reopen, moving to the main chat and back, and archive on delete); core routine-runs,
adapters executor-routine-runs, routine-scheduling, routine-lateness and schedule-tools tests;
API routine-runs and router (routine run place) tests; contracts index tests; web
RoutineRunMarker, routine-run-groups, message-view, RoutineRunHistory, routine-watch-draft and
RoutinesAvailability tests. Fixtures do not qualify a live model's use of the tools.
