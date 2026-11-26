### Fixed

- A message that waits while its Mico is busy in another conversation now starts as soon as
  that conversation finishes. Before, it could wait up to 30 more seconds.
- A waiting message names the conversation it waits for, such as "Waiting for “Daily scout”
  to finish", instead of only "Queued".
- Opening a conversation shows its messages and starts receiving the reply sooner: status
  reads for the header, rail and composer menus now wait until the messages load.
