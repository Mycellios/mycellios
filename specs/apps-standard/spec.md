# Mycellios Apps standard v1

Normative status: local authoring/admission standard. The delivered code validates
definitions and bundles. The catalog, renderer, publisher, execution dispatcher,
project store and billing adapter are future integrations, not implemented Apps
capabilities. Action contracts are specifications, not executable handlers.

## Package and identity

An App is `app.json` plus declared bundled resources, using `mycellios.app/1`.
The authoritative strict schema and semantic validator live in
`src/agent/packages/contracts/src/app-{manifest,validation}.ts`; action contracts
live in `app-actions.ts`. All unknown keys are rejected, including nested ones.
The complete starter and guide are under
`src/agent/skills/create-mycellios-app`. No personal conversation or environment
file is an implicit dependency. Source code and third-party material require
their own authorized provenance; the validator is not a license auditor.

App IDs use reverse-domain notation. Versions use three nonnegative numeric
parts, without prereleases in v1. The author name and requested visibility are
display metadata, never claims of ownership or publication authority.

The publisher MUST freeze canonical manifest JSON plus every referenced resource
byte. The canonical manifest SHA-256 includes declared resource digests; sorted
object keys are order-independent and array order is preserved. Each published
ID/version is immutable. Changing bytes requires a higher version. The CLI's
`--previous` compares one prior bundle; the future publisher MUST additionally
enforce unique ID/version and monotonic versions transactionally against its
authoritative registry, never a client-supplied previous file.

## Interface and flow

V1 components: plain text, typed fields, step status, artifact/text results and
artifact reviews. No custom HTML, scripts, iframes, expressions, inline handlers,
remote code URLs, embedded login or arbitrary shell commands are admitted.
Different Apps may compose different screens; one published version has the same
structure for all users. Creative/model outputs are not deterministic guarantees.

Inputs declare types and bounds. References must exist and match action input
types; audio cannot be supplied by an image output. Every input and review is
visible. A workflow is a bounded DAG with one entry and AND dependencies. Loops,
conditions, optional task bindings and automatic effect retries are not in v1.
Independent ready steps may run only within the declared parallelism bound.

Unknown actions and components fail closed. Adding a trusted action requires a
reviewed contract version, typed payloads, capability mapping, an immutable
implementation and target qualification. Breaking interface/runtime changes
require a new protocol version. Authors must not bypass an unsupported feature
by embedding code or inventing a handler that the host cannot resolve.

An approval belongs to the authenticated reviewer, project, frozen definition,
source revision and artifact digest. The host MUST verify it server-side. Agents
and manifest fields cannot manufacture approval. Source changes invalidate the
affected downstream results and reviews. Ordinary account/PC access remains
independent of creative approval and reuses valid standing grants.

## Session, permissions and execution

Apps use the current Mycellios session; there is no per-App login. The host MUST
derive the user/Space/project scope from its authenticated server context on every
request, including artifact reads and live events. Public visibility shares a
definition, not projects, secrets, creator credentials or creator PC access.
Only an authorized owner/editor changes drafts or publishes versions; platform
administration moderates the catalog. Ordinary users edit only their own inputs.

Action names/versions and their required capabilities are fixed by this standard.
Only used capabilities may be requested. The executor MUST resolve an admitted
contract to a trusted immutable implementation and validate actual input/output
payloads, quotas and account-owned connections. Tool availability, authorization
and installed implementation digests are independently rechecked at execution.
Bundled instructions cannot override these controls. The definition validator
does not detect all malicious natural-language instructions or sandbox programs.

Local and Cloud use the same definition and typed action boundary. The selected
host MUST satisfy runtime protocol, tool implementation, OS/device/resource
requirements and current grants. A declaration of both targets proves neither.
Each advertised target needs separate real qualification evidence tied to the
app digest and implementation digests before publication. No source/source-label
comparison or simulated fixture substitutes for those receipts.

Missing executors wait. Cloud fallback and transfer of local artifacts require
the user's configured consent; existing authorization may be reused. Never move
an uncertain/running operation to a second machine. Destination changes occur
before an unstarted step or from a verified portable checkpoint. Fully offline
operation and automatic fallback are not promised by this standard's v1.

## Durable state and accounting

The catalog stores definitions and version references; projects store typed inputs,
decisions and step state in authenticated user/Space scope. Large outputs live in
private artifact storage or on the approved local host, referenced by ID/digest.
No client-supplied disk path or public URL is an ownership grant. VM temporary
disks are not durable project storage. Credentials stay in the existing secret
system; job messages contain scoped references, not credentials.

Every run records app ID/version/digest, project and owner scope, source revision,
execution target, implementation versions/digests, input snapshot, operation IDs,
artifact references, usage and timestamps. Persist these before acknowledging
dispatch. Resume observes existing operations before attempting new ones.

Mandatory step states and allowed transitions:

| State | Allowed next states |
| --- | --- |
| pending | ready, cancelled |
| ready | running, waiting-user, waiting-resources, cancelled |
| waiting-user | ready, cancelled |
| waiting-resources | ready, cancelled |
| running | completed, failed, uncertain, cancellation-requested |
| cancellation-requested | cancelled, completed, failed, uncertain |
| uncertain | completed, failed, cancelled, uncertain |
| completed / cancelled | terminal |
| failed | ready after explicit reconciliation and retry authorization, cancelled |

State writes MUST use an expected revision and fenced operation/attempt identity;
only one worker may claim a step. `completed` requires validated persisted output.
A lost observer yields `uncertain`, not success or automatic retry. Cancellation
requests are not confirmed cancellation. Reconciliation records evidence from the
original operation; it cannot invent an exit or promise universal exactly-once
side effects. Stop prevents new dispatch and requests cancellation of owned work.

Credits are represented in integer microunits (1 Credit = 1,000,000 microunits).
An authorized quote/reservation is required before paid dispatch, bounded by the
run budget. Separate actual model tokens, Cloud CPU/GPU usage and any configured
storage/app fee. Local compute does not prove remote models are free. Unknown
usage stays pending; never invent zero usage or reuse tokens as compute time.
Ledger posting MUST be idempotent per usage receipt/operation and reconcile
uncertain consumption before releasing reserves or retrying. The validator does
not quote, reserve or charge money.

## Lifecycle and updates

Create draft, define flow, build bundle, validate, qualify advertised executors,
then publish through the authorized host. Record the evidence and limitations.
Checks of structure, resource hashes, execution, artistic quality, licensing and
publication are separate results. Editing a published package is never allowed.

V1 existing projects remain pinned. New versions start new projects, with their
own permissions and budgets. Preserve old packages needed by old projects.
In-place migrations require a future versioned migration protocol; v1 must not
silently rename/drop fields, expand permissions, mutate approvals or replace an
active run's instructions. Unpublishing hides discovery, not historical evidence.

## Local validation

Use the shared scheduler on Daniel's PC for commands in the
[authoring guide](../../src/agent/skills/create-mycellios-app/references/guide.md).
The CLI verifies strict structure, known components/actions, graph/type/permission
references, portable contained file paths, bounded files, SHA-256 and optionally
version immutability. `--schema` exports structural JSON Schema only; refinements
still require the full validator. Validation is read-only and executes no App.
Registry APIs must call the same validation against a frozen server-owned snapshot.
