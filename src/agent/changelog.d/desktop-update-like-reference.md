### Fixed

- Windows updates install in about a minute. Mycellios now quits,
  installs and reopens without copying or scanning its files first: the installer already
  keeps the previous version and puts it back if anything fails, and never touches your data.
- On Windows, opening Mycellios while an update is still installing no longer breaks the
  update. The app now says the update is in progress and closes, and the installer reopens
  it when it finishes.
- On Mac, Restart to update now replaces the app and opens the new version by itself instead
  of leaving the disk image for you to drag. If the app cannot replace itself (for example
  without write access to Applications), it opens the disk image as before.
- Mycellios Desktop is smaller. The built-in local server no longer ships type definitions,
  TypeScript sources or test and build tools that it never runs.
- Pausing Generate AI always works. A failed update or settings command on the computer no
  longer leaves the control stuck on "Could not confirm contribution", and a click on a
  running contributor now sends a new pause instead of only checking again.
