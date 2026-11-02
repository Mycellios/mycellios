# Apple Silicon Desktop preview

The dedicated workflow builds ARM64 DMG/ZIP files from the hash-pinned published
Desktop 0.3.9 native baseline and its matching source archive. `assemble.mjs`
replaces only the contribution-runtime constructor with the Mac implementation;
all other native behavior and the hosted shared UI are retained. The immutable
input records the original installer, ASAR and native entry hashes.

Run `npm ci` in this directory, `node --test macos-installer.test.mjs`, then
`node assemble.mjs <verified-input-directory> <new-output-directory>`.
The nested Desktop runtime dependencies come from the existing published lock.
On macOS, package with `package-macos.mjs --runtime <PKG> --sha256 <pinned hash>`
from the assembled Desktop directory. Build tools require Node 24; Electron is
pinned independently. Use the local job scheduler for Windows verification.

The runtime is the existing Apple Silicon 0.2.95 package. Enrollment is explicit,
requires a fresh account grant and the native administrator prompt, and reuses
the protected runtime identity. Installation does not create a Windows user,
modify automatic login, enroll a tester, or manufacture contribution Credits.

Unsigned preview: no Developer ID or notarization and no automatic unsigned
updates. A runner launch/installation does not prove real-account sign-in or GPU
inference on the owner's Mac. Physical validation must be recorded separately.
Never offer the download before the workflow's package and launch gates pass.
