### Fixed

- A message sent while Mycellios Desktop is quitting or installing an update no
  longer fails with "Desktop execution interrupted; check existing results before
  retrying". Desktop now tells the server it is going offline, so the message runs
  as it would with the PC offline. If the PC goes away before it receives a
  message, the message is tried again instead of being reported as possibly half
  done, and the chat says the PC is offline if it has not come back.
