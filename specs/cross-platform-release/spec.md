# One source revision for platform installers

The release owns one integrated main revision and the Desktop version. Native
Windows, Linux, Apple Silicon and Intel Mac runners build that revision; Android
packages its shared web source with its own increasing versionCode. Old native
runtime payloads remain independently pinned, never substituted for current UI
or Desktop source. Intel Mac never receives the ARM contribution installer.

A successful main validation starts release admission automatically. Already
published versions are immutable. Build, packaged startup, platform signature
integrity and update/preservation checks precede publication. Failure retains the
previous platform pointers. Publishing and catalog promotion serialize without
cancelling active work and reject stale or mismatched source receipts.

The public download catalog advances automatically from verified release metadata,
with exact hashes, sizes, source identity and rollback. Android signing preserves
the existing certificate on its current host. Windows stays unsigned until the
owner enables signing; automatic release publishing never enables unattended
installation on a user's computer.

Qualification uses native runner evidence plus real public download checks.
Physical device installs remain a distinct check and are never inferred from CI.

## Release operation

Merge one Desktop version bump and its workspace lock update after required
validation. Do not dispatch separate OS promotions. The automatic workflow builds
the current main revision and the host timer discovers its qualified publish job
within five minutes. The final workflow job waits for public catalogs and all six
actual download routes. Android versions and increasing versionCode derive from
the Desktop version; no second manual mobile version update is required.

The old Windows-only publisher is emergency recovery tooling. It requires an
explicit recovery input and the owner-controlled
`MYCELLIOS_LEGACY_WINDOWS_ONLY_RELEASE=true` repository variable; the normal path
keeps that variable unset. Existing build and qualification workflows remain usable.

The server configuration contains paths and pinned public tool/signing hashes,
never the Android private key or password. The existing key stays on its original
host. Install the reviewed publisher, service and timer after qualification; keep
the previous service/config and all installer/certificate identities for rollback.

Reference flow inspected: https://github.com/nightly-labs/openbot/blob/main/.github/workflows/release.yml
uses native platform jobs, validation before publication and a serialized release
queue. Mycellios retains its current unsigned-preview installation policy.
