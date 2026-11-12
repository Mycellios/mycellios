# Agent Desktop local project execution

Scope: local Desktop qualification; no public deployment or inference on this PC.
The real-account flow uses only the existing first-party hosted API and native
outbound relay. Isolated transport tests do not use production credentials.

Reuse the authenticated native host transport and existing shell/file tools. Native folder
selection assigns an existing project to one local bot. Selection must not be exposed as
a remote path-grant endpoint. The model receives the selected path as data; standard file
tools retain their existing path checks. Shell commands run with the OS user's permissions,
not an OS sandbox. Preserve explicit local-computer consent and revocation.

Any development API/worker must use an isolated database and local service endpoints.
Never run a development worker against the production-preview API or production database.
The hosted preview alone is not proof of native local execution.

Acceptance: native project selection, actual file modification through the host transport,
a real child-process test with observed exit status, a loopback preview, cancellation and
project isolation. Deterministic tool tests do not establish a model-generated workflow.
Record native UI and model-path checks separately from transport tests.

## Native workspace entry

The first-party Desktop can connect an owned Mico to its existing, private native
workspace without the OS folder chooser. It uses the same explicit local consent,
account/Space checks, outbound relay and dedicated computer assignment. Manual
project selection remains optional and native-only. Browser sessions gain no local
access. Retain command cancellation, expiry, revocation and uncertain-delivery
guards; connecting is not permission to scan the disk or run inference on PC-DANI.

Native project availability advertises the configured Desktop main frame and
initialized local host, independently of consent or a remote identity probe.
Hiding the entry on an authentication/network failure prevents reconnection.
Access/connect actions still authenticate and enforce the grant before any
file or command operation.

OpenCode is a behavioral reference: work in a local directory, with explicit
permissions for external operations (https://opencode.ai/docs/permissions/).
This change does not replace the execution provider with OpenCode or claim full
parity with its command permission parser. Validate model-driven changes separately
from transport/component tests, on a disposable example project only.

## Automatic workspace reference

OpenBot's official workspace documentation and current workspace-path/access
implementation were inspected on 2 November 2026:
https://openbot.run/news/every-agent-gets-a-workspace and
https://github.com/nightly-labs/openbot/blob/main/src/backend/agent/workspace-sandbox.ts.
Use these as behavioral references, not copied implementation. A persistent
per-agent working directory is automatic; access to other paths is a separate
policy. Mycellios already provisions its native per-agent workspace without a
folder picker. The existing shell accepts a cwd under the host's configured
roots and uses the OS user's permissions; file-tool relative paths remain
contained. Do not add a remote path-grant endpoint to reproduce shell behavior
that already exists. Native folder selection remains an optional project mount.

Installed acceptance must separately prove an unselected automatic workspace,
a command against an explicitly requested existing project, observed exit codes,
and frontend preview readiness. A host transport check does not establish that
a model selected the right tools or made an edit.

## Relay recovery qualification (1 November 2026)

The native relay periodically reasserts existing bot/device/generation grants
under the same authenticated account and Space, so an API restart does not leave
a saved Desktop computer without a live route. Long transport outages abort
uncertain commands but preserve the approved binding for authenticated recovery;
explicit revocation and account/session changes still discard it. No operation
is replayed by reconnection. Local focused tests and incremental TypeScript pass;
installed acceptance and the exact local package receipt are recorded in
src/agent/outputs/local-access-recovery-20261101/ACCEPTANCE.md. Do not count
transport fixtures or historical Developer tests as a new successful chat run.

## Approval continuations

A saved human approval or takeover checkpoint continues its parent run without
replaying the first native start. Worker and native host derive a stable segment
identity from that opaque server checkpoint. The relay fences each segment once,
refuses overlapping starts, and retains the original account, Space, bot, run and
project bindings. Native segment receipts survive process recreation; legacy
initial-run receipts keep their original names. Neither a new session ID nor a
reconnection authorizes replay. Test initial start, approval continuation, repeated
continuation, process recreation and the actual HTTP native-host callback path
without paid inference or real external effects.
