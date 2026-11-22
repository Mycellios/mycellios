# Micos working with each other, and groups with a lead

A Mico that needs two teammates for one job used to send two separate messages and wake up
twice, once per answer, with no way for the person to see who still owed an answer. Groups
woke their first member for anything addressed to nobody, and a member could copy another
member's answer instead of giving its own. This spec covers requests to several Micos, the
"Waiting for replies" list, team awareness, and groups with a purpose and a lead.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Messages between Micos

- `message_bot` takes `bot_id` or `bot_ids` (1 to 32 Micos of the same owner and Space),
  `message`, `intent`, `expects_reply`, `reply_to_message_id` and `paths` (at most 10
  workspace files). Each recipient gets its own copy in its own chat and its own
  `bot_message` turn: a message from another Mico always gets its own turn and never steers a
  running one.
- Files travel as owner/Space artifacts through the existing attachment path (`attach_file`'s
  `attachWorkspaceFileToThread`); each recipient's turn copies them into its own workspace like
  any attachment. Without a computer or artifact storage the call fails before sending.
- `expects_reply: false` turns a request or question into an update (`fyi`) the recipient must
  not answer; `true` turns an update into a request. Results and statuses keep their intent.
- `reply_to_message_id` must be a message the recipient sent this Mico; the delivery threads
  under it in the recipient's chat.
- A request or question opens a `bot_message_requests` row with one `bot_message_recipients`
  row per recipient (ids and states only; texts stay in the encrypted messages). The tool
  effect key makes a retried call replay instead of sending again.

### Answers come back together

- A recipient's answer is the automatic outcome of its turn (or an explicit `result`). It is
  written into the sender's main chat at once, folded under its marker.
- With one recipient the answer wakes the sender as before. With several, the answer is held
  (no turn) until every recipient has answered, failed or been stopped; then one
  `bot_message` turn hands the sender every answer as untrusted data and names who did not
  answer. If nobody answered (all stopped), no turn starts.
- Every settlement runs under the request's row lock, so an answer, a Stop and the reconciler
  cannot release a request twice. `stopThreadRuns` settles stopped recipients in the same
  transaction; the job reconciler settles recipients whose turns ended elsewhere (archived
  Mico, deleted conversation, crash) after 30 seconds.

### Markers

- Sent: "Messaged …" for requests and questions, "Informed …" for updates, results and
  statuses; several recipients are listed together. Received: "Message from …" for new work,
  "Update from …" for updates and answers.
- Every marker starts collapsed. Its toggle shows the message text, and for received new work
  or updates also the Mico's folded replies. An update's quiet reply (the turn may end with no
  reply) folds under its "Update from" marker.

## Waiting for replies

- Above the composer of a Mico's main chat: one block per request with "{done} of {total}
  replies in" (and the group, for `send_to_group`), one row per recipient with a hint (picks
  it up next, is working on it, needs you, replied, could not finish, was stopped) and Stop
  while it is asked or working.
- Stop is the person's own Stop on that turn (`tasks.stopAwaitingReply` →
  `stopThreadRuns`): same cancellation, teardown and settlement.
- Tasks the chat delegated with `delegate_task` are listed too. Stop pauses one through the
  revisioned work controls; a paused task shows a card with Continue (resume, from where it
  stopped), Reassign and Cancel task.
- A settled list stays for a day and offers "Hide this list"
  (`bot_message_requests.hiddenAt`).
- The list reads `tasks.awaitingReplies` when the chat's turn or newest message changes and
  every 30 seconds only while something is still owed. It never asks a model.

## Team awareness

- `list_agents` (read-only, every Mico): the other Micos of the owner in the Space with name,
  title, description (300 characters), status (working, queued, ready), queued messages, when
  the current turn started, whether it waits on the person, last activity and open waits.
- `interrupt_agent {bot_id, reason}` stops a teammate's turns that work on this Mico's own
  messages (a `message_bot` it sent, or its part of a `send_to_group` request), through the
  same durable Stop as the person's (cancellation, dropped steering, work-stop outbox,
  recipient settlement). Turns the person, a routine or another Mico started are refused:
  only the person stops them. The teammate's chat gets an update saying who stopped it and
  why, without a turn; answers already sent stay.
- The teammate directory asks a Mico to call `list_agents` before browsing or asking the
  person to sign in, to match work to titles and descriptions, to write self-contained briefs
  and never to hand work back to the teammate that gave it.

## Groups

- `chat_groups.purpose` (500 characters) and `chat_groups.leadBotId` (a member; `SET NULL`
  when that Mico is deleted). Both are set when the group is created and edited in Group
  settings. Naming a non-member as lead is refused; removing the lead from the group gives
  the role back to the first member.
- Routing never asks a model: mention chips, `@everyone`, `@Name` and a message that opens with
  a member's name ("Ana, …") wake those members; anything else goes to the lead. The lead's
  turn is told it takes unaddressed messages and hands off visibly with `handoff_to_bot`, so
  the person can correct the choice. Every member reads the purpose as data.
- A member's history leaves out other members' replies to the same message (runs with the same
  `sourceMessageId`), so it answers from its own view; later turns see everything. History
  tools still work in groups.
- A short "continue", "keep going", "sigue"… with nobody named continues the members whose
  latest turn for the newest request was stopped (failed ones only when none was stopped),
  repeating that request and asking them not to start over. Otherwise it is an ordinary
  message for the lead.
- `send_to_group {group_id, message, bot_ids?}` from a member's own chat posts the brief as a
  visible handoff in the group to the members it names, or to the lead, and opens a request.
  Each member's final answer (or failure) comes back to the sender's main chat, together when
  several work on it. It is not offered inside a group.
- "Send to group" on a message of a Mico chat opens the chosen group with that text in its
  composer; attachments stay behind.
- The existing limit of 24 tasks per request stays; groups add no per-group limits.

## Verification

`node --import tsx scripts/verify-mico-requests-db.ts` on a disposable loopback PostgreSQL
cluster: the migration applies on the published schema without drift, group lead and purpose,
lead routing, hidden peer replies, continue, held and released answers, Stop and reconciler
settlement, `send_to_group`, `interrupt_agent` and `list_agents`. Unit tests: adapters and core
bot-messages, group-mentions, message-visibility, thread-target, AwaitingReplies,
CollaborationMarker, message-view, GroupPanel and SendToGroup.
