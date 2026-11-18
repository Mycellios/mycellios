### Changed

- Micos answer in short chat messages: the result first, in about 60 words, without run
  numbers, hashes or logs unless you ask for them.
- In the natural response style, a chat turn shows the Mico's short notes between steps,
  one folded steps line and then the complete answer, instead of an answer that grows
  while it streams. Repeated or empty notes no longer appear, and progress notes on long
  tasks have no message actions. Classic keeps the earlier view.
- A Mico that delegates work tells you the outcome in its own words instead of forwarding
  the other Mico's report. Delegated work answers with a short status, result and evidence.
- Several messages in a row between Micos fold into one "N messages with …" line.
- A Mico's task list shows as a folded "{done} of {total} tasks done" line above its answer.
- Notifications show the first whole sentences of a reply, and unfinished tasks or short
  readable errors get a clear message instead of a generic error.
- A finished reply over 20,000 characters shows its beginning with "Show full message".

### Added

- With "Show a plan before long tasks" on, a Mico shows its plan in a card with Start and
  Cancel before a long task. Without an answer it starts by itself after 10 seconds; the
  setting can change the wait (5 to 60 seconds) or make it always wait for you.
- While a Mico works, its task list stays open and updates with each step.
