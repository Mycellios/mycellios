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
