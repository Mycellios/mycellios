### Fixed

- With two PCs connected to the same account, a Mico set to This PC now runs on the PC that holds
  its folder. Before, messages from other Micos or delegated work could run on the server instead,
  and a Mico using Codex, Claude Code or OpenCode failed with "not authorized to use the server's
  native agents" while both PCs were online. When neither PC or both hold the Mico's folder, the
  chat now asks you to send it a message from Mycellios Desktop on the PC that should run it.
- A Mico using Codex, Claude Code or OpenCode no longer moves to the server when its PC is offline
  and the server cannot run that agent for you. It shows that your Desktop is offline instead.
