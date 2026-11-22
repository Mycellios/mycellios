### Added

- A Mico can look through all of its conversations: in its main chat or a side
  conversation, search_history without a query lists the main chat and the side
  conversations (archived ones too) with their state and latest request and reply,
  and a search covers this conversation, the main chat and the newest side
  conversations, naming the conversation of each match. read_history reads any of
  them by its taskId.
- A Mico can pin a message in its own conversation for you, for example a final
  draft. Its pins show "Pinned by" with its name, count toward the 100 pins of a
  conversation, and you can unpin them.
- The pinned messages list can show the pins of all of a Mico's conversations.
  Opening one from another conversation opens that conversation, restoring it if
  it was archived, and jumps to the message.
- Each chat has a "Search messages" box that jumps between matches with Previous
  and Next.
- Sidebar search also finds messages in a Mico's side conversations and opens the
  right conversation, and its results can be narrowed to Messages, Micos, Groups,
  Files or Routines.

### Self-host upgrade notes

- Apply the additive migration `20261122200000_message_pin_authors` before starting
  this version. It adds a nullable `pinnedByBotId` column and two indexes to
  `message_pins`; existing pins stay your own pins.
