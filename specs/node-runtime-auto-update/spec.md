# Verified node runtime updates

Status: implemented and unit-tested, including stable multi-component
publication. Not active in production. Not yet qualified on a physical node.
Activation is blocked by the owner steps in "Activation" below.

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
and `manifest.json`), the production `node_modules` (`ws`, `zod`) and
`python/distributed_runtime/model_adapter_registry.json`, which
`app/contracts/model-adapter-registry.js` reads from its own root. `bin/`,
`runtime/`, the rest of `python/` (shipped as `python-product`) and the
trust anchor stay with the installer.

`scripts/stage-node-installer.mjs` writes this tree once for both outputs:
`stageNodeInstaller` (the MSI/DEB/PKG layout, which also gets the full
`python/` product that `node.json`'s `runtime.pythonPath` points at) and
`stageNodeApp` (`--component=node-app`). Earlier installer layouts had
neither `package.json` nor `python/` at their root, although `main.js` and the
adapter registry read both from there.

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

### Publication (`src/update/component-update-publisher.ts`)

One stable manifest carries `python-product` and `node-app`, so a node never
receives one without the other:

- **Same revision.** `prepareComponentRelease({ components: ["python-product",
  "node-app"] })` builds `python-product` from `build/python` and `node-app`
  from the staged root. It refuses a `node-app` whose `app/manifest.json`
  revision is not the clean release revision, whose provenance `sourceId` is
  not the release source tree, whose version differs, whose adapter registry
  differs from `python-product`'s, or that carries a trust anchor. The
  manifest `revision` is that revision, which the node-app canary checks.
  `sourceTreeDigest` seals both files manifests.
- **Release record.** A multi-component release uses
  `mycellios-component-release/2` with one `<component>.blob` per artifact.
  A python-product-only release keeps `mycellios-component-dev-release/1`,
  `artifact.blob` and its exact manifest.
- **Publish.** Before any request, every artifact must match its signed size,
  SHA-256 and files manifest (per-file digests). Artifacts upload first
  (content-addressed, idempotent), then the manifest; the public manifest and
  every artifact are read back and verified. Reconciliation evidence lists each
  artifact.
- **Targets.** Only `win32/x64` is published today: Linux and macOS nodes run
  without the supervisor and reject manifests that contain `node-app`.

### Stable signing (`src/update/component-release-signing.ts`)

- The Desktop bootstrap list `STABLE_COMPONENT_UPDATE_KEYS` stays empty, so the
  Desktop agent still refuses stable manifests. Node releases instead pass the
  stable keys from the installer trust anchor (`MYCELLIOS_NODE_COMPONENT_TRUST`)
  as `pinnedStableKeys`: CI can only sign with a key the nodes already pin.
- `resolveStableReleaseSigning` fails closed with fixed codes when the trust
  anchor or the private key is missing, the key is not Ed25519, or its public
  key is not pinned. Errors never carry key material, and the key and admin
  token are removed from child process environments.
- `component-update-cli keygen` still creates only dev keys. Tests use dev or
  throwaway keys.

### Release job (`.github/workflows/installer-release.yml`)

`node-components` runs after the installers of an admitted revision are
published, only when the variable `MYCELLIOS_NODE_COMPONENT_PUBLICATION` is
`enabled`, in the `node-component-release` environment. It checks that the
secrets exist, compiles `dist`, stages `node-app`, then runs
`component-update-cli release --platform=win32 --arch=x64`. That command
signs and publishes both components to the trust anchor's feed (or
`MYCELLIOS_COMPONENT_UPDATE_PUBLISH_URL`) and keeps the public release record
as a workflow artifact. Installers never depend on this job, and it builds no
package.

## Activation

1. **Stable key ceremony (owner, offline).** Generate an Ed25519 key on an
   offline computer and keep the private key offline. Store it only as the
   `MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY` secret of the protected
   `node-component-release` environment. Only its public half goes in
   `MYCELLIOS_NODE_COMPONENT_TRUST` and the coordinator.
2. **Release job.** Add the environment secret
   `MYCELLIOS_COMPONENT_PUBLISH_ADMIN_TOKEN` (the coordinator's
   `MYCELLIOS_MODEL_ADMIN_TOKEN`), then set
   `MYCELLIOS_NODE_COMPONENT_PUBLICATION=enabled`.
3. **Coordinator env (Nucleus memberEnv):**
   - `MYCELLIOS_COMPONENT_UPDATES_DIST=<persistent volume path>`;
   - `MYCELLIOS_COMPONENT_UPDATE_STABLE_KEY_ID=<key id>`;
   - `MYCELLIOS_COMPONENT_UPDATE_STABLE_PUBLIC_KEY=<base64url SPKI>`, or the
     `_FILE` form.
   `MYCELLIOS_NODE_UPDATES_DIST` (`/updates/node/`, legacy installer files) is
   not used by this design. On 2026-11-23 `/updates/v1/` on
   www.mycellios.com already reached the coordinator (an empty 404 from the
   registered route without a feed; unknown paths get Fastify's JSON 404).
   Publication also sends `PUT /public/v1/admin/component-updates/...` with
   artifacts of a few MiB through the same ingress; set
   `MYCELLIOS_COMPONENT_UPDATE_PUBLISH_URL` if that path has a smaller body
   limit.
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
   which is a MajorUpgrade). The package must be built from a revision that
   stages `package.json` and `python/` at the install root (see "Component
   `node-app`"). It already contains #483. After that hop, later releases
   arrive automatically once the owner opts in.

   Desktop performs this hop on Windows:
   - **Detection.** `status()` reports `upgradeAvailable` when the computer
     is enrolled, the runtime is installed, `app/component-update-trust.json`
     is absent, and the pinned runtime is not a legacy package
     (`LEGACY_RUNTIME_SHA256`).
   - **Action.** The sidebar shows "Update this computer". After an explicit
     click and UAC, `upgrade-runtime.ps1` verifies the pinned MSI hash, stops
     `MycelliosNode`, runs the MSI and checks that the trust anchor now exists.
     It then starts the service again, and it also restarts the service after
     a failed or cancelled MSI.
   - **Scope.** It never touches the identity, the configuration or the
     service definition in `ProgramData`.
   - **Same version.** `package.json` is not bumped per revision, so the MSI
     sets `AllowSameVersionUpgrades="yes"`.
   - **Publication.** CI publishes the pinnable package with the `node-build`
     workflow input `publish_windows_runtime` (main only), as the immutable
     `desktop-runtime-<sha256>` release. Desktop adopts it only after a
     reviewed change to the hash pinned in `desktop-windows-release.yml`.

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
- `tests/component-update-node-release.test.ts`:
  - one manifest with both components from the same clean revision;
  - a real coordinator accepts it and a supervised node verifies and activates
    both components, with the node-app canary bound to that revision;
  - a node-app from another revision or source tree is refused;
  - a tampered node-app artifact is rejected before any upload;
  - stable signing fails closed without the key or trust anchor, or with an
    unpinned or non-Ed25519 key;
  - the python-product-only release keeps its record and manifest.
- `tests/node-installer-layout.test.ts`: `package.json` and the `python/`
  product at the install root.
- `landing/src/contribute-node-updates.test.ts`: the owner-facing status.

Not run: a physical node receiving a published release, the 10-minute health
window on Windows, an installed MSI with the new layout, and the release job
(no stable key exists yet).
