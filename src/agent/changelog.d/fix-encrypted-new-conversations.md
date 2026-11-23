### Fixed

- A Mico can open its own side conversation again when message content is encrypted, and a queued
  message can be moved to a new conversation. Both failed in production because the first message
  was sealed before the new conversation's Space was known.
