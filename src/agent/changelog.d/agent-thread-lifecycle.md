### Added

- The server can now archive a Mico conversation from any device, restore it, and delete it with
  a 6-second Undo. A conversation is never deleted while it works, and the main chat can never be
  archived or deleted. Each conversation also reports whether it is working, waiting for you or
  finished, how its last turn ended and its last error.

### Changed

- Archiving a conversation in Tasks now stops it first and then archives it. Before, Tasks asked
  you to stop it yourself.
- Writing in an archived conversation from Tasks now brings it back with all its messages. Before,
  Tasks asked you to restore it first.
- A new conversation takes its title from the first line of your first message, up to 120
  characters. Before, it joined the whole message and stopped at 80 characters.
- A conversation title can have 1 to 120 characters on one line, and a title you set is never
  replaced by an automatic one.

### Self-host upgrade notes

- The `20261122120000_thread_lifecycle` migration adds nullable columns, checks and indexes to
  `threads` and copies the archive mark of each Tasks entry to its conversation. It changes no
  existing column, so the previous release keeps working if you roll back.
