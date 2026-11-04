# Agent integration authentication

## Objective

Keep the full managed integration catalog usable through the appropriate per-toolkit
authentication, rather than treating every toolkit as managed OAuth. Preserve existing
connections, identities and the independent Desktop window-control correction.

## Findings

- Current main and the recent continuity/admission PRs do not configure custom
  toolkit authentication.
- The adapter only creates default sessions. Custom auth configs must be supplied
  explicitly to the authorization session, including API-key templates.
- Twitter requires an operator-owned OAuth app. An account login/password is not
  the app's Client ID or Client Secret.
- API-key and other compatible templates can defer credentials to each user's
  Composio Connect Link. Never put a shared provider key into those templates.

## Implementation

- Resolve enabled, exact-toolkit custom configs for each explicit connection attempt.
  Pin a unique custom config; fail closed for ambiguous or disabled-only configs.
  Keep normal managed auth and genuine no-auth toolkits working.
- Translate missing operator setup through one generic client error code. Hide raw
  provider JSON, request identifiers and credentials on web/Desktop and mobile.
- Provide a dry-run operator CLI with bounded metadata reads and explicit `--apply`.
  Preserve existing and disabled configs. Create only managed templates or custom
  schemes with no missing operator fields. Never create accounts, execute tools,
  modify scopes/shared credentials or retry an uncertain POST.
- Publication is authorized. Build production only from the exact merged main
  revision after release checks pass; retain the live revision's intended changes.

## Qualification

Offline adapter, API transport, client-language, template-planning and credential
boundary tests cover the change. Local web build and root structure/architecture/
type checks supplement those tests. Real provider sign-in remains a separate,
user-driven acceptance check; template availability is not account connectivity.

The Fedora backport uses a transparent native caption background and keeps only
the theme-derived symbol color. Its existing local package work is preserved;
neither a new installer nor installed-window acceptance is implied by source tests.

## Production backend preservation

The live API/worker contain an earlier unpublished Mico task-conversation overlay.
Recover the sealed source entries, verify their hashes, and integrate the runtime
changes against their recorded main base while retaining current main fixes.
Preserve owned independent task threads, local task/worktree admission, command
observations and the already-applied migration. Keep its original bytes and checksum;
this release must not reapply or reverse that migration. Native-only unpublished
project UI/bridge declarations remain in the private source snapshot and are outside
this server release.

Qualify the combined sources and build only from the merged main revision. The
source snapshot, service identities and operator project binding remain private
release evidence. Do not replace the live backend until its preservation proof and
active-work handoff are verified.
