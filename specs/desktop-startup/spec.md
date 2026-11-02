# Desktop startup

Normal installations open the hosted Mycellios Agent and its existing same-window
account login. They do not ask users to choose or install a server. Valid explicit
self-hosted preferences remain supported. An unusable preference falls back to the
owned hosted entry without rewriting or deleting the old file.

Startup connection failures use a small, light recovery screen with Retry and
Close. Server configuration stays in a closed Advanced disclosure. Native IPC owns
the failed target and serializes attempts; the recovery page cannot supply a URL.
Retry does not create a local stack, modify setup, clear sessions or replay tasks.
Advanced server switches retain their validation, persistence and rollback path.

Qualification covers affected unit tests, incremental native types, real Electron
fixtures for first launch, offline recovery/repeated retry/close and recovery to a
ready document, plus the installed account reopening with its profile preserved.
Native package/installer publication and platform evidence are recorded separately
in STATUS_AND_EVIDENCE.md; prepared files are not a published installer.

The recovery page hides its duplicate Quit action on Windows, reserves the
138-pixel native caption area and retains the platform controls on macOS/Linux.
Its native-owned failure explanation stays inside Advanced, updated after a
failed retry; no arbitrary renderer URL or raw exception is accepted.
