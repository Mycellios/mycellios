### Fixed

- A Mico that controls a desktop computer can now run ordinary shell commands that read `$?`,
  `$#`, `$$` or `$!`. Before, the desktop-protection guard refused them as unresolved variables
  even though they only ever hold digits.

### Security

- The desktop-protection guard now refuses `killall5`, which ends the whole graphical session
  the same way `killall` does.
