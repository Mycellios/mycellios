# Project browser beside the chat

Extend the existing review workspace with a native Desktop browser for any HTTP(S)
project URL, tabs, navigation and element selection. User comments and a selected
element screenshot become an editable chat draft, never an implicit send. Keep
uploaded document previews, the web cooperative-frame fallback, project folder
selection and existing local-computer consent. Remove the Mycellios-specific
development settings action, native shortcut and automatic managed-copy admission.

Untrusted page contents receive no application bridge, account cookies, native
credentials or local-file privileges. Use a sandboxed WebContentsView and an
isolated inspector preload; do not disable TLS or site framing restrictions, or
proxy arbitrary sites. Restrict preview IPC to the configured app's main frame,
the current chat/Space and a bounded viewport. Bind selections and screenshots to
the exact view/navigation generation; discard stale asynchronous results. Close
native views when their owner navigates, changes account/Space/chat, or closes.
Routine cookie refreshes must not reset the browser. Account and Space context
comes only from bounded non-secret metadata in the trusted application.

Use the existing resizable right panel and design tokens. Keep address/navigation
controls and comment form outside the native content rectangle. Hide native
content beneath application dialogs/menus. Without native capability, retain
embedded pages that opt in to selection and show their actual limitations.
Selection consumes the click without activating page controls, including when an
iframe inside a modal is selected as a container. Recheck selection generation
and owner context after asynchronous screenshot capture. Preserve the comment,
selection and capture when the composer refuses an attachment, so retry remains
possible after closing and reopening the panel.

Qualify focused native/selection/preload and draft/UI tests, incremental types,
native/web builds, an actual local browser/selection/capture fixture and narrow
layout checks. Distinguish fixtures, installed acceptance and public release.

## Project Play/Stop

The Browser toolbar owns native project Play/Stop, optional named profiles and
service logs. The first Play connects the current owned agent through the existing
local-computer consent/relay, then submits one auxiliary `project_prepare` task to
the same agent/computer/thread with an owner/Space/agent-scoped idempotency nonce.
It creates no synthetic user message and does not use normal chat sending or
steering. It does not send composer attachments or drafts.
The agent inspects the current project and prepares portable `.mycellios/run.json`;
the native-owned prompt supplies a machine-local, account/Space/agent-scoped
binding location outside portable workspaces. No folder picker is required.
No new HTTP path-grant endpoint or model engine is introduced.

The native manager validates bounded profiles, service dependency graphs, cwd
containment and credential-free loopback readiness URLs. It starts foreground
services in dependency order with the existing OS process-tree primitive and a
minimal host environment, preserving secrets outside portable configuration.
Stop cancels pending auto-start, the exact owned auxiliary run and only owned
process trees. A failed auxiliary cancellation remains retryable without starting
another preparation. Partial
startup, service exit, app shutdown and access revocation clean up owned children.
An occupied external endpoint is refused and never adopted or terminated. A
project already running in another chat cannot start a duplicate set of services.

Only a Play intent may consume its matching preparation receipt and auto-start;
late configuration after Stop cannot revive it. Ordinary subsequent Play uses
the saved configuration without another model call. A failed/finished preparation
without configuration shows an actionable error; a native deadline bounds a lost
preparation. Prepared URLs enter the existing adjacent review workspace, never
the system browser. Browser pages still have no application bridge or credentials.
Services keep running when the preview panel closes. Hosted/mobile clients without
the native runner retain ordinary URL browsing and do not advertise local controls.

Qualification includes real Windows child processes, three-service ordering,
external-listener preservation, partial failure cleanup, cancellation races,
an anonymous real Electron IPC/browser fixture and actual React controls at narrow
and desktop widths. A fixture preparation is not a real model-generated setup.

Auxiliary steps, narration and final text stay out of normal transcript pages,
live chat events, sidebar activity and later conversational history. The Browser
shows a compact preparation state and folded bounded result details. Required
asks, approvals and takeover cards retain the existing explicit input flow.
Status/cancel procedures admit only the owned bot/thread/Space/user and exact
`project_prepare` run. The trigger uses the existing String column; no migration
is required. Roll out worker support before API creation and clients. An older
server must surface an error without silently reverting to a normal chat send.

Initial native status polling cannot cancel Play during its access/connection
handshake. The packaged native host must expose the automatic workspace accessor
used by the runner; preserving the underlying server accessor alone is insufficient.
Qualification must exercise the installed wrapper and actual Play, in addition to
source fixtures, without copying session credentials.

Transient observation timeouts retain the pending Play intent; Stop and access
revocation cancel it. Native startup records its original refusal and aborts its
controller before cleaning up owned trees, preventing cleanup exit codes from
masking the cause. Independent native bundles use anonymous Windows Job types.
Identity reads allow one retry only for TimeoutError; access refusals and changed
owners still revoke immediately. Effectful operations are never replayed.

The Mycellios source preview profile runs backend then Vite. The backend owns
embedded PostgreSQL, normal API authentication/data routes and a local worker
inside the same foreground tree. Readiness includes the database-backed API
probe and a new worker heartbeat. Local data and keys persist under ignored
data/project-preview across Stop/Play. The preview's minimal environment and
RAKAZO_PROJECT_LOCAL block checkout dotenv loading and inherited production
databases, SSO, telemetry and model credentials. Vite proxies only to the local
API and retains hot reload. Users register local accounts normally; there is no
authentication bypass or transfer of the stable application's sessions.
