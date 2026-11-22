# Side conversations in view: Conversations pane, sidebar and unread

A Mico's side conversations (the person's own, the ones the Mico opened, routine threads)
used to be visible only from its tab row. A long main chat then hides that one of them waits
for an answer or has a new reply. This slice makes every side conversation visible from the
main chat and the sidebar, and makes "unread" and "needs you" obvious.

The reference product is a behavior reference only (PolyForm Noncommercial). No code, prompt
or label is copied; every text here is written for Mycellios.

## Conversations pane

- Chat tools has a Conversations entry with the badge "Waiting for you: N" (open
  conversations whose state is `waiting`: a question, an approval or a takeover). The header
  tools button shows a small dot while one waits.
- The pane lists the draft (when its tab is open) and the open conversations, most recently
  active first, each with its ThreadStatusMark and a relative time. A row opens the
  conversation in the chat. Without conversations it says "No conversations yet" and offers
  New conversation.
- A row's toggle opens the conversation beside the chat, as a tab of the pane (at most six,
  per user/Space/Mico for this browser tab). The tab's menu has Open in the chat and Close.
  Closing the shown tab shows its right-hand neighbour, else the left one, else the list. A
  conversation opened in the chat, archived or deleted leaves the pane. Phones have no
  beside view: a row opens the conversation and closes the panel.
- The beside view reads its conversation through its own immutable client bound to that
  thread (head first, then the snapshot when the cursor moves, every 2.5 s while visible),
  marks it read once its messages loaded, answers its asks and sends with a client nonce kept
  for an uncertain send. It shares the draft key of that conversation's composer.

## Requests mirrored into the main chat

- `development.requests({botId})` lists, newest first and at most 20, the runs of the Mico's
  open conversations that wait for the person: `waiting_input` with its unanswered ask block
  (read through the Prisma client, so encrypted content is decrypted) or `waiting_takeover`.
  The Mico is checked against the owner and Space first. Kinds: question, approval, plan,
  secret, takeover.
- The main chat shows them after its messages as compact cards, read again when the roster
  says the Mico's conversations moved and every 5 s while any is shown. Questions, approvals
  and plans answer in place through `threads.answer` with that conversation's
  `taskThreadId`, using a client bound to it that read the conversation first: the same
  fenced operation the conversation itself uses. Credentials and takeovers only link to
  the conversation. Once answered anywhere, the card leaves everywhere.

## Sidebar

- Roster rows carry `unreadCount`: the Mico's replies after both the read cursor and the
  person's last message, without progress notes, at most 100 (shown "99+"). A row with unread
  replies only in its conversations shows a numberless ring badge ("New replies in
  conversations").
- Roster rows carry a `conversations` summary for open conversations (not archived, not
  being deleted, not a development project's session): open, unread, waiting, working
  (background work does not count) and a `revision` that moves with any event or message.
  One metadata query per roster read; a failed read leaves the roster as it was.
- One signal per row, most urgent first: main chat answer, main chat takeover, a conversation
  waits, error, working (main chat or a conversation), unread replies, replies only in
  conversations. While the main chat is idle the state line says "A conversation needs you"
  or "Working in a conversation…".
- A desktop Mico row with conversations expands ("Show conversations"; stored per device) into
  the conversations that need a look (working, waiting, failed, unread) and the 3 most recent
  others, with Show N more / Show less. The list is shared with the Mico's tabs and read again
  when `revision` moves. Resting 700 ms on such a row opens a card with the conversations
  already loaded (or the summary); a hover never reads a thread or marks anything read.
- "Needs you" sits at the top only while something waits: a main chat that asks (Answer, opens
  the question), a takeover (Take over) or conversations that wait (Review, opens the main chat
  with the mirrored cards). The chats also stay in their folders.
- The view menu next to Search filters by Micos, groups, unread, working and folders (choices in
  one list widen, lists narrow together; stale folders are ignored), says "No chats match these
  filters" with Clear filters, sorts by Manual, Recent activity, Group unread or Unread first,
  and offers Mark all as read. Filter and sort are per device. The default order (Manual) and
  grouping do not change; Recent activity sorts each folder by its latest chat and keeps pins
  in their manual order.

## Reading state

- `threads.markAllRead({botId?})` reads, in one statement, the Mico's main chat and open
  conversations, or every main chat, group and open conversation of the person in the Space.
  Archived and deleting conversations keep their state. The sidebar calls it once per Space
  with unread chats.
- A Mico's Mark as Read in the sidebar uses it; Mark as Unread (`threads.markUnread` without a
  message) moves the read cursor to just before the newest reply, so the count shows 1 and the
  next open puts New above it.
- In a chat, while the New divider is out of sight, a banner says "N new messages" with Jump
  and Mark as read (the divider goes and the chat is read).

## Verification

Unit tests for the pane, beside view, mirrored requests, sidebar list and hover card, menu,
banner, filter, pane state, Needs you, roster signal and order, the API routes and the DB
helpers; `node --import tsx scripts/verify-conversation-surfaces-db.ts` on a disposable
loopback PostgreSQL; `node scripts/verify-mico-tasks-ui.mjs` for the real components in a
browser with synthetic RPCs at desktop and phone widths, light and dark.
