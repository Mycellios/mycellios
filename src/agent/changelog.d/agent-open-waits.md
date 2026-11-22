### Added

- A conversation where a Mico waits for a routine result, a run or a time now shows
  an "Open waits" card: what each wait is for, when it times out, whether it is
  still waiting or already continuing, the note the Mico saved and the original
  request. "Cancel the wait" stops a wait that has not woken yet; a wait that
  already woke is never reported as cancelled. The Conversations list in the side
  panel marks conversations with an open wait.
- A Mico can list its open waits and close one it no longer needs, so that wait
  does not wake its request later.
- When a wait wakes in an archived conversation, the conversation comes back, and
  the continued turn gets the original request and the Mico's saved note again.

### Changed

- Archiving a conversation keeps a request that only waits for a routine result,
  a run or a time, so it can continue there later. Stop still cancels it.
- For a job that should end within about 15 minutes a Mico now checks it during
  the same turn at growing intervals, and for longer jobs it saves a wait instead
  of keeping the turn open.
