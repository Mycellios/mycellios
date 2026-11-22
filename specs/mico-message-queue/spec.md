# Messages that wait while a Mico works

When the person writes to a Mico that is busy, the composer either queues the message (it waits
for the current turn to end) or steers it (it joins the running turn). Until now the queue was a
read-only list: the person could not change the order, edit or remove a waiting message, push one
into the running turn, start one at once, or move one somewhere else, and nothing said why the
messages were waiting. This spec covers the controls for queued messages, how a steered message
reaches the model, the Mico's turn limit and the status of a turn that waits for its own
background work.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Kept as it is

- The busy-message default is per device ("queue" unless changed), with the per-Mico override
  (null inherits the device). The app does not switch the default to steering.
- Text typed while a turn waits on an open question answers that question.
- A queued message shows in the transcript at once; the queue panel only manages its turn.
- A Pi Mico runs up to its limit of conversation turns at once (1-4, default 4).

## The queue

Queue rows are the person's own `steering_messages` rows with `originTrigger = queued_user` that
no turn holds yet (`runId` null). New columns (additive migration
`20261123090000_message_queue_controls`):

- `position`: the queue order (lowest first). A new row takes its message's `seq`; rows that
  were already waiting get theirs in the migration. A reorder hands the queue's own positions out
  again in the new order, so later messages stay later; Send now goes before the first one.
- `heldBy`, `heldAt`: an edit in progress (the editing client's hold id).
- `editDraft`: the unsaved text of that edit, sealed with the Space key like message content.

Draining (`createPendingSteeringRun`, after a turn ends, a stop, or a queue action) starts one
queued message per turn in position order. A held first message stops the queue until the edit
is saved or cancelled; a hold never expires. The queue takes its turn among other waiting
messages (steering that could not join a turn, a Mico's own task messages, channel messages) at
the time of its oldest message. A turn that fails on a usage or credit limit, or needs a sign-in
or a working key, leaves the queue waiting instead of spending it on the same failure; the
person starts one with Send now (or sends a new message).

The running turn never takes a queued row as steering (its claim only reads rows with no origin
or rows already given to it), and nothing in the queue releases a human computer takeover.

Every action resolves the person's own conversation (main chat, side conversation or group)
and takes the thread row lock that sends take. A lost race answers CONFLICT with a stable code
(`gone`, `held`, `not_held`, `stale`, `empty`, `not_alone`, or why Steer now does not apply:
`idle`, `routine`, `own_work`, `waiting`).

- **Steer now** gives the message to the running conversational turn as the person's own
  steering (origin cleared, so it never counts as outside content). It is refused while a
  routine or the Mico's own work runs, while the turn waits for an answer, or when nothing runs.
  During a human takeover the message waits for the turn to resume; the takeover stays.
- **Send now** moves the message to the front, stops only the turns holding this conversation
  (as Stop does for them, including their delegated work) and starts that message next. The
  rest of the queue keeps waiting in order; a queued message whose turn had not started yet
  goes back to the queue instead of being stopped with it.
- **Edit** opens a hold and returns the text (or the saved draft). The draft is kept on the
  server while typing. Save replaces the message's text everywhere it shows (files and links
  stay) and the queue continues; Cancel releases it unchanged. An edit open on another device is
  refused unless the person takes it over here, which keeps its draft; the other device can then
  no longer save. A message that started or was removed meanwhile cannot be saved: the person
  keeps the text and can put it back in the composer.
- **Delete** works only while the message waits. It removes the message from the queue and the
  conversation (`thread.message.deleted`); a message being edited elsewhere is deleted only after
  the person confirms.
- **Reorder** (drag a row, the arrow keys on a focused row, or Move up/down) covers at most 100
  messages and sends the order the person saw; a different current order is refused as stale.
- **Move to a new conversation** (the + on a queued message) applies to a message the person
  sent to this one Mico. In one transaction it opens a person-started side conversation
  (`mico-task:<mico>:queue:<message>`), titled from the message's first line like any first
  message, starts the message there and removes it here. The conversation opens as a tab in the
  background. A message that already started stays; a group message is refused.

## Why the messages wait

The panel heading says how many messages wait; the line beside it says why:

- **busy**: a turn runs in this conversation;
- **slot**: this conversation's turn waits for one of the Mico's conversation slots (with how
  many of its conversations are working);
- **restart**: the Mico's computer or the server restarts;
- **usage** / **signin**: the last turn stopped at a usage or credit limit, or needs a sign-in or
  a working key; the queue waits for the person;
- **held**: the first message is being edited.

Each row shows the first file's thumbnail (or a file chip), an "Editing" or "Being edited
somewhere else" mark and, when the running turn cannot take steering, "Not steered" with the
reason.

## The main chat's lane

A Pi Mico's main chat never counts toward its conversation limit, so a person who writes there
never waits behind side conversations, delegated work or routines. Side conversations past the
limit wait for a free slot. Delegated work uses the same slots. The main chat still runs one turn
at a time. Native engines (Codex, Claude, ACP, OpenCode) keep one engine session and process per
Mico, so they run one turn in total, main chat included; their limit stays 1.

## Steering a running turn

A steered message reaches the model behind a short framing note: it adds to the work in
progress; a question gets a sentence or two and the work continues; a correction applies from
that point on; unfinished work continues unless the message asks to stop. The chat keeps only
the person's own words.

- Pi takes steering between steps, as before.
- Native engines take it after their next tool result: the message follows that result, so the
  engine reads it before it continues. A turn that makes no further tool call gets it as a
  follow-up turn after it ends, as before. Only PNG and JPEG images travel with a tool result.
- While a tool runs, the runtime checks every 2 s whether a message for this turn waits. A
  running shell command then returns what it printed so far and keeps running in the
  background (it is never killed); its final output arrives later as for any background
  command. Durable Desktop commands keep their existing wait.

## Waiting for background work

When a turn ends while its own background commands still run, the runtime waits for them before
the Mico continues. The activity row then reads "Waiting for background work…" with a timer from
when the wait began, until the work wakes the turn.

## Verification

- Web: `queue-panel.test.tsx`, `composer.test.tsx`, `thread-events.test.ts`,
  `RunActivityStatus.test.tsx`.
- API: `queued-message.test.ts`, `retry-thread-run.test.ts`.
- Runtimes: `native-agent-runtime.test.ts`, `pi-runtime-tool-dispatch.test.ts`,
  `steering-delivery.test.ts`, `shell-command-stream.test.ts`; core `message-queue.test.ts`;
  DB `events.test.ts`.
- `node --import tsx scripts/verify-message-queue-db.ts` on disposable loopback PostgreSQL:
  migration, order and reorder, holds blocking dispatch and surviving a new client, Send now,
  Steer now and routines, delete only while queued, the takeover guarantee, Move atomicity,
  usage-limit hold, the main-chat lane and the sealed edit draft.
