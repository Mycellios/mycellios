# Desktop release: Linux and macOS packages in the publish pipeline (2026-11-11)

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
# Publisher signing for Windows

The pipeline is prepared, but a public-trust identity has not been provisioned.
Existing 0.3.46 bytes remain an unsigned preview; do not replace that release or
describe it as signed. Publish a new version only after a real signing run passes.

The default `desktop-windows-release.yml` path requires a publisher signature and
fails before dependency installation if its configuration is missing. The explicit
manual `signing=unsigned-preview` input is the only CI exception. Promotion requires
a signature by default too; `allow_unsigned_preview=true` is a separate deliberate
manual exception. Automatic installation remains disabled in both cases.

## Provisioning the publisher

This follows OpenBot's Azure Artifact Signing design: OIDC login restricted to a
signing stage, `win.azureSignOptions`, `forceCodeSigning`, SHA256/RFC3161 timestamp,
then logout. Our identity and resources must be issued to our own legal publisher.
Never copy OpenBot's publisher name, tenant, signing account or certificate profile.

Before creating a paid service or granting a new signing identity, obtain the
owner's approval for that concrete cost and narrowly scoped access. A valid CA
identity is external approval, not something a self-signed certificate can replace.

Create a GitHub environment `windows-signing` restricted to main and the owned
Desktop release tags, with owner review for production signing. Preview runs use
the separate `windows-preview` environment. Do not provision an Azure federation
until those environment restrictions are verified. Configure an Entra identity
whose only signing role is **Artifact Signing Certificate Profile Signer**, scoped
to the one Public Trust certificate profile. Its federated subject is
`repo:Mycellios/mycellios:environment:windows-signing`, audience
`api://AzureADTokenExchange`; adapt only after checking the repository's actual
OIDC subject configuration. Do not grant subscription-wide Contributor/Owner or
store a long-lived client secret/private signing key in GitHub.

Set repository variables (all public identifiers, not private keys), so both
build and promotion resolve the same publisher before a job starts:

| Variable | Value |
| --- | --- |
| `WINDOWS_SIGNING_PROVIDER` | `azure` |
| `WINDOWS_SIGNING_PUBLISHER` | Exact certificate CN of the validated legal entity |
| `WINDOWS_SIGNING_CLIENT_ID` | Scoped Entra application's client ID |
| `WINDOWS_SIGNING_TENANT_ID` | Its tenant ID |
| `WINDOWS_SIGNING_SUBSCRIPTION_ID` | Subscription containing the signing account |
| `WINDOWS_SIGNING_ENDPOINT` | Matching region's HTTPS `*.codesigning.azure.net/` endpoint |
| `WINDOWS_SIGNING_ACCOUNT` | Our own signing account |
| `WINDOWS_SIGNING_PROFILE` | Our own validated Public Trust profile |

An existing CA/HSM identity exposed through the runner's Windows certificate store
can instead use provider `certificate-store` and `WINDOWS_SIGNING_CERTIFICATE_SHA1`.
That is a certificate selector, not SHA1 file signing: file and timestamp digests
remain SHA256. The runner must already have approved access to that exact private
key; GitHub-hosted runners do not acquire a certificate merely from this variable.
Do not import a self-signed root or disable Windows trust checks to qualify it.

## Qualification and publication

electron-builder signs the app, applicable EXE payloads, NSIS installer and
uninstaller. Native DLL/NODE vendor signing and the pinned runtime MSI are not
silently rewritten. `verify-windows-signature.ps1` checks Windows trust and a
timestamp, requires the exact publisher for our app and installer, and records
other trusted EXE payload publishers. `windows-signature.json` binds those
observations to SHA256 hashes. Final installer hashing, blockmap generation,
startup qualification and release metadata happen after signing. Promotion
rechecks the downloaded installer on Windows without access to a signing key.
Signing failure, wrong publisher, absent timestamp or changed bytes block release.

The narrow `Windows publisher qualification` workflow uses an existing official
Node executable only as a verification fixture. It tests valid vendor trust,
wrong publisher, tampering and unsigned rejection; it signs no Mycellios file and
does not qualify an unprovisioned publisher. A real CA-backed Mycellios signing run
and physical update remain required before declaring activation complete.

The custom manual updater retains its existing catalog/hash/owner/Attachment
Services safeguards. This change does not enable the automatic-install channel.
Keep the same legal publisher across updates; rotate certificates under that
identity, and separately qualify a migration before changing the legal name.

## Cost and eligibility researched on 2026-11-12

- OpenBot documents Azure Artifact Signing. Microsoft lists approximately
  US$9.99/month and requires identity validation. Check current regional pricing
  before purchase; creating an account starts billing. Andorra is not in the
  current Public Trust organization's eligibility list; do not substitute a false
  address or assume a Spanish email/identity establishes eligible residency.
- SignPath Foundation offers free signing to accepted open-source projects,
  subject to its review and technical conditions. Its foundation becomes the
  certificate publisher. Approval is not established for Mycellios; review the
  pinned native MSI/dependencies against the no-proprietary-components rule
  before claiming eligibility or submitting a request.
- Certum advertises an open-source cloud option from EUR49. Confirm term, taxes,
  entity eligibility and unattended CI/HSM access before treating that headline
  price as the total annual cost.
- A trusted signature removes the unknown-publisher cause. SmartScreen can still
  warn about a new release while reputation builds, including OpenBot releases.

Sources: [OpenBot release design](https://github.com/nightly-labs/openbot/blob/main/docs/RELEASING.md),
[Microsoft setup/eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[Microsoft signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options),
[Azure billing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/),
[SignPath conditions](https://signpath.org/terms.html),
[Certum prices](https://shop.certum.eu/buy-a-code-signing-certyficate).
