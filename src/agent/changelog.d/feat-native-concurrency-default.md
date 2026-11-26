### Changed

- Codex, Claude Code and OpenCode Micos now work on several conversations at once, up to the
  Mico's conversation limit, and the main chat never waits behind side conversations. Before,
  each of these Micos answered one conversation at a time. Self-hosters can set
  `MYCELLIOS_NATIVE_CONCURRENCY=0` on the API and worker to keep the old behavior.
- Claude Code and Codex stay ready for 5 minutes after a reply instead of 30 seconds, so the
  next message in the same conversation starts faster.
