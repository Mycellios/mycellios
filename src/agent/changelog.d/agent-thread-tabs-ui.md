### Added

- Each conversation tab of a Mico now has a menu to open it, close it, close the other tabs or the
  tabs to its right, rename it, archive it and delete it. Archive stops the conversation first.
  Delete hides it at once and offers Undo for a few seconds; it waits while the conversation still
  works, and on a phone it asks first.
- Conversation tabs and the Conversations list show whether a conversation is working, waiting in
  line, waiting for you, failed or has a new reply. The list puts the most recently active
  conversations first with their time, and the Conversations button shows a dot when a reply
  arrives in a conversation without a visible tab.
- Keyboard and mouse shortcuts for conversation tabs: Delete or Backspace and a middle click close
  a tab, F2 or a double click renames it, Alt+Shift+Left/Right moves it, Ctrl/Cmd+Shift+O starts a
  new conversation and Alt+Shift+Down/Up go to the next or previous conversation. Tabs can also be
  dragged into a new order, which is kept on this device.
- A conversation that a Mico opens by itself appears as a new tab at the end, without leaving the
  conversation you are in, and says that the Mico opened it. You can rename or delete it like
  your own.
- "New conversation" in a Mico's menu in the sidebar, and conversations of the same Mico can be
  mentioned with @ in a message, which then shows a button to open them.
- A conversation whose last turn failed shows the error until its next turn.

### Changed

- The + button now opens a draft tab. The conversation is created when you send its first message,
  so closing the draft leaves nothing behind, and its unsent text is kept per Mico, also after a
  reload. Before, + created an empty conversation at once.
- Choosing an archived conversation in the Conversations list restores it and opens its tab, and a
  tab closes when its conversation is archived or deleted on another device, coming back when it
  is restored.
- When the header is narrow, the conversation tabs become a switcher with the current title, and
  only the list button when it is very narrow. The Conversations button is hidden while a Mico has
  no conversations.
- Older messages of a conversation now load by themselves when you scroll near the top, keeping
  your place.
