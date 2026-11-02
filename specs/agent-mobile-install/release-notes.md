# Post-update release notes

The signed-in shared sidebar owns a branded release-notes dialog, with a short
curated list under New and Improved, its date/calendar version, a close control
and Got it. The account menu can reopen it. English and Spanish are supported.

Observe only the loaded CLIENT_BUILD. A prior browser-local build or the existing
guarded update attempt can establish an upgrade. First visits, development builds,
malformed markers, not-yet-loaded targets and rollbacks do not auto-open it.
Acknowledgement applies to the curated notes edition, so unrelated hotfix builds
do not repeat the same announcement. Storage failure must not break startup.

Delay automatic presentation while another dialog, call or recording is active.
Acknowledging manually during that delay also cancels the delayed presentation.
This does not cancel, resume or replay any task or tool. The bounded dialog keeps
its reading area scrollable and its acknowledgement reachable on small screens.

Qualification: 42 focused tests, scoped incremental TypeScript, lint (one style
information), a local production build and 12 browser cases across 320x480,
390x800 and 1280x900, English/Spanish and light/dark. Evidence lives under
`src/agent/outputs/release-notes-20261102/`. The calendar version describes the
frontend notes edition; it is not an invented native-installer semantic version.

Published frontend build `20261102062726`, release
`5c6663aaf7a50e2f125ee01fb992b85e85a85542fbf277a0db32fdbf66aceb48`,
based on synchronized main `2e7e9205438ccf53e4bcc990afc7ae920b587c73`.
Private qualification and public checks passed for readiness, 14 entry assets,
authentication discovery, protected RPCs and retained legacy assets. Protected
API/worker/inference containers remain identical. No commit/push, account
mutation or native installer publication was performed.
