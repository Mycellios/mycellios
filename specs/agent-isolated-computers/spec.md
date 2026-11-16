# An isolated server computer per Mico

## Existing behavior and goal

Reuse Computer records, provider lifecycle, per-user quotas, workspaces, screen
leases, takeover, approvals and recovery. Previously team meant a shared server
computer; dedicated meant This PC. Neither name can silently change its meaning.
New ordinary Micos need a separate server computer by default, independent of
another Mico and of a connected Desktop host.

## Contract and storage

- Add the explicit `isolated` ComputerMode/scope. Keep `team` and `dedicated`
  valid and preserve all existing assignments. An additive migration extends the
  historical database CHECK constraint; it does not rewrite or reassign rows.
- New API profiles/imports and ordinary UI creation default to isolated. Retain
  the existing explicit installed-account first-run route on Desktop/browser.
- Isolated scope/home keys bind account, Space and Mico. They must differ from
  Team, This PC and cloud-recovery keys and fit provider naming limits.
- Profile creation stores stopped metadata only, within the existing creation
  transaction and quota. Do not create an unused shared computer per new Mico.
- This is an additive client/API contract. Release matching clients and server
  together; older clients do not understand the new selection. This PR does not
  promote or deploy the contract.

## Isolation and permission boundaries

- Derive an internal isolation pin from the owned persisted Computer. Ignore
  connected Desktop availability for an isolated computer; reconnecting a PC
  must not redirect its provisioning, status, files or screen to that PC.
- Reuse private execution leases, fencing and owner/Space checks. Reject stale
  runs, cross-Mico operations, foreign actors, concurrent switching/control and
  unsupported local-project routing. Never fake a cloud-recovery worker lease.
- A desktop-only or unavailable provider cannot satisfy isolation. Expose the
  existing unavailable state without granting local access or inventing a VM.
- Keep approvals and explicit takeover/release. Opening settings or reading a
  preview must never provision, obtain consent, approve tools or start inference.
- Existing Team sharing and explicitly chosen This PC remain available. Stop or
  migrate an active computer only through the existing guarded lifecycle.
- Native CLI chat remains separate from its computer. A project that needs a
  local PC cannot bypass an isolated selection; require the explicit supported
  computer choice instead of silently using local files.

## User interface

Use the current shared controls: Just this Mico, Shared, This PC. Explain the
selected mode in plain English/Spanish. Reuse the existing live screen and
takeover UI. Keep mobile labels consistent and retain existing unavailable-PC
behavior. Do not claim the synthetic browser fixture is an operating system.

## Qualification

Run affected contracts, creation, provider routing, lifecycle, quota, ownership,
lease and UI tests through proportional remote CI. An isolated PostgreSQL fixture
uses real repos and records with two fake sandbox instances to verify distinct
keys, files, screen leases, cross-owner refusal and limits without paid resources.
The browser fixture renders actual settings controls and ComputerOverlay, blocks
external/unexpected RPC traffic, checks explicit takeover/release and blocked
runs, and captures desktop/mobile English/Spanish screenshots.

Full suites, paid provider allocation/inference, production changes and physical
Desktop/multi-host qualification remain outside this request. Record actual
container/browser-runtime evidence separately from fixture results.

The scoped Isolated Mico computers workflow builds the existing sandbox image
on a disposable Linux runner and runs the existing replay CLI with
`--isolated --output=isolated-docker-proof`. This offline-only mode creates two
owned containers with internal networks and real browser screens, checks private
files/processes/mounts and Desktop reconnect routing, and cleans up only its own
resources. Its PNGs/receipt are separate from synthetic UI screenshots. Paid
capture flags are rejected before credential or Docker setup. No cloud resources
or LLM calls are used by this qualification.
