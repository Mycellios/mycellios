# Retire the legacy upstream identifiers

## Objective

Mycellios Agent was imported from an upstream project whose name still appears in
runtime identifiers. Visible text, package names and documentation already use
Mycellios (PRs #457 and #469). What remains (5,774 occurrences,
frozen per file in `scripts/private-terms-baseline.json`) is read or written by
something outside the source tree: the production server, installed Desktop and
mobile apps, browsers' storage, the database, bot computers' disks or published
images. A plain rename would sign users out, lose preferences, break old clients
or stop the production stack.

This spec retires those identifiers without breaking any of them. It ends when
the private-terms baseline holds only the required license attribution.

The legacy name is written here as `<legacy>` (lowercase), `<Legacy>` and
`<LEGACY>`. Do not reintroduce it in plain text in new files: the guard rejects it.

## Non-goals

- Changing the Apache-2.0 attribution in `src/agent/NOTICE`, `src/agent/LICENSE`
  and `THIRD_PARTY.md`. The license requires it; it stays.
- Rewriting Git history. That is a separate, prepared operation
  (owner's procedure outside the repository) that runs only when no branch or
  worktree is active.
- Changing application identities that stores and operating systems bind to
  installations (Desktop `com.mycellios.agent.desktop`, Android
  `com.mycellios.android`). They already use the new name.

## Principles

1. **Read both, write new.** Every renamed identifier is read under its new name
   first and its legacy name second. Writers use only the new name. Each surface
   has exactly one compatibility module that knows the legacy spelling; it builds
   the legacy name from `LEGACY_PREFIX` so the spelling exists in one place.
2. **Migrate on first read.** Persisted client values (storage keys, secure
   store entries) are copied to the new key when read from the legacy key, then
   the legacy key is removed. Never delete a legacy value that was not copied.
3. **Old clients keep working until they are unsupported.** Servers accept legacy
   headers, schemes and bridge names until the minimum supported Desktop, PWA and
   mobile builds send the new ones. Removal is a separate, later PR.
4. **Production changes go through Nucleus.** Environment, database, image and
   path changes are promoted as approved intents with backup, health check and
   rollback. Never apply them by hand on the server.
5. **The baseline only goes down.** Each PR lowers
   `scripts/private-terms-baseline.json` with `--update`; none raises it.

## Inventory

Counts are from the tree at the time of writing (`main` after #469).

| Group | Occurrences / files | Who depends on it | Phase |
| --- | --- | --- | --- |
| Code-only identifiers: TypeScript types, helper names, logger and MCP client names, test fixtures, comments, prose in docs | ~1,700 / ~330 | Nothing outside the build | 1 |
| Environment variables `<LEGACY>_*` (149 distinct) | 1,482 / 239 | Production `.env` and Compose, CI workflows, Desktop launches, developers' shells | 2 |
| HTTP headers `x-<legacy>-*` (11 distinct; `space-id` and `bot-id` dominate) | 281 / 64 | Installed Desktop, PWA and mobile builds, sandbox supervisor | 3 |
| Browser and device storage keys `<legacy>.*`, `<legacy>:*` (80 distinct, including the mobile session token) | 447 / 112 | Users' browsers, PWA, Desktop profiles, mobile secure store | 4 |
| Desktop preload bridge `window.<legacy>Desktop` and its types | 223 / 67 | Installed Desktop builds talking to the served web app | 4 |
| URL scheme `<legacy>://` | 142 / 34 | OAuth redirects and deep links of installed Desktop and mobile apps | 5 |
| Legacy Expo mobile modules and package `com.<legacy>.*` | 103 / 56 | The legacy Expo preview build only | 5 |
| Memory container keys `<legacy>:workspace:*` and similar | part of "storage keys" | Stored memories in the configured memory provider | 4 |
| Database name `<legacy>` and roles `<legacy>_app`, `<legacy>_local` | 88 / 40 | Production and self-hosted databases, Desktop local stack | 6 |
| Server paths `/srv/<legacy>`, `/etc/<legacy>`, systemd units `<legacy>-*` | ~120 / ~40 | Production host layout and self-hosted installs | 6 |
| Bot computer user `/home/<legacy>`, tools `<legacy>-browser`, `<legacy>-focus-or-launch` | ~400 / ~60 | Existing bot computers' persistent volumes and images | 6 |
| Docker service, network and image names (`<legacy>-api`, `<legacy>-shared`, `<legacy>/computer`) | 250 / 89 | Running Compose projects, Nucleus bindings, local image tags | 6 |
| Upstream artifacts: published images, install script, update repository, upstream site | 98 / 38 | Self-host installs and the self-update identity | 7 |

## Phases

Each phase is one or more small PRs. A phase starts only after the previous one is
merged and, where it touches production, promoted.

### Phase 1: code-only identifiers

Rename identifiers that never leave the build or the test process: TypeScript
types and helpers (for example `<Legacy>Desktop*` types once Phase 4 adds the new
bridge name, `is<Legacy>Health`), logger service names, the MCP client name,
temporary directory prefixes, fixtures, comments and documentation prose.
Verify: Agent workspace typechecks and the affected tests.

### Phase 2: environment variables

- Add `packages/core/src/env-names.ts` with `readEnv(name)`, which reads
  `MYCELLIOS_<NAME>` and then the legacy name, and logs one deprecation line per
  legacy name per process (name only, never the value).
- Use the `MYCELLIOS_` prefix. Two names already exist with that prefix
  (`API_URL`, `GIT_BASH_PATH`): confirm they mean the same thing before sharing
  them, otherwise use `MYCELLIOS_AGENT_` for those two.
- Move every reader to `readEnv`, and Compose, `.env.example`, install scripts,
  CI workflows and docs to the new names. Compose interpolation accepts both:
  `${MYCELLIOS_X:-${<LEGACY>_X:-default}}`.
- Production: update the server environment through a Nucleus intent after the
  release that reads both names is live. Verify `/health` and the critical routes.
- Removal: drop legacy reads one release after production and Desktop no longer
  set them.

### Phase 3: HTTP headers

- Servers (API, supervisor, relay) accept `x-mycellios-*` and the legacy header;
  if both are present they must be equal, otherwise reject the request.
- Clients send only the new header from the release that ships this change.
- Removal: after the minimum supported Desktop and mobile builds send the new
  headers. The release notes and the updater's minimum version decide the date.

### Phase 4: client storage, memory keys and the Desktop bridge

- One storage adapter per surface (web, Desktop renderer, mobile secure store)
  reads the new key, falls back to the legacy key, copies the value and removes
  the legacy key. The mobile session token keeps the user signed in.
- Supermemory reads both prefixes, writes the new prefix, and purges both versions
  of each explicitly cleared history generation. Upgrade all readers and purgers
  before relying on new writes, and keep that compatibility in any rollback.
  Existing provider data stays readable in place. A separate bounded migration
  must qualify the provider merge on isolated data before moving existing tags.
  The provider deletes source tags on a successful merge. Coordinate with history
  writers and purges before moving any generation.
- Desktop preload exposes `window.mycelliosDesktop` and keeps the legacy alias
  pointing at the same object. The web app prefers the new name and falls back to
  the alias, so a new web build works with old Desktop builds and the reverse.
- Verify with fresh and upgraded profiles: preferences, Space selection, drafts
  and sessions survive.

### Phase 5: URL scheme and the legacy Expo preview

- Desktop and mobile register `mycellios://` in addition to the legacy scheme;
  OAuth redirect allowlists accept both until old builds are unsupported.
- The legacy Expo preview (`com.<legacy>.app` and its native modules) is
  superseded by `apps/android`. Decide between retiring it (remove the modules)
  and renaming its modules and package before a final build. Do not change its
  application ID while installed copies still update from it.

### Phase 6: server, database, bot computers and Docker names

These touch production state and run only as approved Nucleus intents with a
fresh backup and a rollback plan.

- Database role: add the new role, grant it the same privileges and RLS
  membership, switch `DATABASE_URL` through Phase 2's variables, then drop the
  legacy role in a later deploy. Keep migrations compatible with the previous
  release (see `src/agent/AGENTS.md`).
- Database name: rename only in a maintenance window, or keep the physical name
  and expose only the new name in configuration; record the decision here.
- Server paths and systemd units: install new units side by side, move
  configuration with a symlink from the old path, then remove the old units.
- Bot computers: new images use `/home/mycellios` and the new tool names, with
  symlinks for the legacy paths so existing persistent volumes keep working.
  Tool lookups in adapters accept both names during the transition.
- Docker service and network names: change in the Compose files together with
  the Nucleus binding, never separately.

### Phase 7: upstream artifacts

Publish Mycellios-owned images, install script and update source, then switch the
defaults (`.env.example`, Desktop local stack, docs and the self-update repository
identity). Keep the upstream sources only as an explicit opt-in for existing
self-hosted installs until they have migrated.

## Verification

- Every PR: `node scripts/verify-private-terms.mjs` (baseline lowered with
  `--update`), `npm run verify:structure`, and the affected workspace typechecks and
  tests through remote CI.
- Phases 3 to 5: an upgraded Desktop profile and a mobile/PWA session created
  before the change keep working after it; a new client works against the previous
  server release.
- Phases 2 and 6: Nucleus promotion with `/health` revision, critical routes under
  400, and a tested rollback.
- Done when the baseline contains only `THIRD_PARTY.md`, `src/agent/NOTICE` and
  `src/agent/LICENSE`, plus `scripts/private-terms-baseline.json` itself, which
  stores no names.

## Proposed decisions

Proposed on 2026-11-22; each one is confirmed by the owner before the phase that
depends on it starts.

- Legacy removal gate (Phases 3 to 5). Accepting both spellings needs no minimum
  version, so those changes ship first. A legacy header, scheme or bridge alias is
  removed only when both hold: `MYCELLIOS_MIN_CLIENT_BUILD` (or its legacy name)
  requires, for every platform, a build at or after the first release that sends
  only the new spelling, and at least 60 days have passed since that release.
  Desktop releases are versioned from 0.13.0; the gate names the first later
  release that carries the change.
- Legacy Expo preview (Phase 5): retire it. `apps/android` supersedes it; remove
  its native modules and package after its last installed copies have been asked
  to move, instead of renaming them for a final build.
- Production database (Phase 6): keep the physical database name and expose only
  the new name in configuration. Renaming needs a maintenance window for no user
  benefit. Roles still move to new names, as Phase 6 describes.
