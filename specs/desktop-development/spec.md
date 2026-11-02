# Managed local development environment

Superseded by [Project browser beside the chat](../project-browser/spec.md).
The active application no longer exposes the development settings action,
File menu launcher or Ctrl+Shift+D, and ordinary execution no longer admits a
managed development copy automatically. Preserve existing copies and their edits.
The following records the earlier design and qualification, not the current flow.

Enabling development prepares a private, per-device editable source copy and its
own web tooling, then opens the existing Vite development window. There is no
manual folder-link flow or portable project registration. Source is seeded from
the packaged code resources (or the source checkout when running the project).
Closing/reopening development preserves edits; updating stable never overwrites
that copy. A different PC starts its own local copy. Stable remains usable.
The native File / Open development menu and Ctrl+Shift+D are available even
when the connected web release does not yet expose the settings button; both
entries use the same permission and native launch handlers.

The development window uses the configured server and existing real account.
Before individual chat work starts, client admission selects its dedicated
computer and connects it to the native-owned copy. Relative file tools and
command working directories resolve there, independently of model memory. A
failed admission prevents that request from being sent. Stable-window execution
is unchanged. Group-triggered development work is not qualified by this route;
use individual development chats. Existing host consent and tool approvals remain.
This is a local workspace boundary, not an OS sandbox.

The first launch downloads an isolated web toolchain through the bundled npm CLI
and Electron's Node runtime. Windows/Linux installer staging includes source and
npm/license resources, so a release must not rely on a developer's personal path.
Source copies omit Git metadata, secrets, installed dependencies, generated
outputs, caches, data and models. Normal native/backend builds and restarts are
still required for their code; Vite hot reload applies to the interface.

Qualification: isolated copies on two local test profiles, preserved edits on
reopen/source update, refusal to overwrite unrecognized folders, owned relay file
and command effects, current native frame/session checks, request admission,
source staging and packaged resource configuration, incremental types and builds.
Actual cold preparation and CSS HMR in the private copy are separate from an
installed real-account two-window check. Public releases and backend services are
not changed by local Desktop qualification.

Earlier local development-window acceptance (2026-11-01) verified two windows,
real-account recovery and UI HMR before this managed-copy revision. Keep that
historical result distinct from acceptance of the new automatic-copy workflow.
