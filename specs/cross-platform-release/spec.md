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

Reference flow inspected: (reference source)
uses native platform jobs, validation before publication and a serialized release
queue. Mycellios retains its current unsigned-preview installation policy.


## Direct delivery and optional contribution components

Desktop discovers the integrated installer-release/1 receipt directly on the owned
GitHub release for every supported package kind. It verifies one source identity,
all five unique platform entries, the requested native receipt and the actual
release asset digest/size before offering a download. Website mirroring and
Android signing retain their existing checks but do not gate Desktop discovery.
Legacy Windows-only releases retain their qualified compatibility reader.

Contribution installers are independent content-addressed release assets. Native
builders still retrieve and hash-verify the pinned original payloads, but package
only a descriptor and the existing privileged helpers. The common publisher
checks and publishes these immutable components before exposing the Desktop
release. Enrollment alone downloads to a private cache, with a strict byte limit,
pinned digest, safe redirects and atomic replacement. Status checks never fetch;
existing enrollment/identity and explicit privileged installation gates remain.
The essential local server, source and development tools remain bundled: removing
these requires a separately qualified offline-development contract.

Qualification: offline feed rejection cases, full verified downloads, component
cache corruption and failed transfer recovery, native packaging resource tests,
existing contribution enrollment tests and workflow/publisher regression gates.
Native packages and physical installation must be qualified separately; local
fixtures alone do not establish a production speed or installation result.
