### Added

- Messages that wait while a Mico works now show in a "Waiting to send" panel that
  says why they wait: the current turn, a full set of conversation slots, a restart,
  a usage limit or a needed sign-in, or an edit in progress.
- Each waiting message can be sent into the running turn (Steer now), sent next by
  stopping the current turn (Send now), edited, deleted, reordered by dragging or with
  the arrow keys, or moved to a new conversation of the Mico with the +. A message
  being edited holds the queue until you save or cancel, also after a reload or on
  another device.
- A turn that waits for its own background commands shows "Waiting for background
  work…" with a timer.

### Changed

- A Mico's main chat no longer counts toward its limit of tasks at once, so it never
  waits behind side conversations; side conversations past the limit wait for a free
  slot. Native engines still run one turn at a time.
- A message sent into a running turn reaches the Mico with a short note that it adds
  to the current work, and Codex, Claude Code and ACP Micos now receive it after their
  next tool step instead of only after the turn. A running shell command moves to the
  background instead of holding the message back.
- After a turn fails on a usage limit or a needed sign-in, the queued messages wait
  for you instead of failing one after another.

### Self-host upgrade notes

- Apply the additive migration `20261123090000_message_queue_controls` before starting
  this version. It adds the nullable `position`, `heldBy`, `heldAt` and `editDraft`
  columns to `steering_messages` and gives messages that already wait their current
  order.
