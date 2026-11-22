### Changed

- On phones, the workspace menu opens beside the chat list with a short slide, leaving the
  list visible. Menus and conversation switches use brief transitions and respect reduced
  motion. Options that are not available yet say "Coming soon".
- On phones, the keyboard opens only when you tap a text field and closes when you do
  something else. Unsent drafts are kept. Send, attach and dictation keep the keyboard open.

### Fixed

- Typing in the message field on phones no longer lags: the draft is saved in the background
  instead of on every keystroke, and the field measures its height once per frame.
- Conversations open faster on phones: the next conversations are prepared before you pick
  them, even when only the current tab fits. A slow background read no longer holds up the
  others.
