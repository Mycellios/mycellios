# Desktop release: Linux and macOS packages in the publish pipeline (2026-11-11)

## Windows unsigned manual updates

Publisher signing is deferred. The Windows release and promotion workflows do
not require a signing account or certificate. Packaging sets
`forceCodeSigning:false` and `win.signExecutable:false` to avoid discovering an
unrelated signing identity while retaining executable icons/version resources.
The staged installer still requires the owned HTTPS source, exact byte count and
SHA256, download-zone evidence, Windows attachment policy and explicit restart.
The app stays open while Windows requests confirmation. A rejected check returns
the verified download to a retryable state; it does not authorize installation.

The narrow updater regression step runs even for expedited packages. It covers
manual download/installation, refusal and retry, package feed validation and the
native helper's isolated unsigned executable install/relaunch with draft retention.
The native fixture has truthful local-origin evidence; it does not simulate or
automatically approve Internet-origin SmartScreen/Attachment Services dialogs.
An unsigned public download can still warn or be blocked by Windows policy; never
remove its zone mark, bypass that policy or promise warning-free distribution.
Use a new immutable version for a future installer; do not replace published bytes.
To recheck an existing unsigned installer without recompiling, dispatch
`unsigned-windows-installer-qualification.yml` with its exact `version`. It validates
published source identity, byte count, SHA256 and unsigned status, then reuses the
hosted fresh-install, legacy-upgrade, draft/task preservation and failed-uninstall
recovery qualifier. The new receipt is separate evidence; it does not rewrite the
published release or turn an older expedited manifest into a fully qualified one.

Client versions from 0.3.40 include the Linux update path and from 0.3.44 the
macOS one: an installed RPM, DEB or disk image queries the desktop catalog,
verifies the exact file and SHA-256, and hands it to the system installer (or
mounts the image). The code is in `main`. What is still missing is the release
side: the publish pipeline only ships Windows, so `fedora` stays at 0.3.32 and no
Fedora or Debian user can reach a build that contains the fix.

## What publishing has to add

The 0.3.41 Linux package is already built and verified from `main`
(`0321cc8e`): workflow run `43007499813`, artifact
`desktop-linux-0321cc8ec1d77ecd3eda8364b8fb2842b40b2aa4`. It only needs to be
published.

1. Build the Linux package for the release being published:

   ```bash
   gh workflow run desktop-linux-release.yml --repo Mycellios/mycellios --ref main
   ```

   The job produces `*.deb`, `*.AppImage`, the source archive,
   `fedora/*.rpm`, `fedora/*.rpm.catalog.json` and `fedora/*.rpm.provenance.json`
   with `SHA256SUMS.txt`, and verifies the RPM by installing it in Fedora 44.

2. Copy into the staged `desktop-downloads/releases/<version>/` directory, next
   to the Windows artifacts that are already published:

   - `Mycellios-Desktop-<version>-fedora-x86_64.rpm`
   - `Mycellios-Desktop-<version>-source-<sha8>.tar.gz`
   - `Mycellios-Desktop-<version>-fedora-x86_64.rpm.catalog.json` (traceability)
   - `Mycellios-Desktop-<version>-fedora-x86_64.rpm.provenance.json` (traceability)

3. Add the builder's entry as the `fedora` object of `catalog-macos-all.json`.
   The artifact already contains it, already referencing the uploaded source
   archive, so paste it unchanged:

   ```json
   "fedora": {
     "id": "fedora-x64",
     "format": "RPM",
     "version": "<version>",
     "fileName": "Mycellios-Desktop-<version>-fedora-x86_64.rpm",
     "path": "/downloads/desktop/releases/<version>/Mycellios-Desktop-<version>-fedora-x86_64.rpm",
     "bytes": 0,
     "sha256": "<sha256>",
     "source": {
       "path": "/downloads/desktop/releases/<version>/Mycellios-Desktop-<version>-source-<sha8>.tar.gz",
       "sha256": "<source sha256>"
     }
   }
   ```

   `bytes` and `sha256` are the real values from the artifact; never hand-write
   them.

## Rules the client depends on

- Publish the payload first and the catalog last. A catalog that advertises a
  file which is not on disk makes the check fail instead of offering an update.
- Keep the top-level `version` at the Windows release. Per-package versions are
  allowed and already used for `linux-x64`/`macos-*`; the `fedora` entry carries
  its own.
- Only `catalog-macos-all.json` carries `fedora`. The default catalog and
  `catalog-macos.json` stay as they are so older clients keep working.
- Keep `automaticUpdates: false`. The RPM is installed by the system installer;
  the app never runs the package manager or elevates privileges.
- Never rewrite an existing release directory. Each version gets its own.
- Preserve the existing entries when a deploy swaps the directory: the current
  pipeline already keeps other platforms (`otherPlatformsPreserved`), and the
  same must hold for `fedora`, `linux-x64` and `macos-*`.

## macOS

The same step publishes the disk images with `--macos`. Each architecture is
listed only in the catalogs that already carry it: `macos-arm64` in
`catalog-macos.json` and both architectures in `catalog-macos-all.json`. The
client picks the image that matches the running architecture and opens it; the
owner drags the app to Applications and reopens it, because a disk image has no
package database to replace in place. A preview image is ad-hoc signed, so
Gatekeeper still warns and `automaticUpdates` stays off.

## Debian and Ubuntu

The same workflow produces the DEB. Publishing it as `linux-x64` in all three
catalogs closes the same gap for Debian/Ubuntu, with the same verification path
(`installAction: "system-installer"`). It is not required for Fedora users, but
leaving `linux-x64` at an old version keeps those users without the fix.

## Verifying a publication

```bash
curl -s "https://www.mycellios.com/public/v1/desktop-downloads?include=macos-all" \
  | jq '{version, fedora}'
curl -fsSL "https://www.mycellios.com/downloads/desktop/releases/<version>/<fileName>" \
  | sha256sum   # must equal the catalog entry
```

The client also rejects a mismatch, a non-official origin, a path outside
`/downloads/desktop/releases/<version>/` and any file name that does not belong
to the declared version.

## Qualification still missing

- A physical Fedora upgrade driven from the settings panel (0.3.41 → next).
- The DEB path on Debian/Ubuntu.
- The isolated Playwright settings flow for the new labels.
