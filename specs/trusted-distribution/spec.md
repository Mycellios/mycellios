# Distribute Mycellios through trusted, owned channels

Status: proposed design. No product code changes with this spec.

This spec covers how Mycellios reaches people beyond the hosted web app:
self-hosted servers, Desktop installers that operating systems trust and that can
update unattended, a native iPhone app and a public status page. It builds on
`cross-platform-release` (one source revision, immutable releases),
`desktop-manual-updates` and `windows-update-recovery` (verified manual updates),
`desktop-macos` (ad-hoc Mac previews), `agent-mobile-install` (the installed web
app on phones) and `legacy-name-migration`, whose phase 7 asks for Mycellios-owned
images, install script and update source; phase 1 here is that plan in detail.
Linux packages, the Android host and the download catalog stay as they are.

## Existing behavior

- Windows packages are built unsigned (`signExecutable: false` in
  `src/agent/apps/desktop/scripts/windows-installer.mjs`) and Mac packages ad-hoc
  (`identity:'-'`, `notarize:false`, `hardenedRuntime:false` in
  `scripts/desktop-macos/macos-installer.mjs`; `signature-check.mjs` records
  Gatekeeper separately). Desktop therefore sets `installSupported: false` and
  `autoInstallByDefault: false` (`src/agent/apps/desktop/src/main.ts`), and
  `update-preferences.ts` refuses to arm an unattended install. Verified updates
  still download in the background from the official catalog. Installing needs an
  explicit Restart (the Windows helper, or a writable Mac app replacing itself) or
  the system installer (Linux and other Mac installs). The idle-restart path
  exists behind that flag.
- Neither update helper checks who signed a package: `manual-update-helper.ps1`
  has no Authenticode check, and `manual-update-macos.sh` runs a strict
  `codesign --verify`, which any valid signature passes, ad-hoc included. Both
  rely on the catalog's SHA-256.
- `src/agent/docs/desktop-release.md` documents Developer ID signing,
  notarization and Authenticode secrets for a `release-desktop` workflow under
  `src/agent/.github/workflows/`. GitHub runs only the root `.github/workflows`,
  so that workflow never runs and the document contradicts the real release.
- Self-hosting follows the upstream project. In `src/agent/infra/compose`,
  `install-images.sh` downloads its compose files from the upstream repository by
  default (its `<LEGACY>_DOWNLOAD_BASE` variable, written with the placeholder of
  `legacy-name-migration`), and `docker-compose.images.yml` and
  `.env.images.example` default to the upstream `app` and `computer` images on
  `edge`. `packages/core/src/self-update.ts` and `compose-update.ts` name the
  upstream repository and image path as the official update source; the updater
  lists tags with `git ls-remote` and accepts only `v<semver>`, while this
  repository tags releases `desktop-v<version>-windows-preview`
  (`scripts/publish-installer-release.mjs`). `src/agent/docs/self-host.md` tells
  people to fetch that installer and run pnpm commands, and Desktop's optional
  Docker stack (`apps/desktop/src/local-stack.ts`) ships the same compose file and
  asks for `v<Desktop version>` image tags, which nobody publishes for Mycellios.
  A self-hosted server therefore installs, and updates to, code that this
  repository does not build.
- Main already publishes `coordinator`, `agent`, `computer` and `supervisor` to
  `ghcr.io/mycellios/mycellios/*` as `sha-<commit>`, for linux/amd64 only, with
  the OCI revision label (`.github/workflows/deploy.yml`). The `agent` image bakes
  the production `/agent/` base path; the Dockerfile's default is `/`. No updater
  image, arm64 build or release tag is published.
- There is no native iPhone app. `src/agent/apps/android` is a WebView host that
  packages `apps/web` unchanged, with FCM push and a durable release key, built
  from the release revision (`android-release.yml`). The legacy Expo preview
  (`apps/mobile`) declares an iOS bundle identifier in `app.json`, but no workflow
  builds or publishes it, and `legacy-name-migration` proposes retiring it. On an
  iPhone people use the installed web app, which `agent-mobile-install` presents
  as a web app.
- No public page says whether the site, the Agent app, sign-in, downloads or the
  network work. The coordinator's `/health` reports status, revision and worker
  counts (`src/coordinator/server.ts`). Agent's public `/health` is a constant
  `{ ok: true }`, while `/ready` (database probe, degraded flag, revision) and
  `/internal/health` serve orchestration (`src/agent/apps/api/src/health.ts`); a
  constant answer stays green while the API fails, so it is no status signal.
  Nucleus checks health after each deploy and rolls back, and
  `installer-public-health.yml` re-verifies published downloads on manual
  dispatch only.

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) notarizes Developer ID macOS builds, signs Windows
builds through a cloud signing service unlocked by the release workflow's OIDC
token (no stored key) and leaves Linux unsigned; its updater accepts only the
pinned publisher. It publishes one amd64 and arm64 server image with `latest`,
version and per-architecture tags, a compose file per release and a home-server
app store package. Its phone apps ship through TestFlight, the App Store and
Google Play. Its status page is a static site that a scheduled workflow builds on
GitHub Pages, so it stays up when the product does not, with labelled issues as
incidents and a public feed.

## Decision

Five phases, in this order; each ships alone. Phases 1 and 2 need no purchase.
Phases 3 to 5 start only after their open decision is settled.

1. Phase 1 — a Mycellios-owned self-host channel (`legacy-name-migration`
   phase 7).
   - Publish from main, on GitHub-hosted amd64 and arm64 runners, the server image
     `ghcr.io/mycellios/mycellios/app` (the existing Dockerfile with its default
     `/` base path), `computer` and `updater`. Tag each `sha-<commit>`, and the
     newest main `edge`. The packages allow anonymous pulls (open decision:
     making them public).
   - Each Desktop release also tags its commit `v<version>`, which the updater's
     release parser already accepts, and adds the `v<version>` image alias that
     Desktop's Docker stack already requests. An alias never rebuilds an image.
   - Switch the defaults. `install-images.sh` fetches its files from this
     repository's `src/agent/infra/compose` at the same tag. The compose files and
     `.env.images.example` name the Mycellios images. `self-update.ts` and
     `compose-update.ts` name this repository and image path. `self-host.md` uses
     npm and the new installer.
   - An existing install whose `.env` names the upstream image keeps it until the
     owner moves; the installer and the update panel offer the move once. The move
     refuses when the database lists a migration this repository lacks (an
     upstream release newer than the fork) instead of failing at startup.
   - Correct `desktop-release.md` to describe the real unsigned and ad-hoc release
     until phases 3 and 4 replace it.
2. Phase 2 — a public status page.
   - A scheduled workflow on GitHub-hosted runners (every 5 minutes, which GitHub
     may delay) probes public endpoints only: the site `/`, the Agent app
     `/agent/`, a content-free Agent readiness read, the sessionless sign-in read,
     the coordinator's `/health` status and the stable download routes, using
     `installer-public-health.yml`'s ranged check.
   - Agent gains that readiness read: `ok` and `degraded` from the same database
     probe as `/ready`, with no revision or details, reachable through the public
     proxy. The constant `/health` stays.
   - The workflow builds a static page, `status.json` and an Atom feed and deploys
     them to GitHub Pages, outside the servers it reports on, with permissions
     limited to Pages and reading issues. Each run reads the published
     `status.json` as its previous state and keeps 90 days of hourly summaries, so
     it writes no commits. Two failed probes in a row mark a service degraded, four
     mark it down. Open decision: the address (default `status.mycellios.com`,
     which needs a DNS record) and public incident issues.
   - Incidents and maintenance are issues with a `status` label that maintainers
     open and close; the page and the feed carry them. The page shows state,
     response time and incident text, and links to the Live network page.
3. Phase 3 — signed Windows installers and unattended installs.
   - Prerequisite (open decision): a code-signing identity and route. Default:
     a cloud signing service that issues short-lived certificates to the release
     job through GitHub's OIDC token, so no private key or password is stored.
     Alternative: an OV certificate on a cloud HSM.
   - The release job on main signs the app executable, its helper executables,
     the installer and the uninstaller. Pull request and qualification builds stay
     unsigned (`unsigned-windows-installer-qualification.yml` keeps working).
     Release qualification requires a valid signature by the pinned publisher on
     every signed file, and the release receipt records it.
   - Desktop checks the staged installer's Authenticode signature against the
     pinned publisher as well as the catalog SHA-256, before the existing Windows
     attachment check and handoff. A signed build refuses an unsigned or
     differently signed package.
   - Only then does `installSupported` become true, for a signed build running on
     Windows. New installs default to idle installs, as `src/agent/AGENTS.md`
     already describes; saved opt-outs and unreadable preferences keep them off,
     and the idle checks stay (renderer acknowledgement, idle native work, grace
     period, Cancel).
   - Unsigned installs take the first signed release through Restart, as today. A
     later change of signing subject first needs one release accepting both. The
     unknown-publisher warning goes away; SmartScreen may still warn until the
     certificate earns reputation, so the download page keeps its guidance.
4. Phase 4 — notarized Mac builds.
   - Prerequisite (open decision): an Apple Developer Program membership
     (yearly fee), which also covers phase 5.
   - Both Mac builds sign every Mach-O in the bundle (the app, the local server's
     binaries and helpers) with a Developer ID Application identity and the
     hardened runtime, with only the entitlements Electron and the local server
     need. They notarize and staple the app and the DMG. Strict codesign, stapler
     validation and Gatekeeper acceptance become release gates on both
     architectures, and the pinned osx-sign adapter keeps its sequential scan.
   - `manual-update-macos.sh` adds a signer requirement (Developer ID with the
     pinned team) to its strict check; an ad-hoc install takes its first notarized
     update through Restart. That update changes the app's code identity, so macOS
     asks again for microphone and accessibility access and for the app's keychain
     item (Electron safe storage). The update prompt says so once; refusing the
     keychain item means signing in again on that Mac.
   - Unattended installs then follow phase 3's rules, on a writable app that macOS
     did not move to a temporary location.
5. Phase 5 — an iPhone app.
   - Prerequisite: the phase 4 membership and App Store review.
   - `apps/ios` mirrors `apps/android`: a WKWebView host over the packaged
     `apps/web` with the same exact-origin, main-frame and packaged-route checks
     and no tokens or cookies over the bridge; APNs push through the existing push
     outbox with encrypted, session-bound device records; foreground-only
     microphone for dictation and voice; a share extension that opens an editable
     draft and never sends; universal links into chats.
   - It builds on GitHub-hosted macOS runners from the release revision, with a
     build number derived from the Desktop version as Android's versionCode is. It
     ships to TestFlight first, then the App Store. The legacy Expo preview is
     retired, not published.
   - Apple can reject an app that is mostly web content. Native push, sharing and
     voice are why this app exists; a rejection leaves the installed web app as
     today.

Rejected:

- Publishing the Expo preview to the App Store: a second UI codebase that the
  repository plans to retire. The WebView host keeps one UI, as Android does.
- Mac App Store distribution: its sandbox blocks local CLI engines, PC control and
  the local server. Developer ID distribution keeps them.
- Unattended installs of unsigned packages trusted on the catalog hash alone: a
  compromised catalog or download host would install code silently. The signature
  is an independent identity check.
- Hosting the status page on the production servers: it would fail together with
  what it reports.
- Mirroring upstream images under Mycellios names: images come only from this
  source tree, with its revision label.

## Rules

- The release gates stay: one source revision, immutable artifacts, exact hashes
  and sizes, receipts, rollback and public download probes. Signing adds a check
  and never replaces a hash check.
- No platform turns on unattended installs before its signing phase qualifies.
  Saved opt-outs and unreadable preferences always win.
- No private key, certificate password or notarization key lives in the
  repository, logs or build artifacts; only the release job on main signs. Signing
  identities, legal names and Apple team identifiers live only in release
  configuration, never in commit messages, PR descriptions, issues or docs.
- Self-host defaults pull only images that this repository's workflows build from
  main. The updater never pulls a tag that is not a release of this repository,
  and rollback reuses the exact cached image, as it does today.
- Status probes use public endpoints only, with no credentials, account, model
  call or user content. The page publishes no traffic, account or usage figures.
- The iPhone host follows the Android host's bridge, push and permission rules.

## Verification

- Phase 1: installer and compose tests that the defaults resolve to Mycellios
  sources at the release tag, updater tests for this repository's tags (ignoring
  `desktop-v*`), the move's refusal on an unknown migration on isolated
  PostgreSQL, and an anonymous pull of each image. A fresh install on clean amd64
  and arm64 machines is reported separately.
- Phase 2: probe tests against a local fake service (up, slow, error, timeout,
  and two and four failures in a row), the page and feed build, a dry run of the
  workflow, and a test that the readiness read returns no details.
- Phase 3: helper and controller tests for valid, unsigned and wrong-publisher
  packages; release qualification that requires signatures. A physical unsigned
  to signed upgrade and an idle install are reported separately.
- Phase 4: strict codesign, stapler and Gatekeeper checks on both architectures
  in CI; self-update tests with a Developer ID signature. A physical upgrade from
  an ad-hoc install, with its prompts, is reported separately.
- Phase 5: bridge and origin tests mirroring Android's; APNs registration and
  outbox tests. A TestFlight build on a physical iPhone is reported separately.
