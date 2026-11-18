### Added

- Hifa Store app owners can let their app save each visitor's own data (for example
  a project's settings) in their account. The app never sees who the visitor is,
  each person only sees their own data, and the app's card shows that it can save.
- Hifa Store app owners can let their app download the files it creates, such as an
  exported video. Apps without this permission still cannot download anything.
- The app editor keeps the last 50 versions of each draft, including your Mico's
  edits, under "Historial de versiones". Restoring one makes it a new draft version
  and never changes the published app.

### Changed

- Hifa Store apps can play video and audio that they include or create in the
  browser. Before, any video in an app stayed blank.

### Self-host upgrade notes

- Apply the database migrations `20261118170000_hosted_web_data` and
  `20261118190000_hosted_web_snapshots` before starting this version.
