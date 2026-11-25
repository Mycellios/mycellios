# Automate Micos with routines, signed events, scripts and workflows

Status: phase 1 implemented; phase 2 implemented except creation from chat; phases 3 to 6
are a proposed design.

This spec builds on `specs/mico-routine-runs/spec.md` (routine conversations,
main-chat markers, quiet and failed runs) and on the workflow engine and
`await_event` waits in `specs/agent-resilient-work/spec.md`. It covers releasing
the paused Routines and Workflows pages, signing inbound events, running a Mico
from a script and waiting for its answer, and workflow steps that wait for people
and events. A public service status page is outside this spec.

## Existing behavior

- Routines run in the backend today. A `Routine` starts from crons, a webhook,
  GitHub events, a messaging provider or a change watch (`CreateRoutineInput` in
  `packages/contracts/src/domain.ts`). Micos create and edit timed routines and
  change watches from chat with `schedule_create`, `schedule_list`,
  `schedule_update` and `schedule_cancel` (`packages/adapters/src/builtin-tools.ts`).
- Their UI is paused. `routinesAvailable()` reads `VITE_MYCELLIOS_ROUTINES ===
  "true"` (`apps/web/src/lib/routines-availability.ts`). Without it, the rail
  entry, the Routines page, the routine editor panel and "Routines for this Mico"
  in the computer panel show Coming soon (`workspace-rail.tsx`, `Shell.tsx`,
  `computer-panel.tsx`). The Schedule calendar stays visible, but opening or
  creating a routine from it lands on the paused editor. The gate came with #294
  without a recorded release criterion.
- Workflows use the same pattern with `VITE_MYCELLIOS_WORKFLOWS`
  (`workflows-availability.ts`, `WorkflowsAvailability.tsx`). Execution and the
  Mico tools `list_workflows`, `save_workflow` and `run_workflow`
  (`packages/adapters/src/workflow-tools.ts`) stay live.
- A workflow (`packages/contracts/src/workflows.ts`) has at most 60 nodes and 120
  edges: a manual or cron trigger, prompt (fixed text), agent (one Mico),
  condition (`contains`, `equals` or `nonempty` on the previous text) and output
  steps, plus canvas notes and drawings. Cycles are refused.
- Execution (`packages/adapters/src/workflows.ts`) starts each agent step in a new
  private task conversation. Steps run one at a time, even on parallel branches,
  and pass only text, cut at 30,000 characters. An output step only shows that
  text in the execution. A workflow has one open execution; a cron time that finds
  one open is skipped. The worker reconciles every 2 seconds.
- Saves check `expectedVersion` and each execution keeps a copy of its graph, but
  earlier versions cannot be listed or restored, and nothing exports or imports a
  workflow. No step waits for a person, no trigger takes an external event and
  steps have no typed fields; approvals happen only inside a Mico's own turn.
- `POST /api/v1/bots/:botId/webhook` (`apps/api/src/webhook.ts`,
  `webhook-inbound.ts`) accepts a 64 KiB body with one Bearer secret per Mico.
  `bots.rotateWebhookSecret` makes and shows it once and deletes the previous one
  at once; the only control that calls it is in the paused routine editor
  (`use-routine-editor.ts`).
- An event goes to up to five active webhook routines of that Mico (newest edited
  first), each in its own conversation, or to the main chat when none is active.
  Payloads are fenced as untrusted data. The `Idempotency-Key` header (or the
  payload's `id` or `event_id`) deduplicates; `RoutineDeliveryReceipt` keeps a key
  digest and is never pruned.
- That route has no signature over the body, timestamp window, per-routine URL
  or secret, event-type filter, test event or request limit of its own. GitHub
  events use a separate route with an HMAC check (`github-webhook.ts`). The answer
  is `{ messageId, runId, seq }`, and nothing lets the sender read that run's
  outcome.
- No token is scoped for scripts: Agent RPCs run with the person's signed-in
  session, and Mycellios API keys (`packages/contracts/src/mycellios-api-keys.ts`)
  serve the inference API, not Micos. There is no command-line tool. When a run
  ends, Mycellios notifies the person's devices; it never calls an external URL.

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) gives each webhook routine its own URL and secret,
signed with HMAC-SHA256 over timestamp, delivery id and body, with a five-minute
window, event-type and JSON Pointer filters, seven-day duplicate receipts and a
test event; it also accepts Standard Webhooks senders. A per-agent, opt-in local
API lets scripts on that computer send a message, run a routine, read a delivery's
status and answer, and list and answer pending questions and approvals. Its
command-line tool wraps that API with a wait option, a timeout that stops only the
wait, a retry key, JSON output and fixed exit codes. Its workflows add approval
steps, webhook and GitHub triggers, typed answers checked without a model call,
loops, outputs to messaging places, 50 saved versions, and export and import.

## Decision

Release what exists first, then harden and extend it, in six phases that each
ship alone. Phase 4 needs phase 2's signed URLs; phase 6 needs phase 3.

1. Phase 1 — release Routines and Workflows.
   - Release criteria, with both gates on: the fixtures listed under Verification
     pass; on the hosted deployment one routine per trigger kind (cron, webhook,
     change watch) and one scheduled workflow run end to end with ordinary Credit
     admission and main-chat markers; the Schedule calendar, the editor and the
     computer panel open the same routine.
   - The gates then become opt-out, as Hifa Store's: both pages are on unless
     `VITE_MYCELLIOS_ROUTINES=false` or `VITE_MYCELLIOS_WORKFLOWS=false` pauses them,
     and the Coming soon path stays for that case. Saved routines, workflows and
     jobs are untouched either way.
   - Open decision: release Workflows together with Routines (default), or keep
     it paused until phase 4.
   - Implemented: both gates are opt-out and Workflows ships with Routines; the
     hosted end-to-end runs are still to be reported.
2. Phase 2 — signed webhook routines.
   - Each webhook routine gets its own URL (`/api/v1/routines/<routineId>/events`)
     and secret in the Standard Webhooks format: `webhook-id`, `webhook-timestamp`
     and `webhook-signature` headers (`v1,` and the base64 HMAC-SHA256 of
     `id.timestamp.body`), a `whsec_` secret and timestamps within 5 minutes. The
     raw body is verified before it is parsed; every refusal gets the same 401.
   - The delivery id is the duplicate key per routine: a repeat answers 200 and
     starts nothing. Receipts keep the id digest, result and run id for 7 days,
     never the body.
   - An optional event type and up to 32 filters (a JSON Pointer into `data`, an
     equal value of the same JSON type, all must match) decide before any run. An
     ignored event, or one for a paused routine, answers 202 and appears in the
     routine's history with its reason.
   - Rotate shows a new secret once and keeps the previous one valid for 24 hours;
     Revoke ends both at once. Send test event signs a sample event with the
     routine's secret and starts a test run (`routine-test:`, never quiet).
   - Each routine accepts at most 60 events an hour, then 429.
   - From a person's message, a Mico can create a webhook routine and receives
     the URL, never the secret, which the person copies from a card. Routine runs,
     workflow steps and other Micos cannot create or change one.
   - The per-Mico Bearer route keeps accepting existing secrets; the UI stops
     issuing new ones. Open decision: retire that route later (default: keep it,
     with no removal date).
   - Implemented: per-routine URLs and secrets, signature and timestamp checks,
     7-day receipts, event type and filters, rotation, Revoke, Send test event and
     the hourly limit, in the routine editor. A routine with its own secret no
     longer takes the per-Mico route, and the UI issues per-Mico keys only for
     GitHub events. Creating a webhook routine from a person's message, with the
     secret card, is still to come; a real Standard Webhooks sender is still to be
     reported.
3. Phase 3 — run a Mico from a script and wait.
   - Scripts is off by default for each Mico. Only the owner turns it on, never a
     Mico. It creates a token scoped to that Mico, account and Space, shown once,
     stored hashed and revocable, at most 5 per Mico.
   - Routes under `/api/v1/micos/<id>/`: `POST messages` (text, a
     `clientMessageId` retry key kept for 24 hours, the main chat or a named or new
     conversation); `POST routines/<routineId>/run` (payload as untrusted data
     after the routine's instruction, also for a paused routine, as Test does);
     `GET deliveries/<id>` (queued, running, waiting, completed, failed or
     cancelled, and the redacted final answer once ended); `GET pending` (ordinary
     questions as data; approvals, credential requests and takeovers only say that
     something waits in Mycellios); `POST questions/<id>/answer`.
   - A routine run started this way wakes the `await_event` waits on that routine,
     as any routine result does, so a Mico can start a long job and be woken when
     it ends.
   - The `mycellios-cli` command-line tool (Node 22 or later; `mycellios` is
     already the Linux Desktop launcher) wraps these routes:
     `run <mico> <text|-> [--wait] [--timeout 30m] [--id <key>] [--json]`,
     `status`, `pending`, `answer` and `list`. `--timeout` stops only the wait.
     Exit codes: 0 done, 1 failed or stopped, 2 usage error, 3 waiting for a
     person, 4 wait timed out (work continues), 5 unreachable, unknown Mico or
     Scripts off. It reads the token from `MYCELLIOS_TOKEN` or a file, never from
     its arguments.
   - On a PC with Desktop, turning Scripts on can also save the token for that OS
     user in a private profile folder, so local scripts need no copied secret.
   - Bodies are at most 64 KiB. Accepted messages and runs share 60 an hour per
     Mico by default (the owner can raise it to 1,000); reads do not count.
   - Open decision: ship the tool in Desktop's resources (default), or also as an
     npm package.
4. Phase 4 — workflows that wait for people and events.
   - An approval step pauses the execution and shows Approve and Reject to the
     owner in the workflow's conversation; Reject stops the execution. Automatic
     approval reviewers never answer it.
   - A webhook trigger uses phase 2's signed URL with the workflow as its owner,
     with one open execution per workflow, as for cron.
   - Independent branches run their agent steps at the same time, within each
     Mico's concurrency.
   - A version is saved when the newest is older than 5 minutes, on restore, and
     when an execution starts on an unversioned revision; the newest 50 stay.
     Restore never starts an execution.
   - Export writes the graph as JSON with Micos by name, never ids, connections or
     secrets. Import maps names to the person's Micos, keeps unknown steps as locked
     notes and creates the workflow paused.
5. Phase 5 — typed steps and bounded loops.
   - An agent step may declare answer fields (`name: type`: text, number,
     integer, yes/no, list or fixed labels). The Mico returns them with a
     `workflow_answer` tool, checked in the same turn; one corrective turn follows
     when it does not.
   - Conditions can test declared fields (`priority = high and count > 2`)
     without a model call, and `{{name}}` in later steps inserts a value as data.
   - A loop is an edge back to an earlier step, through a condition only, with a
     pass limit per run (default 10, at most 50); reaching it fails the step with
     that reason.
   - An output step can post its text to a messaging channel that the workflow's
     Mico already uses, or notify the owner.
6. Phase 6 — run callbacks (optional).
   - A webhook routine, a workflow or a script message can name an HTTPS callback.
     When the run ends or waits for a person, the server sends a Standard Webhooks
     event (`run.completed`, `run.failed`, `run.waiting`) with the run id and
     status, and the answer only when the owner chose to include it.
   - Callbacks pass the public-address check of web fetches and never reach
     private or loopback addresses. They retry 5 times over about an hour with a
     stable `webhook-id`, and failures show in the routine's history.
   - Open decision: build it (default: only after phase 3, when an integration
     needs a push instead of waiting).

Rejected:

- Answering approvals with a script token, as the reference app allows. Anything
  holding the token could approve; scripts only learn that something waits.
- A loopback-only API on the PC as the sole entry. Micos live on the server, so
  the same HTTPS routes serve the PC, CI and other servers; Desktop only keeps the
  token.
- Custom signature headers. Standard Webhooks senders and libraries already
  exist.
- Unbounded workflow loops: every pass is a paid turn.
- Letting a token change a Mico's model, permissions or Scripts setting.

## Rules

- Every event, script call and workflow step starts ordinary runs with ordinary
  Credit admission, approvals, run fences, receipts and the no-replay rule. A 202
  means queued, not done.
- Event bodies, script payloads and step outputs stay fenced as untrusted data,
  never instructions or authorization.
- Secrets and tokens are shown once, stored encrypted or hashed, compared in
  constant time, and never logged, put in a prompt or given to a model. Logs name
  the Mico, routine and result, never the body.
- Each route resolves its Mico, account and Space from the secret or token alone,
  and a refusal reveals nothing about which Micos or routines exist.
- Only a person creates tokens, secrets and webhook routines; routine runs,
  workflow steps and other Micos cannot.
- A repeated delivery id, `clientMessageId` or execution nonce never starts a
  second run.

## Verification

- Phase 1: the RoutinesAvailability and WorkflowsAvailability tests for opt-out
  flags, `scripts/verify-routine-isolation-db.ts`,
  `scripts/verify-workflow-thread-db.ts`, `node scripts/verify-workspace-sync-ui.mjs`
  and `node scripts/verify-mico-tasks-ui.mjs`. The hosted end-to-end runs are
  reported separately.
- Phase 2: signature tests (valid, wrong secret, stale timestamp, changed body,
  both secrets during rotation), duplicate, filter, receipt-expiry and rate-limit
  tests and a test-event run (`apps/api/src/routine-events.test.ts` and
  `scripts/verify-routine-events-db.ts`). A real Standard Webhooks sender is
  reported separately.
- Phase 3: token scope and revocation on isolated PostgreSQL, route tests for
  every status, CLI exit codes against a fixture server, and an `await_event` wake
  through a script run (`scripts/verify-autonomy-waits-db.ts`).
- Phase 4: approval and webhook-trigger recovery after restart, parallel branch
  admission, version retention and restore, and an export/import round trip.
- Phase 5: answer-spec and check-expression parser tests, the loop pass limit
  and a fixture Mico calling `workflow_answer`.
- Phase 6: refusal of private and loopback callbacks, the retry schedule and
  outbound signatures.
