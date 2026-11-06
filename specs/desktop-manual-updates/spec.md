# Integrated manual Desktop updates

Windows manual releases are selected by an explicit check against the official
HTTPS download catalog. Verified newer packages may download in the background; unattended installation stays off. An explicit
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


## Explicit restart with active work

A waiting update offers Restart now. It bypasses waiting for native tasks to end,
while retaining the current-frame persistence acknowledgement. Calls, uploads,
unsent submissions and unsaved forms remain protected; no settings are silently
written or discarded. The native owner alone selects the verified installer.

Before quitting, freeze admission and publish framed update interruptions for the
owned in-flight relay operations. The worker checkpoints the same fenced Run,
records unresolved calls as unacknowledged results rather than replaying them,
and queues its continuation. Real native commands settle their durable receipts;
critical file writes finish before exit. Cloud-only work keeps running.

A private, version-bound two-hour continuity receipt may retain the existing
relay generation only after fresh server/account/Space/session authentication and
remembered consent. It contains no credentials and never restores revoked access.
After restart, inspect durable command receipts before further mutation; uncertain
commands remain blocked instead of being rerun. Worker shutdown similarly queues
checkpointed work. Preserve user cancellation, pauses, execution fences and
idempotency. Qualify the loopback native interruption/reconnection and executor
checkpoint continuation, plus real Windows ownership and renderer draft guards.
