# Conversations a Mico opens itself, and their reports

A long main chat loses side jobs: the person changes topic, asks for something that takes
several steps (drafting and following a forum thread, a review, a build), the Mico does it
inline and later messages bury it. A Mico can now open its own side conversation for such
work, keep talking in the main chat, and receive the result back as a folded report.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Tools

- `start_task {title 1-120, brief 1-100,000}` opens a conversation of the Mico's own
  (`threads.startedBy = 'agent'`, `titleSource = 'agent'`, `startedByRunId` = the calling
  run, `taskBotId` = the Mico, key `mico-task:<mico>:agent:<tool effect key>`). Its first
  message is a `task_brief` block and its first turn a queued `agent_task` run, admitted by
  `claimMicoRun` under the Mico's existing concurrency. The result is
  `{taskId, title, note}`: the task runs beside the chat, the person can follow it in its
  tab, its answer comes back as a report; start the other independent tasks now, do quick
  parts yourself, tell the person in one sentence what runs and end the turn, never wait for,
  poll or read a running task.
- `message_task {taskId, text}` writes a `task_brief` follow-up. With a turn in progress it
  is a steering row with `originTrigger = 'agent_task'` that is never claimed mid-turn: the
  continuation after the turn answers it as its own `agent_task` run. An idle task gets a turn
  at once. An archived task is reopened in the same transaction.
- `close_task {taskId}` drops the queue, cancels the runs (computer work goes through the
  durable work-stop outbox, delegated work through `controlWorkTree`), then archives. Work that
  starts again is stopped again for up to 15 seconds; then the close fails and says the task
  still runs. A task the Mico closes sends no report.

The three tools are offered and accepted only in the Mico's own main chat and its owned
routine conversations: never in a side conversation, a group, an outside messaging chat,
background work or the creation intro. Elsewhere they are refused with an explanation.
`message_task` and `close_task` act only on conversations this Mico started; anything else
is "not available". `await_event` is refused in a conversation the Mico opened.

Limits: at most 8 unfinished (working, waiting or queued, or with unfinished delegated work)
conversations per Mico, counted under a per-Mico advisory lock. A ninth start fails at once;
there is no queueing, no automatic archive and no limit on open conversations. The tool call's
effect key makes a retry return the same task. If the transaction fails nothing exists and the
model is told to do the work in this turn.

## Reports

When a turn of an agent-started conversation ends, the transaction that ends it
(`finalizeRun`, `stopThreadRuns`, `expireStuckRun`) queues a report in the Mico's main chat:
a user-role message with a `task_report` block (plus the charts and images of that turn, at
most 4) and a queued `task_report` run whose prompt frames the report as data. Message and run
share the nonce `task-report:<thread>:<run>`, so each turn reports once.

- Reported turns: `agent_task` and `task_return` runs, and any turn while a teammate's request
  depends on the task.
- Skipped: a silent completed turn, a turn the person started there with no teammate waiting,
  a turn parked on delegated work (`delegationState` waiting), a conversation being deleted,
  and a close by the Mico.
- Text: the answer cut to 6,000 characters ending in `[…]`, a failure's error (500), or the
  title. Outcomes: completed, failed, stopped (by the person: "do not start it again unless
  they ask") and interrupted (lost, for example a stuck wait).
- Framing: the outcome, up to 8 other running tasks, `read_history` with the taskId for the
  rest, `message_task` to continue, `close_task` to stop, leave finished tasks open, and while
  related tasks run give a partial only when useful and combine at the last report.

The report turn is an ordinary paid main-chat turn: normal Credit admission, spending
observers and approvals apply; it starts tainted (not owner-started). The `agent_task` turn
itself sends no finish notification; the report turn does. The web shows the block folded as
"Update from {Mico}" with a toggle and a link to `?task=`.

## Teammates

If the turn that called `start_task` answered another Mico's request (`bot_message` with a
request or question), that turn's own outcome is not returned. The teammate gets one reply,
under the usual `auto-outcome:<run>` delivery key, once none of the tasks it opened (from its
`start_task` effects) and none of their report turns is still working: the Mico's answer to
the last report, or, when the tasks were closed, deleted or lost first, what they left marked
as stopped work. The executor settles it after each report turn; the job reconciler keeps
retrying the request run until it is delivered.

## History

`read_history` and `search_history` take `taskId` from the main chat or a routine thread for
a conversation this Mico started, under the same owner/Space/unarchived-Mico fence. Without
`messageId`, `read_history` returns the newest page (default 10, at most 20) and `nextCursor`
for `before`. Results stay untrusted data.

## Guidance

`AGENT_TASK_GUIDANCE` (with start_task) says when to open tasks: two or more independent
multi-step parts, long work when the person wants the chat free, or a separate topic that
takes several steps; quick parts inline; never for work this turn needs next, the same files as
another running task or screen/desktop work. Every side conversation receives
`TASK_CONVERSATION_INSTRUCTIONS`: what it shares with the main chat, re-read a file right
before changing it, and no git checkout/switch/reset/stash/rebase/commit unless the person
asks there.

## Restart safety

Starts, follow-ups and reports are durable rows (threads, messages, steering, queued runs);
the reconciler's queued-run scan repairs a lost enqueue and boot recovery resumes them.

## Verification

`node --import tsx scripts/verify-agent-tasks-db.ts` on a fresh loopback PostgreSQL cluster;
core/adapters agent-tasks, executor-agent-tasks, bot-messages, db events/messages/expire tests;
web message-view and peer-exchange-groups tests; `scripts/verify-resilient-work-db.ts` and
`scripts/verify-autonomy-waits-db.ts`. Fixtures and fakes do not qualify a live model's use of
the tools; that needs its own qualification.
