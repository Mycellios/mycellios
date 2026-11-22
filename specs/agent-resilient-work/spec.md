# Durable Mico work and native command recovery

Integrated release candidate; deployment and installer promotion require their own receipts.
The reference app d3ec956 is a behavior reference, not imported code. Its current noncommercial
implementation is not vendored or relicensed into Mycellios.

## Ownership and lifecycle

Concrete work uses delegate_task, work_status and the existing Micos/models. A child
has a persistent Task, expected result, dependencies, resource reservations and a
parent/root link. Private work gets a separate existing-style Mico task conversation;
group work retains the shared group history and validates membership. Transfer and
pause/resume/cancel use revisioned task controls. Resource names are coordination
metadata and grant no native access. The parent releases its model turn while waiting.

Scoped PostgreSQL advisory locks serialize admission and controls. Runs are durable
outbox records; the normal queued/expired-lease scan repairs a missed enqueue. Results
return once to the parent. A provider's completed turn remains a technical result,
not acceptance of a persistent goal. The parent must inspect work_status results and
verify the requested outcome. Existing goal acceptance policies are preserved.

Work plans and bounded continuation counters persist on the Task, fenced by the
active Run owner/fence. Stop and existing permissions remain authoritative. Exact
unchanged redelegation and bounded request budgets prevent repeated assignments;
this is not a semantic classifier that guarantees detection of all paraphrased loops.

Tree controls capture owned cancellation coordinates in a durable teardown outbox
before releasing execution ownership. Native cancellation is exact to the old run;
lease cleanup matches its fence. Reassignment/resume waits for teardown completion.
Composer Stop also covers a coordinator waiting between model turns.

## Native commands, including Windows

Capable hosts advertise durableCommands. Commands have a stable execution identity,
exclusive receipt admission, a request fingerprint and native-only bounded redacted
output. The native host owns execution; closing an HTTP observer does not replay or
cancel it. Explicit Stop, consent revocation, project changes and execution deadlines
still cancel its owned process tree. Windows continues to use OS Job Objects.

command_status reads receipts from the same admitted computer/Mico. Repeating an
existing identity observes its receipt and refuses a changed payload. A restart can
recover a recorded result; a host crash without an exit leaves an unknown outcome,
never synthetic rc=0. Such work must be inspected before any new write. This does
not claim that arbitrary processes can keep running through a PC reboot.

The default native shell deadline is bounded at one hour and can be explicitly
shortened with timeout_ms. This accommodates scheduler waits without a five-minute
cutoff. It is not a second scheduler or a bypass of compilar.ps1. Quiet output does
not itself trigger cancellation. Other computer providers keep their existing budget.

Native task/project bindings remain native-only, session/Mico checked and revocable.
Internal delegated conversations use the Mico's existing admitted workspace; they do
not require linking a development worktree. Explicit development projects retain
current-main's isolated native providers and scheduler routing.
Unscoped old-worker operations cannot enter an active task worktree. Ordinary native
workspace access still needs no folder picker. Existing local projects are retained.

## Compatibility and verification

Migration 20261104180000 is additive on tasks. The existing Mico conversation
migration supplies Thread task metadata; the Prisma model must represent it. The
release retains the current-main schema without importing unrelated in-progress models.
Retain older columns and data on rollback; stop new admission before code rollback.

Release, if later authorized: apply compatible additive migrations, update API/contracts
to accept the extra trigger values, update the worker and native host, then clients.
Old native hosts do not advertise durable support and must never be reported as
providing it. Native host access still requires its existing account/Space consent.

Qualification covers journal duplicates/truncation/redaction, real Windows HTTP
disconnect/restart/crash/timeout/owned cancellation, plan persistence, PostgreSQL
admission and dependency/resource races, missed publication/restart, parent return,
scope/fence rejection and revisioned pause/reassignment. Use scripts/verify-resilient-work-db.ts
only through compilar.ps1; it creates a synthetic loopback PostgreSQL cluster and
never loads .env or uses production accounts. Test/build results are recorded after
execution, not implied by this specification.

## Mico work controls, concurrency and workflows

The existing Mico task bar exposes Work and Workflows. Work inspects the durable
parent/child tree, its actual Run state and expected/result data. Pause, resume,
cancel and reassignment use the existing revisioned controls and teardown outbox;
stale revisions require a refresh. Recent delegated work remains owner/Space scoped.
Failure notifications respect existing per-Mico and device preferences and hide
names when notification previews are disabled.

Pi Micos admit up to four concurrent turns (configurable 1–4), atomically under
the Bot row lock across workers. One thread still has one live turn. Native engines
retain one turn until their shared provider sessions are qualified for concurrency.
Private Pi tasks acquire the existing exclusive computer lease lazily before their
first file, command or screen operation. This permits independent model/app work
without overlapping operations on the same computer. No filesystem or provider
permission is expanded, and resource/dependency reservations remain in force.

Workflows reuse existing Micos and their model/permission configuration. The visual
editor saves bounded DAGs with triggers, instructions, Micos, conditions, outputs
and notes. Manual and cron executions freeze a graph version, persist step outcomes
and run each Mico step in an owned private task conversation. The existing worker
reconciler advances them after restart without reinserting an accepted Run.
Conditions compare text; they do not evaluate source code. Prior output is untrusted
input, never new authorization. Explicit direct owner workflow requests may also
use the existing agent tool/effect/approval pipeline to prepare or run a graph.

Stop commits graph cancellation, exact Run cancellation and the existing durable
process teardown outbox together. An HTTP response does not certify OS teardown.
Additive migrations 20261105100000 and 20261105101000 supply the concurrency policy
and owner/Space-bound workflow records. Migration application, production promotion
and native session concurrency are separate qualifications, not implied here.

## Event waits

`await_event` parks an authorized private request as a `waiting_event` child of its
Task tree until an owned run finishes, the next result of an owned routine arrives
or a bounded time comes (note up to 2000 characters, timeout 1 to 43,200 minutes).
These conditions stay as they are: there is no new scheduler, no credential and no
model polling. The reconciler wakes the request once, in the conversation where it
parked. When that conversation was archived (by the person, or with its deleted
routine) the wake reopens it in the same transaction that queues the turn. The
woken turn starts with the original request and receives the note the Mico saved,
escaped as data and never as new permission.

The conversation shows an "Open waits" card for each wait that is waiting, paused,
woke (the turn running there must end first) or continuing its request. It says
what the wait is for and when it times out, shows the saved note and the original
request, and offers "Cancel the wait" while the wait has not woken. The side
panel's Conversations pane marks conversations with open waits.

One operation serves the card and the Mico's close_wait, under the scoped work
lock the reconciler takes, so a wait either wakes or is cancelled. A wait that has
not woken goes through the revisioned tree cancellation and its teardown outbox,
and records who closed it. When nothing else of its request is on the way, the
request ends as cancelled instead of waking for a cancelled wait. A wait that
already woke is never reported as cancelled: the card says so, and the Mico can
only mark it closed. list_waits and close_wait reach only the Mico's own waits, in
other conversations only where its history tools reach, and repeating a close
changes nothing.

Archive stops queued and running work but keeps a request parked only on its
waits, so the wake can bring the conversation back; composer Stop and Tasks Stop
still cancel it. With await_event the Mico is told to check a job expected to end
within about 15 minutes inside the turn at growing intervals, and otherwise to save
a wait, say what it waits for and end the turn, never using sleep loops, timers or
a provider's own schedulers.

Qualification: scripts/verify-autonomy-waits-db.ts on a fresh loopback PostgreSQL
cluster (list, scoped and idempotent close, card cancellation with and without
other pending work, a wait that woke first, archive and wake restore, Stop), the
event-waits, work-continuation, executor-agent-tasks and OpenWaits tests, and
`node scripts/verify-mico-tasks-ui.mjs` with synthetic RPCs. Live model use of the
tools needs its own qualification.
