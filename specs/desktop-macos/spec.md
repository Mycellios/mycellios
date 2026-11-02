# macOS Desktop previews

Provide separate Intel x64 and Apple Silicon arm64 Desktop downloads for macOS
13 or newer, without changing Windows/Linux/Fedora releases or existing profiles.
Preserve the published native baseline and source hashes. Previews use an ad-hoc
integrity signature, not Developer ID or notarization; updates remain manual.

Verify native architecture, two launches, isolated login UI, strict deep code
signatures and the app inside the final read-only DMG on each Mac architecture.
Report Gatekeeper trust separately from integrity and never remove quarantine or
change system security policy to make qualification pass. Physical Mac/account
inference remains a separate acceptance result.

The available contribution PKG is ARM-only. Intel Desktop supports agents and
project tools but must report contribution unsupported and omit that incompatible
payload. Preserve existing enrolled identities on both architectures.

Keep the default two-package API and the earlier arm64 opt-in route compatible.
The new all-Mac catalog includes both Mac packages with their actual versions and
source archives. The download page retains Fedora and Windows 0.3.10.
