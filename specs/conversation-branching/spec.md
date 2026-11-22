# Branch a conversation from a finished turn

A conversation with a Mico sometimes reaches a point worth exploring in two directions. "Branch
in new conversation" copies a finished turn, with everything before it, into a new
conversation of the same Mico. The original stays as it is; the branch continues on its own.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Where it is offered

- The message menu (More) of the last Mico message of each finished turn, in the Mico's main
  chat or one of its side conversations, offers "Branch in new conversation". A turn ends at
  the next message the person writes (not a reaction) or at a divider. Progress notes, peer
  receipts and live rows never carry it.
- Desktop and web only: phones (narrow layout), groups, development projects, floating chats
  and the draft tab do not offer it.
- While a turn runs in the conversation the item stays visible but disabled, explaining that
  branching waits until the turn ends. The server refuses as well ("This conversation is still
  working on a turn. Stop it or wait until the turn ends, then branch it.").

## What the server does (`development.branch`)

- Input: `botId`, optional `taskThreadId` (absent for the main chat), `messageId` and a client
  `requestId` (UUID). The new conversation's thread key is `mico-task:<botId>:branch:<requestId>`,
  unique per owner and Space, so a retry, or two racing requests with the same id, return the
  same branch (`replayed: true`) without copying again. Clients keep the id per message until
  a branch is made.
- Checks: the Mico belongs to the person and Space and is not archived; the source is its main
  chat or one of its side conversations (not a project or app conversation, not being
  deleted); no run that is not background work is active there; the message is a Mico message
  of that conversation and its run has ended.
- The copy ends where the message's run ends (its last message) and starts where that turn's
  context starts: after the last New chat divider before it (the current context start when
  the turn is in it). It takes the messages the source transcript shows (the API passes its
  own peer/background rule), without reactions and without queued messages still waiting,
  and keeps at most the newest 1,000.
- In one transaction, under the source thread's row lock (the lock sends take):
  - a new side conversation of the same Mico, owner and Space: `startedBy` branch,
    `branchedFromThreadId`/`branchedFromMessageId` (both SET NULL when the source goes),
    `titleSource` auto, read up to its last message (`lastReadSeq`, `unread` false);
  - the messages with new ids and sequence numbers 0..n-1, original authors and times, replies
    pointing at the copies (or none when the target was not copied), no run, and only the
    progress and partial-reply markers of their client nonce, renamed;
  - a system message with a `branch_origin` block (source thread, message, main-chat flag and
    the source title at that time) marking where the copy ends;
  - the compacted history summary, only when it ends inside the copy;
  - new artifact rows for the files the copied messages show, pointing at storage objects the
    API copied first (same Space, sealed under its key), with the client nonce
    `branch-copy:<branch>:<source artifact>`. Version lookups never build on such copies.
- Never copied: runs, tasks, usage, costs, external effects, events, reactions, pins, read
  marks, queued or steering messages, Tasks entries.
- Encrypted content is read through the Prisma client and written again through it, so it is
  sealed under the same Space key and bound to its new row and thread (the ciphertext of a
  source row would not open elsewhere).
- Files are copied before the transaction; copies that end up unused (a failure, or a retry
  that found the branch) are removed. Bytes the source had already lost stay missing in the
  copy too. At most 200 files and 1 GB per branch; beyond that the branch is refused.
- No conversation limit applies, and nothing is archived automatically.

## Title

- From a side conversation: "{title} #N", where N is one more than the highest number the
  family uses (the source counts as #1). A branch of a branch drops its own " #N" first, so
  "Trip budget #2" branches into "Trip budget #3". Long titles are cut before the number.
- From the main chat (or an untitled source): the first line of the person's last message in
  the copy, else "Branched conversation". Titles stay renamable like any conversation.

## The branch in the app

- The new tab opens right after the source tab (first when the source is the main chat), with
  its title at once, and becomes the open conversation.
- The divider "Branched from {source}" sits where the copy ends; it opens the source at that
  message (`?task=&m=`, or `?m=` for the main chat). It names the main chat, the source's
  current title, or "Branched from a deleted conversation" once the source is gone
  (`development.list` returns `branchedFromThreadId`, null after the source was removed).
- A branch is an ordinary conversation of the person: rename, archive and delete as usual. The
  Mico's task tools (message_task, close_task) do not act on it.

## The Mico's first turn

- The first turn of a branch receives, with its instructions, a short note in our own words:
  the earlier messages were copied from another conversation up to the branch point, the two
  continue separately, and files in the workspace were not rolled back, so it reads a file
  again before relying on it or changing it. The copied messages are its history (Pi reads
  them as history; native engines receive them as the historical conversation of a new
  session). The divider itself reads as a one-line marker in history.

## Deleting

- Deleting the source never deletes a branch: the branch keeps its messages and its own copies
  of the files; its link to the source clears.
- Deleting a branch removes, after the usual undo window, the files copied into it (and any
  Mico output made only there) unless another conversation shows them.

## Verification

- `node --import tsx scripts/verify-conversation-branch-db.ts`: disposable loopback PostgreSQL
  with content encryption on and a local artifact store. Covers copy contents and order, what
  is never copied, artifact copies and version lookups, encryption at rest and search tokens,
  idempotency and racing retries, refusals (running turn, person's message, other person,
  Space or Mico), titles, compacted summaries, no conversation limit, New chat boundaries, and
  deleting the source or the branch.
- Unit tests: core conversation-branch, web conversation-branch, message-view, MicoTaskTabs,
  API development-conversations.
- `node scripts/verify-mico-tasks-ui.mjs`: the branch action, the disabled state while
  working, the new tab after its source and the divider linking back, at desktop width, light
  and dark.
