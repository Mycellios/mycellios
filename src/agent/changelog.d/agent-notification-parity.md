### Added

- Notifications say why work stopped: a message or routine that could not start,
  a helper or teammate that failed, a usage or credit limit, and a provider that
  needs you to sign in again. With previews off they still show only fixed text,
  never the Mico's name or the reply.
- Answering a question, approval or takeover on one device closes its
  notification on your other devices that get background web notifications or
  use the Android app. iPhone and iPad keep theirs until opened, because Apple
  requires every push to show an alert.
- Settings > Notifications has a "Replies in task conversations" switch for all
  your devices. It is on by default; turned off, a Mico's own task conversations
  stop alerting when they finish or fail, while questions, approvals and routines
  still alert.
- Both pause controls offer 15 minutes, 1, 3, 8 or 24 hours, or until you turn
  notifications back on.

### Changed

- A reply to another Mico's message or delegated task no longer plays a sound or
  sends a notification. It still counts as unread, and its questions, approvals
  and failures still alert.
- A group notifies once per request, when its last member finishes with unread
  replies, instead of once for every member.

### Fixed

- Muting the current server "Until I turn it back on" is saved instead of being
  rejected as longer than seven days.

### Self-host upgrade notes

- Apply the additive migration `20261122230000_notification_requests` before
  starting this version. It adds a nullable `sentAt` column to
  `web_push_deliveries` and a system-only `notification_requests` table; older
  services keep delivering notifications without them.
