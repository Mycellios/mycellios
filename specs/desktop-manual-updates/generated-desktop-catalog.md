# Generated Desktop catalog (target design)

Today the Desktop catalog is a hand-maintained file next to the release
artifacts. Each release rewrites it, and three workflows publish Windows, Linux
and macOS separately. The result is drift: at the time of writing, Windows was
0.3.41, Fedora 0.3.32 and macOS 0.3.9, and one deploy removed the Fedora entry
entirely.

The interim fix is `scripts/publish-desktop-downloads.ts`, which merges the Linux
packages into the staged release before the swap. It removes the hand-written
hashes and refuses to advertise a file it has not staged, but it still merges
into a catalog somebody else owns. This document is the design that removes the
merge.

## Target

One release job owns the desktop downloads:

1. Build every platform from the same revision: Windows installer, AppImage,
   DEB, RPM and the source archive.
2. Derive the catalogs from the artifacts themselves. The job writes each
   package entry from the real file name, byte size and SHA-256; nothing is
   carried over from a previous catalog by hand.
3. Validate before the swap and abort on any violation:
   - every `path` resolves inside `/downloads/desktop/releases/<version>/`;
   - every advertised file exists with the declared size and hash;
   - each entry's `version` matches its own file name;
   - `windows-x64` and `linux-x64` are present, and `automaticUpdates` stays
     `false`;
   - `catalog.json`, `catalog-macos.json` and `catalog-macos-all.json` agree on
     every shared entry.
4. Swap the staged directory atomically and only then serve it.

`isDesktopDownloadCatalog` already encodes the client contract; the release job
reuses it instead of reimplementing the rules.

## Why one job

- A platform cannot be forgotten: its absence fails the release.
- A catalog cannot advertise a missing file, because entries are generated from
  files that exist and were just verified.
- Versions cannot diverge between platforms of the same release.
- Rollback is a directory: the previous release directory stays untouched.

## Migration

1. Land `publish-desktop-downloads.ts` as the interim step; publishing Linux no
   longer needs hand-edited hashes.
2. Move the catalog generation into the release job as described above, keeping
   the same validation and the payload-before-catalog ordering.
3. Delete the interim merge once the generated catalog is the only path.

## Not in scope

- Signing: preview installers stay unsigned and `automaticUpdates` stays off.
- Client code: `desktop-manual-updates` already verifies origin, version, size
  and hash, and continues to work with a generated catalog.
