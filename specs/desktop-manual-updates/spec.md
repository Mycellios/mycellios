# Integrated manual Desktop updates

Windows manual releases are selected by an explicit check against the official
HTTPS download catalog. Automatic download/install remains off. An explicit
install waits for local work, renderer sends/uploads/calls and unsaved forms;
saved text drafts are retained in the existing profile, never sent implicitly.

The native host selects the platform, URL, exact version, byte size and SHA-256.
Renderers cannot provide installer paths or commands. Reject other origins,
redirects, unsafe paths, downgrades, altered payloads and unbounded responses.
Recheck the installer immediately before handoff.

At a safe moment freeze the window, pause native admission, flush its session,
and launch a detached same-user helper. Quit normally. The helper waits for the
exact old process to exit, backs up installation/session state, executes the
verified installer and reopens the same profile. Never force-kill, clear data,
revoke consent, terminate other apps or modify production. Keep a recoverable
backup and an actionable failure receipt. A pending restart is cancellable.

Qualification covers catalog/payload rejection, serialization, pending-work and
renderer acknowledgement fences, helper shutdown/extraction and persisted drafts.
The published 0.3.15 installer stays immutable. Local qualification may apply the
new host/UI to that base, recording its source commit separately.
