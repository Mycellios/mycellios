# Fedora release gap (2026-11-11)

The client now checks the catalog and hands a verified RPM to the system
installer, but Fedora users can only reach what the catalog publishes. At the
time of this change the extended catalog (`?include=macos-all`) advertises:

| Entry | Version |
| --- | --- |
| `windows-x64` (EXE) | 0.3.39 |
| `linux-x64` (DEB) | 0.3.32 |
| `fedora` (RPM) | 0.3.32 |

So an installed 0.3.30 RPM correctly reports 0.3.32 as the available update and
never invents 0.3.39. Closing the gap is a release task, not a client change.

## What to publish

1. Build the RPM from the release whose Desktop version should reach users:
   `npm run desktop:package:rpm` (needs `rpm-build`, `binutils`, `tar`, `gzip`,
   `zstd`, Linux x86_64). It reads `config/desktop-fedora-release.json`, so that
   pin must name the Desktop DEB and source archive of that exact version.
2. Publish, immutably, under `/downloads/desktop/releases/<version>/`:
   - `Mycellios-Desktop-<version>[-<rpmRelease>]-fedora-x86_64.rpm`
   - the matching `*-source-*.tar.gz`
   - never overwrite an earlier version directory.
3. Add the builder's `*.rpm.catalog.json` entry as the optional `fedora` object of
   the `?include=macos-all` catalog response, with:
   - `version` equal to the RPM version,
   - `fileName` equal to the published RPM name (a build revision suffix is
     accepted by the client),
   - `path` equal to `/downloads/desktop/releases/<version>/<fileName>`,
   - the RPM's real `bytes` and `sha256`.

The default (non-`macos-all`) response stays compatible with earlier clients and
does not need the entry.

## Rules the client depends on

- The `fedora` entry must never advertise a version without its RPM file at the
  exact `path`; the client verifies size and SHA-256 before offering it.
- Do not raise `fedora.version` before the file exists: the check would fail and
  surface an error instead of an update.
- Keep `automaticUpdates: false`. The RPM is installed by the system installer,
  never by the app.
- Desktop tags remain independent: `desktop-v<version>-fedora-preview` is a
  preview tag, not a catalog source. The catalog is the only feed the client
  reads for Linux.
