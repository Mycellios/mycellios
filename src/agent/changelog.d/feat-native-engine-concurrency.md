### Added

- Codex, Claude Code and OpenCode Micos can work in several conversations at once, up to the
  Mico's conversation limit, and their main chat no longer waits behind those conversations.
  This stays off until the server's operator turns it on; until then these Micos still work on
  one conversation at a time, main chat included.
- Mycellios Desktop runs at most 6 agent engine turns (Codex, Claude Code or OpenCode) at once on
  your PC. Another turn waits, says so in its conversation, and starts when one of them finishes.

### Self-host upgrade notes

- Set `MYCELLIOS_NATIVE_CONCURRENCY=1` on the API and the worker to let Codex, Claude Code and
  OpenCode Micos run several conversations at once. Leave it unset to keep one turn at a time.
  A generic ACP agent always stays at one turn.
