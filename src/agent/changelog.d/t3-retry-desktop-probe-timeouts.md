### Fixed

- A message for a Mico on your computer no longer fails with "The operation was aborted due to
  timeout" when the server is slow to check whether your PC is connected. Before, that check gave up
  after five seconds and the message, including replies from other Micos waiting to be delivered,
  was lost. Now the message waits and tries again, without moving to a server workspace, and if your
  PC still does not answer it ends saying so.
