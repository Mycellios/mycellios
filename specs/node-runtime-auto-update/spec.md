# Verified node runtime updates

Status: implemented and unit-tested. Not active in production. Not yet
qualified on a physical node. Activation is blocked by the steps in
"Activation" below.

## Goal

A paired contributor node receives verified runtime updates through Mycellios.
Nobody needs to be at the machine and nobody uses SSH. The immediate need is
the node-side code of #483 (memory-embedding replicas on paired nodes), which
only runs on builds that contain it.

## Constraints

- **Never install unsigned Desktop packages automatically.** This design never
  downloads or runs an EXE, MSI, DMG, PKG or DEB. Windows packages stay
  unsigned, so preview upgrades of the Desktop app and of the runtime installer
  stay manual.
- **Updates are signed components.** The only automatic path installs the
  existing side-by-side components (`src/update/component-update-manager.ts`):
  - an Ed25519-signed manifest, checked against keys the bootstrap pins;
  - a SHA-256 and a files-manifest check for every artifact;
  - a canary before activation;
  - an atomic pointer swap, with the previous root kept.
- **Owner-scoped.** Only the current owner of a node can consent for it. That
  consent never reaches another account's nodes.
- **Respect the owner and the work.** Updates respect owner pause, drain,
  operator maintenance and active leases.
- **Privacy.** Update logs and results carry only content-free codes and ids.

## Why not reinstall the runtime package

The headless runtime is installed by an MSI (DEB/PKG on other platforms) into
`Program Files\Mycellios` and runs as `LocalService` under WinSW. Desktop's
`install-runtime.ps1` installs it once and refuses an already-enrolled node.
Re-running that unsigned package automatically would break the rule above. Its
TypeScript code (`app/`) therefore becomes a signed component instead.

## Design

### Component `node-app`

`MANAGED_COMPONENT_POLICIES["node-app"]` (`restartScope: "agent"`) is a
`json-gzip-v1` files package. It mirrors the installed layout:
`package.json`, `app/**` (including `mycellios-native-build-provenance.json`
and `manifest.json`) and the production `node_modules` (`ws`, `zod`).
`bin/` and `runtime/` stay with the installer.

- **Canary.** Before the pointer changes, `canaryNodeApp` runs
  `app/node/component-canary.js` from the staged root with the bundled
  `node.exe`. The canary:
  - loads the worker, command, lifecycle, memory-embedding and service modules;
  - requires valid release provenance;
  - requires `app/manifest.json`'s `sourceRevision` to equal the signed
    manifest `revision`.
  It starts nothing and reads no request data.
- **Who can install it.** The lifecycle manages `node-app` only when the bundled
  supervisor launched the node (`MYCELLIOS_NODE_BOOTSTRAP_ROOT`). Any other node
  rejects a manifest that contains `node-app`
  (`component_update_component_not_managed`).

### Trust anchor

`app/component-update-trust.json` (`mycellios-node-component-trust/1`) holds the
feed URL and the pinned public keys.

- **How it is written.** `scripts/stage-node-installer.mjs --component-trust`
  writes it when the repository variable `MYCELLIOS_NODE_COMPONENT_TRUST` is set
  in `node-build.yml`. The value is public (no secret).
- **Precedence.** A `componentUpdates` block in `node.json` wins. Otherwise the
  node uses the anchor shipped with the bundled bootstrap. A component never
  supplies its own anchor.
- **Bad anchor.** A malformed anchor disables updates. It does not stop the
  service.

### Supervisor as update bootstrap (`src/node/service-supervisor.ts`)

The supervisor ships with the installer. It runs in a loop:

1. `planNodeAppLaunch` resolves the active `node-app` root, and accepts it only
   when all of these hold:
   - the root is on the configured channel;
   - its key is pinned;
   - its files are verified;
   - its entry point exists.
   Any doubt falls back to the bundled `app/node/main.js`.
2. It spawns the chosen entry point and sets `MYCELLIOS_NODE_BOOTSTRAP_ROOT`, so
   the component uses the bundled trust and bootstrap version.
3. **Boot health.** A launch that carries a pending `node-app` activation must
   remove the activation marker within 10 minutes. `main.ts` removes it once
   the worker is ready. Otherwise the supervisor stops the child.
4. If that launch exits while still pending, `rollbackUnhealthyNodeApp`
   restores the last verified root. If there is none, it restores the bundled
   app. A failed candidate never becomes `previous`.
5. If the rollback itself fails, the supervisor uses the bundled app for the
   rest of its life.
6. A service stop is never judged as a failure.

Python-product rollback inside `main.ts` is unchanged.

### Drain and leases (`src/node/command-applicator.ts`)

An `update` command runs in this order:

1. It persists `draining` and calls `beginRuntimeUpdateDrain`, so no new
   leases are offered.
2. It waits up to 60 s for `activeWorkCount` (leases, evidence challenges and
   runtime operations) to reach zero.
3. A busy node rejects the command with `node_update_waiting_idle` and resumes
   admission at once.
4. During activation, the manager's `isIdle` and `acquireActivationLease`
   recheck `activeWorkCount`.
5. Any failure, or an `up-to-date` result, releases the drain it started.
6. An update never changes `contributionEnabled`, so an owner pause survives
   updates, failures and restarts.

### Observation

The node snapshot has an optional `updates` field:
`{capable, channel, platform, arch, activeManifestId, nodeApp}`.

- `capable` requires all of: update trust, a pinned key for the channel, and
  the supervising bootstrap.
- Older builds omit the field and are never targeted.

### Coordinator (`src/coordinator/node-auto-update.ts`)

- **Consent storage.** `node_auto_update_preferences` stores consent per
  account. Default: off. Channel: `stable` only.
- **Consent routes.** `GET` and `PUT /v1/nodes/auto-update` need an account
  session. `available` is false when there is no signed component feed.
- **When it runs.** `NodeAutoUpdateScheduler.consider` runs after each accepted
  snapshot when the feed is configured.
- **What it checks.** It loads the node's current owner and that owner's
  consent only. `planNodeAutoUpdate` skips a node unless all of these hold:
  - ownership is active, the owner matches and the generation matches;
  - the node is `capable` and on the stable channel;
  - the node is not paused by its owner, not draining and not in maintenance;
  - the node is ready and has no active command;
  - a published manifest exists for its platform/arch and differs from the
    node's active one;
  - no update is pending;
  - the backoff allows it:
    - busy: 15 min;
    - failure or expiry: 1 h;
    - an applied attempt that was rolled back counts as a failure;
    - give up after 3 failures in 24 h.
- **What it queues.** One exact `update` command (`manifestId` pinned, TTL
  15 min) with actor `{kind: "account", id: <owner>, scopes: ["node:update"]}`.
  The node still verifies everything.

### UI

Desktop devices → "Runtime updates" in `landing/src/Contribute.tsx` (shared UI
kit). Each paired device shows whether it still needs one manual runtime
update, or which verified runtime it runs.

## Activation

1. **Publisher (follow-up).** `prepareComponentRelease` publishes only
   `python-product` with a single artifact. #483 changed both Python and node
   TypeScript, so one release must carry both components at the same revision.
   That needs:
   - a multi-artifact prepared release;
   - `node-app` staging from the installer layout;
   - a CI publication job.
2. **Stable key ceremony (owner).** `component-update-cli keygen` creates only
   dev keys. A stable key requires the offline production ceremony. The private
   key never enters CI or this repository.
3. **Coordinator env (Nucleus memberEnv):**
   - `MYCELLIOS_COMPONENT_UPDATES_DIST=<persistent volume path>`;
   - `MYCELLIOS_COMPONENT_UPDATE_STABLE_KEY_ID=<key id>`;
   - `MYCELLIOS_COMPONENT_UPDATE_STABLE_PUBLIC_KEY=<base64url SPKI>`, or the
     `_FILE` form.
   `MYCELLIOS_NODE_UPDATES_DIST` (`/updates/node/`, legacy installer files) is
   not used by this design. Check that `/updates/v1/` reaches the coordinator
   through the public ingress.
4. **Installer trust:** set the repository variable
   `MYCELLIOS_NODE_COMPONENT_TRUST` to
   `{"feedUrl":"https://www.mycellios.com/","pinnedKeys":{"dev":[],"stable":[{"keyId":"…","spki":"…"}]}}`.
5. **One manual hop per existing node.** Nodes installed before this change
   have three gaps:
   - no trust anchor;
   - a supervisor that launches only the bundled app;
   - no `updates` observation.
   They cannot receive anything automatically. The owner installs the new
   runtime package once (stop the `MycelliosNode` service, then run the MSI,
   which is a MajorUpgrade). That package already contains #483. After that
   hop, later releases arrive automatically once the owner opts in.

## Platforms

Only the Windows service runs through the supervisor today. Linux (systemd) and
macOS (launchd) run `main.js` directly. They report `capable: false` and keep
manual updates until their service definitions adopt the supervisor.

## Verification

- `tests/node-runtime-auto-update.test.ts`:
  - signed `node-app` verification, canary binding and launch;
  - boot-health rollback to the bundled app;
  - a tampered SHA-256 is rejected;
  - an unpinned key is rejected;
  - no `node-app` without the supervisor;
  - a canary failure blocks activation;
  - bundled trust precedence and fail-closed parsing.
- `tests/node-command-applicator.test.ts`:
  - drain happens before the idle wait, which happens before activation;
  - a busy rejection releases the drain;
  - owner pause is preserved.
- `tests/node-auto-update.test.ts`:
  - owner scoping;
  - pause, drain and maintenance;
  - capability and channel checks;
  - backoff and failure caps;
  - durable consent and exact command queueing.
- `tests/node-command-api.test.ts`: the consent routes.
- `landing/src/contribute-node-updates.test.ts`: the owner-facing status.

Not run: a physical node receiving a published release, and the 10-minute
health window on Windows.
