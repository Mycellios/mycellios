# Mycellios browser extension

Opens the hosted Mycellios Agent (`https://www.mycellios.com/agent/app`) in Chrome's side panel.
It is plain Manifest V3 with no build step.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Click the Mycellios icon, or press `Alt+Shift+M`, to open the side panel.

If you are not signed in, the panel opens the normal sign-in page in a tab and loads Agent once
the session exists. Identity pages are never framed.

## How framing is allowed

The hosted app sends `frame-ancestors 'none'` except for the origins in
`BROWSER_EXTENSION_ORIGINS` (`packages/contracts/src/content-security-policy.ts`). The manifest
`key` pins the extension ID that origin names, so an unpacked copy and future builds keep the same
ID. Only the public key is in the repository. A Chrome Web Store listing gets its own ID, which
must be added to that list before the listed build can open the app.

## Chrome Web Store package

The Store refuses a manifest with a `key` field. Build the upload ZIP from this folder with the
`key` field removed and the extension's private key at the ZIP root as `key.pem`, so the first
upload keeps the ID that `BROWSER_EXTENSION_ORIGINS` names. The private key never goes into the
repository. If the Store assigns a different ID anyway, add that origin to the list and deploy
before publishing the listing. Raise `version` in the manifest for each upload.

## Permissions

- `sidePanel`: show Agent beside the page.
- Host access to `https://www.mycellios.com/*`: frame the app with its first-party session and check
  whether you are signed in. The extension reads no tabs, pages or browsing history.
