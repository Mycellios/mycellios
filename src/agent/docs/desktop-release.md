# Desktop releases

Mycellios Desktop is released by the workflows in this repository's root
`.github/workflows`. GitHub does not run workflows under `src/agent/.github`.
Nobody picks a version or pushes a release tag by hand.

## How a release happens

1. Each pull request that changes `src/agent` writes its notes in
   `src/agent/changelog.d` ([release notes](../../../docs/DEVELOPMENT.md#desktop-release-notes)).
2. Every day at 05:00 UTC, `desktop-auto-release.yml` turns the waiting notes into
   the next version (major for a breaking change, patch for fixes only, minor
   otherwise), merges that version change to `main` and starts
   `installer-release.yml`.
3. `installer-release.yml` admits the current `main` revision when its version has
   no release yet and builds every platform from that one revision: Windows, Linux
   (DEB and RPM), both Mac architectures and the Android build input.
4. Its `publish` job checks each platform's receipt against that revision and
   publishes the `desktop-v<version>-windows-preview` GitHub release with the
   SHA-256 and size of every file. It never replaces an existing release.
   `verify-promotion` then checks the public catalogs and downloads.
5. The same run builds that revision's self-host images. Once the release is
   public, `self-host-release` adds the `v<version>` tag to its `app`, `computer`
   and `updater` images and tags the commit `v<version>`: the self-host release of
   that version ([published images](./self-host.md#published-images-and-tags)).

`npm run release:patch`, `release:minor` and `release:major` in `src/agent`
prepare a version by hand when one is needed. They publish nothing.

A failed job can be re-run from the same workflow run. Publication never replaces
a published release, file or tag with different content.

## Signing and updates

No identity that operating systems trust signs the current previews, and no
repository secret holds a signing certificate, password or notarization key:

- Windows installers are unsigned (`signExecutable: false`). Windows names an
  unknown publisher, and SmartScreen may warn before the first run.
- Mac apps and DMGs are signed ad hoc (`identity: '-'`) and not notarized.
  Release qualification runs a strict `codesign --verify` and records Gatekeeper's
  assessment separately; macOS still asks before opening the app.
- Linux packages are not signed. The Android build input is signed on the
  original signing host before the download page links it.

Updates are verified but never installed unattended. Desktop downloads a newer
package from the official catalog in the background and checks its SHA-256. It
installs only when the person chooses Restart (the Windows update helper, or a
writable Mac app that replaces itself) or opens the system installer.

`specs/trusted-distribution/spec.md` plans signed Windows installers and
notarized Mac builds; until those phases ship, this page describes the release.
