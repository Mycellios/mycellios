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
and addresses (origin and path only) of your open tabs with `chrome_tabs`, and read a page with
`chrome_snapshot`. Before reading a site this browser has not allowed, the panel asks: **Allow
once**, **Always allow** (Chrome keeps the site access; remove it in `chrome://extensions`) or
**Deny**. Mycellios, the Chrome Web Store and password managers are never read, and the values of
password, payment and hidden fields are left out. Pages are read only when the Mico's model is
your own provider or a contracted Mycellios-managed one. Incognito windows are never shared.
**Stop sharing**, closing every panel, signing out or removing the permission in
`chrome://extensions` ends it. With panels in several windows one of them holds the connection
(`tabs-bridge.js`, Web Locks) and the others stand by. The design and later phases are in
`specs/agent-chrome-tabs/spec.md`.

## Let Micos click and type

A second switch, also off by default and also per browser profile. It asks Chrome for the optional
`downloads` permission and, while it is on, Micos can open pages with `chrome_navigate` and use them
with `chrome_act` (click, fill, type, select, scroll, key), on the same model rule as reading. They
open pages only in new tabs or in tabs they already work in, never in one of your own tabs.

- **Visible work.** A tab a Mico uses joins a Chrome tab group with its name and color, glows in that
  color with its name and shows a cursor that moves to each click. The glow is cosmetic (a page can
  hide it); the tab group and the panel are what a page cannot forge. The Mico stops when you use
  the tab, and its tabs leave the group after 90 s without work, or at **Stop sharing**.
- **Always asked.** The panel asks, in every approval mode and whatever the server says, before a Mico
  types into a password or one-time code field, enters card details, submits a sign-in or opens an
  identity provider's authorization page, and keeps a download. The rules are in `sensitive.js`
  and run here, not on the server. A download that starts while a Mico acts is held (paused) until
  you keep or cancel it; downloads you start yourself are never touched.
- **Real input.** The switch also asks for Chrome's `debugger` permission. With it, clicks, typing and
  keys go through Chrome's own input pipeline, so they count as a person's (`isTrusted`) and sites
  that ignore synthetic events respond. Chrome shows its "started debugging this browser" bar while
  a Mico works in a tab; the extension detaches when the work ends. Without it, the extension falls
  back to synthetic events.
- **Screenshots.** `chrome_screenshot` shows a Mico the tab as an image, without its overlay, for
  models that see images. It is reading the site, so it asks like reading does.
- **Honest results.** A step whose effect cannot be seen is reported as not confirmed, and the run
  stops at the first step that was declined, stale or not confirmed.
- **Stop means stop.** Stop sharing, or turning acting off, answers every open question with "deny".

`node scripts/verify-browser-extension-real.mjs` (from `src/agent`) loads this extension into
Playwright's Chromium and checks the real Chrome APIs against local pages: listing, reading, real
clicks on a button that ignores synthetic ones, typing, screenshots, the tab group and overlay, the
person-first guard, the password, sign-in and payment questions, held downloads, opening pages,
refused sites and the clean-up. It signs in to nothing and runs no model.

Refused everywhere: Mycellios, the Chrome Web Store, password managers, `chrome://` pages and
addresses with embedded credentials.

## Dictation

The composer's dictation uses the microphone permission of this extension, and Chrome cannot show its
permission prompt inside a side panel. Until the microphone is allowed, **Appearance** shows a
**Dictation microphone** row whose button opens `microphone.html` in a tab, where one click asks
Chrome. Nothing is recorded there. This is not yet qualified in a real Chrome side panel.

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
- `scripting`: run the bundled page reader and actions (`page-agent.js`) in a tab. The server never
  sends code.
- `tabGroups`: show the tabs a Mico works in as a named, colored group.
- `downloads` (optional, requested only by **Let Micos click and type**): hold a download that
  starts while a Mico acts until you keep or cancel it.
- `debugger` (optional, requested with `downloads`): real clicks and typing, and screenshots, in
  the tabs a Mico works in. Chrome shows a bar while it is in use.
- Optional site access (`https://*/*`, `http://*/*`): requested one site at a time when you allow
  a Mico to read it.
