# Mycellios browser extension

Opens the hosted Mycellios Agent (`https://www.mycellios.com/agent/app`) in Chrome's side panel.
It is plain Manifest V3 with no build step.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Click the Mycellios icon, or press `Alt+Shift+M`, to open the side panel.

If you are not signed in, the panel opens the normal sign-in page in a tab and loads Agent once
the session exists. Identity pages are never framed.

Open **Appearance** to select **Mycellios**, **White**, **Dark** or **System**. **Discreet mode**
tones down avatars and branding inside the panel. These preferences are stored in Chrome for
this extension and do not change the appearance of regular Agent tabs.

## Share tabs

Off by default. **Share tabs** in the strip asks Chrome for the optional `tabs` permission.
While a Mycellios panel is open, Micos in chats you start from this browser can list the titles
and addresses (origin and path only) of your open tabs with `chrome_tabs`. They cannot read or
use pages yet. Incognito windows are never shared. **Stop sharing**, closing every panel, signing
out or removing the permission in `chrome://extensions` ends it. With panels in several windows
one of them holds the connection (`tabs-bridge.js`, Web Locks) and the others stand by. The
design and later phases are in `specs/agent-chrome-tabs/spec.md`.

## How framing is allowed

The hosted app sends `frame-ancestors 'none'` except for the origins in
`BROWSER_EXTENSION_ORIGINS` (`packages/contracts/src/content-security-policy.ts`). The manifest
`key` pins the unpacked extension ID to `bnbdbnbloaeblmjpoknddcffkmpfhmgg`. The Chrome Web
Store listing uses `nohdakjpcmhfgoaemmhkjkmobhenfcpf`. The hosted app allows both exact origins.

## Chrome Web Store package

Build the upload ZIP from this folder with the manifest's `key` field removed. Keep signing
keys out of the ZIP and the repository. Upload new versions to the existing Store item to
preserve its ID, and raise `version` in the manifest for each new version. Verify the signed-in
panel against the hosted app before publishing.

## Permissions

- `sidePanel`: show Agent beside the page.
- Host access to `https://www.mycellios.com/*`: frame the app with its first-party session, check
  whether you are signed in and connect tab sharing. The extension reads no pages or browsing
  history.
- `tabs` (optional, requested only by **Share tabs**): tab titles and addresses while sharing.
