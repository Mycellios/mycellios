# Route each Mico to the PC that holds it

## Problem

One account can keep several Desktops connected to the same Space. The relay
broker bound a Mico that no PC had connected explicitly only when exactly one
Desktop was online. With two PCs online such a Mico had no binding, the relay
probe answered "unavailable", and the worker read that as "the PC is offline":
it pinned a cloud workspace to the turn. A native-engine Mico (Codex, Claude
Code, OpenCode) then failed on the server with "not authorized to use the
server's native agents", although both PCs were online and the Mico's files sat
on one of them. Every API restart drops all bindings, so this recurred for
every Mico that nobody reconnected by hand.

## Decision

Desktop reports which Micos it holds. A Mico's folder name on the PC is the
SHA-256 of its bot id (`host-computer-server` `ref()`), so each Desktop sends
the hex keys of the Mico folders that exist on it (at most 256, visible
folders first) with its account registration. The broker binds a Mico that
has no binding to the single online PC whose report holds its key.

Rejected: remembering the last PC that bound each Mico. The broker is volatile,
so that memory disappears on every API restart — exactly when bindings must be
rebuilt — and a Mico that was never connected by hand has no last PC. A
persistent column would need a migration for a value only the PCs can know.
The report is rebuilt on every account poll, survives restarts and needs no
schema change.

## Rules

- One online PC in the scope keeps binding every Mico, as before.
- Several online PCs: bind to the only one that holds the Mico's folder. When
  none or more than one holds it, leave it unbound and report it unresolved.
  An explicit binding (sending from Desktop or choosing This PC binds the Mico
  to that PC) still wins and is never moved automatically.
- Probes add `unresolved: true` when the Mico has no binding while a PC of the
  scope is online. The worker never pins a cloud workspace for an unresolved
  Mico; Desktop execution fails the turn with a message asking the owner to
  send it a message from Desktop on the PC that should run it.
- The offline cloud workspace applies only when no PC of the scope can be
  reached for the Mico. A native-engine Mico gets one only when the server's
  native agents are granted to that user and Space (`nativeHostAccess`);
  otherwise it keeps the existing "Your Desktop is offline" message.
- Consent, owner/session/generation checks, run fences and the rule never to
  replay uncertain commands are unchanged. Nothing is rebound while a binding
  has open work.

## Compatibility

- The account response carries `ownership: 1`. Desktop sends `workspaces` only
  after it has seen that flag from the server, and stops sending it when an
  account poll is refused, so a new Desktop never trips the strict parser of an
  older API (including the old/new overlap during a deploy).
- Older Desktops (0.16, 0.17) send no report. They keep working; with two of
  them online an unbound Mico is reported unresolved instead of moving to the
  cloud.
- Older workers ignore `unresolved`; older APIs never send it.

## Limits

- A Mico held by both PCs (it ran on each at some point) or by neither (it has
  never run) stays unresolved until the owner sends it a message from Desktop on
  one of them. That binding is volatile, so it is needed again after an API
  restart while both PCs still hold the folder.
- Right after an API restart, the first PC to register is briefly the only one
  online and binds every Mico probed in that moment, as the single-PC rule
  requires.

## Verification

Broker (several PCs, ambiguity, holder binding, explicit choice, compatibility),
API probe/registration, Desktop relay client capability handling, Mico folder
listing, offline-cloud-workspace and DesktopAgentRuntime tests. Physical
two-PC acceptance with installed Desktops is separate from these fixtures.
