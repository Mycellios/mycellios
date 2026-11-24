# Micos working in the person's Chrome tabs

Status: proposed design. No product code changes with this spec.

## Existing behavior and goal

`src/agent/apps/browser-extension` (shipped with Agent 0.22.0, unpacked only, not
yet in the Chrome Web Store) is a plain Manifest V3 extension with no build step.
It frames `https://www.mycellios.com/agent/app` in Chrome's side panel using the
browser's existing first-party session (`sidepanel.js` checks
`/agent/api/auth/get-session` and sends the person to a normal tab to sign in).
Its only permission is `sidePanel` plus host access to `https://www.mycellios.com/*`,
and its README promises that it reads no tabs, pages or history. The hosted app
allows that framing only for `BROWSER_EXTENSION_ORIGINS` in
`src/agent/packages/contracts/src/content-security-policy.ts`, whose ID the
manifest `key` pins.

Micos already browse, but never in the person's own browser:

- `browser_navigate` / `browser_snapshot` / `browser_act`
  (`packages/adapters/src/builtin-tools.ts`, `browser-tools.ts`) drive the Chromium
  of the Mico's own Docker computer over CDP through the page-browser helper in
  `src/agent/infra/sandboxes/computer`, with one tab per conversation,
  refs built in an isolated world and saved logins typed by `fill_secret`.
  Because that computer belongs to the Mico, these tools are approval-exempt
  (`APPROVAL_EXEMPT_TOOLS` in `packages/core/src/action-approval.ts`).
- `web_fetch` and `read_video` ask per site through `SITE_FETCH_TOOL_NAMES`
  (`packages/core/src/egress.ts`) and `outboundSiteGate`/`planActionGate`.
- `pc_windows` / `pc_snapshot` / `pc_act` (specs/desktop-accessibility-control)
  operate the person's desktop apps only through Desktop, behind a separate native
  opt-in, never in routines, webhooks, channels, isolated or project runs, and
  `pc_act` always needs approval.
- The Desktop project browser (specs/project-browser) gives untrusted pages no
  application bridge, account cookies or credentials.
- The Desktop relay (`apps/api/src/desktop-relay.ts`,
  `packages/adapters/src/desktop-relay.ts`, `src/contracts/desktop-executor.ts`)
  reaches a host capability owned by the same user/Space/session through an
  authenticated long poll, bounded operations, and no replay of uncertain work.

Goal: with the person's explicit, revocable consent, a Mico in a chat the person
started from that browser can see the person's open tabs, read a tab's page and
act in it (click, type, navigate), visibly and with mandatory confirmations for
new sites, passwords, payment details, downloads and sign-ins.

Behavior reference: the public change description of a comparable third-party
Chrome extension (behavior only; its code is under a noncommercial license and
none of it is read or copied).

## User story

A person opens the Mycellios side panel in Chrome and turns on **Share tabs**, then
writes to their Mico: "compare the three laptops I have open and add the cheapest
to the cart". The Mico lists the open tabs (titles and addresses), asks in the
side panel before reading the first shop it has not used, reads the three pages,
and clicks *Add to cart*. While it works, the tab sits in a colored tab group
named after the Mico, glows with its name, and a cursor moves to each click.
When the checkout asks for card details, the side panel asks the person, who
declines and finishes the payment themselves. They press **Stop sharing** and
the Mico can no longer see or touch any tab.

## Scope and non-goals

In scope: tab listing, page reading, ordinary page actions, visible working
indicators, browser consent prompts, Stop sharing, failure behavior, the
extension/server channel, Chrome Web Store implications, and a phased plan.

Non-goals:

- Routines, webhooks, messaging channels, side tasks, subagents, background
  triggers (`isBackgroundRunTrigger`: tickets, project_prepare), group chats and
  Desktop-executed runs (`agentExecution`). Tabs are never used unattended.
- Incognito windows, other Chrome profiles and other people's browsers.
- Typing saved logins (`fill_secret`), file uploads from the Mico's computer and
  screenshots (`chrome.tabs.captureVisibleTab`) in the first phases.
- `chrome.debugger` (CDP) in the person's browser.
- Replacing the Docker page browser, `web_fetch` or the Desktop project browser.
- The X (Twitter) reply desk from the reference: Mycellios has no product inbox
  for social mentions and it is unrelated to working in tabs.
- Changing the existing sign-in model of the extension.

## Architecture

### Components

1. **Extension (`src/agent/apps/browser-extension`)**: still plain MV3 without a
   build step. New files: `tabs-bridge.js` (channel, op dispatch), `page-agent.js`
   (content script: snapshot, refs, actions, overlay), `sensitive.js` (pure field
   and site classifiers plus bundled refusal/identity-provider/payment-origin
   lists), and an extension-owned strip in `sidepanel.html` above the Agent
   iframe for the share switch, the sharing indicator and consent prompts.
2. **Contract (`src/contracts/browser-tabs-bridge.ts`)**: strict parsers for the
   registration, poll, operation, result and consent messages, beside
   `desktop-executor.ts`. The extension cannot import TypeScript, so a contract
   test feeds the extension's real message fixtures through these parsers.
3. **Broker (`packages/adapters/src/browser-tabs-relay.ts`)**: a sibling of
   `DesktopRelayBroker` with the same lease, bounded queues, per-owner keying,
   lost-delivery and no-replay rules, keyed by `(userId, spaceId, sessionKey)`
   instead of a device binding.
4. **API (`apps/api/src/browser-tabs-relay.ts`)**: fixed routes
   `/api/browser-tabs/:action` (`register`, `poll`, `result`, `consent`,
   `release`, `revoke`) for the extension and a signed
   `/api/browser-tabs/internal` for the worker, mounted like `mountDesktopRelay`.
5. **Tools and executor (`packages/adapters/src/chrome-tabs.ts`,
   `builtin-tools.ts`, `executor.ts`)**: the new tools, gating next to
   `appControlAllowed`, approval wiring and result formatting.

### Channel: extension to server

- The bridge runs in the side panel document, not the service worker. Sharing
  is present only while a Mycellios side panel is open in that browser profile.
  This makes the indicator visible whenever tabs are shared, keeps the consent
  UI on screen, and avoids MV3 service-worker lifetime limits. When panels are
  open in several windows, `navigator.locks` (one lock per extension origin)
  lets exactly one panel document hold the connection; the others stand by.
- Authentication reuses the browser's first-party Mycellios session cookie, as
  `sidepanel.js` already does. The extension stores no token. Every bridge route
  requires `Origin` to be exactly one of `BROWSER_EXTENSION_ORIGINS` and the
  header `x-mycellios-extension: 1`, and the API sends no CORS grant for them.
  A page on www.mycellios.com, including an XSS in the hosted app, cannot forge
  that origin; another extension carries its own origin and is refused. This
  mirrors the `x-mycellios-desktop` / no-`Origin` rule of the Desktop relay.
- `register` carries `{generation (uuid per panel connection), capabilities
  {tabs:1, read:1|absent, act:1|absent}}`. The API derives the owner from the
  session: `userId`, the session's active `spaceId`, and
  `sessionKey = sha256(sessionId)` (as the Desktop relay derives
  `connectionId`). Each long `poll` re-authenticates before delivery; a changed
  user, Space or session revokes the registration, as `waitPoll` does today.
- Operations and results are JSON data only, bounded (operation bodies ≤ 64 KiB,
  result chunks ≤ 350,000 characters as `parseDesktopResult`, a whole snapshot ≤
  48 KiB of text before truncation with a `truncated` flag), with at most 4
  concurrent operations per registration and one per tab.
- The worker reaches the broker through `/api/browser-tabs/internal`, signed with
  an HMAC key derived from the existing relay secret under a distinct label
  (`mycellios-browser-tabs-v1`) plus nonce replay protection, like
  `/api/desktop-relay/internal`. As with the Desktop relay, a single API instance
  owns the volatile broker; an API restart fails in-flight operations and never
  replays them.

### How a run reaches the right browser

- The browser that asks is the browser that shares. When the API creates a run
  from an owner-sent message, it records `runs.browser_session_key`
  (`sha256(sessionId)` of the authenticated sender, nullable, additive migration
  applied by the migration owner). Approval and takeover continuations keep the
  run's value; a new user turn records its own sender.
- A message sent from the side panel or any www.mycellios.com tab of the same
  Chrome profile shares the session, so it matches; a message from a phone,
  Desktop or another profile does not, and that run never sees these tabs.
- At tool-offer time and again before each operation, the broker must hold a
  live registration with the same `userId`, `spaceId` (= `run.spaceId`) and
  `sessionKey`, advertising the needed capability. Otherwise the tools are not
  offered, or the call fails as `chrome_not_shared` (settled, not uncertain).

### Chrome APIs and permissions

| Need | API / permission | Install-time? | Store warning |
| --- | --- | --- | --- |
| Side panel (today) | `sidePanel` | required | none |
| Tab titles and addresses | `tabs` | **optional**, requested when Share tabs is turned on | "Read your browsing history" |
| Read and act in a page | `scripting` + per-origin host access from `optional_host_permissions: ["https://*/*", "http://*/*"]` | `scripting` required (no warning), origins optional, requested per site at the new-site prompt | "Read and change your data on <site>" at grant |
| Working-tab group | `tabGroups` | required | none |
| Download confirmation | `downloads` | **optional**, requested in phase 4 | "Manage your downloads" |
| Trusted input / AX tree | `debugger` | **not used** | "Access the page debugger backend" plus a persistent infobar |

- Content script injection uses `chrome.scripting.executeScript` with bundled
  `files` or bundled functions with JSON arguments only. The server never sends
  code; MV3 forbids remotely hosted code and the review would reject it.
- The page script runs in the extension's isolated world. Refs live in an
  in-memory map of that world (not as DOM attributes), so a page cannot move a
  ref to redirect a click. The script accepts no `window.postMessage` input from
  the page. The manifest adds no `externally_connectable` and no
  `web_accessible_resources`, so pages and the framed hosted app cannot call the
  extension, and the overlay cannot be used to fingerprint it.
- Per-origin grants are requested with `chrome.permissions.request` from the
  extension-owned consent button (a user gesture in an extension page). The
  person can review and remove granted sites in `chrome://extensions`; the
  extension reads `chrome.permissions.getAll` instead of keeping its own copy.
- Without `debugger`, actions dispatch DOM events (`isTrusted: false`) and set
  values through native setters plus `input`/`change` events. Some sites ignore
  them; the result then says the action was not confirmed (as `pc_act` reports
  `not_verified`), and the Mico asks the person to do that step.

### Chrome Web Store review implications

- Keeping `tabs`, host access and `downloads` optional avoids the disable-on-
  update prompt for existing installs and the in-depth review that broad
  install-time host access triggers, and keeps today's install promise true
  until the person turns sharing on.
- Single purpose: "Mycellios Agent in the side panel, optionally working in your
  tabs with your consent". The listing must declare "Web history" and "Website
  content" in the privacy practices, link a privacy policy that says page text
  goes to the Mico's model provider, and certify Limited Use.
- The Store package keeps the pinned ID (README "Chrome Web Store package"). If
  the Store assigns another ID, add its origin to `BROWSER_EXTENSION_ORIGINS`
  and deploy before publishing, now also for the bridge routes.

## Consent model

- **Off by default, per browser profile.** The strip shows **Share tabs**.
  Turning it on requests the optional `tabs` permission and explains: Micos in
  chats you start from this browser can see your tabs' titles and addresses;
  reading or acting on a site asks first; passwords, payment details, downloads
  and sign-ins always ask. The choice persists in `chrome.storage.local` but the
  bridge connects only while a panel is open.
- **Indicator.** While sharing: the strip reads "Sharing tabs · Stop sharing",
  the action badge shows a dot, and any tab a Mico uses is in its tab group.
- **Stop sharing.** One click: closes the connection, calls `revoke`, fails
  in-flight operations as `chrome_not_shared`, rejects pending consents, removes
  overlays and ungroups the person's own tabs (tabs the Mico opened stay open in
  their group; the extension never closes the person's tabs). Signing out,
  switching account or Space, or closing every panel has the same effect after
  the presence lease (90 s like `LEASE_MS`), immediately on `release`.
- **Which runs.** Tools are offered only when all hold: `isOwnerStartedRun`
  (user message, owner follow-up or call end) and not
  `isMessagingChannelRun`; not a routine conversation, webhook, background
  trigger, isolated project run, project session, subagent, side task
  (`start_task` threads, `thread.taskBotId`) or group thread (`thread.groupId`);
  the run is cloud-executed; `runs.browser_session_key` matches a live
  registration; and the Mico has not disabled the tools.
- **Site use.** Listing tabs needs only sharing. Reading or acting on a site is
  "using" it. A site is pre-consented for this run when the owner named it in
  the run's own words (`sitesInText` of the owner words, as `loadTrustedSites`)
  or when the person chose "Always allow this site in this browser". Anything
  else gets a **new-site** prompt in the strip, which is also where Chrome's own
  per-origin permission prompt appears. Server `site` rules may only tighten:
  a `deny` site rule blocks `chrome_*` on that site; an `always_allow` site rule
  made for `web_fetch` does not pre-consent the logged-in browser.
- **Refused targets** (checked in the extension before any script runs and again
  server-side for navigation): Mycellios origins (the app, identity and API, so a
  Mico cannot approve its own cards or touch the session), `chrome://`,
  `edge://`, `about:`, `chrome-extension://`, the Web Store, `file:`, `data:`,
  `view-source:`, DevTools, and a bundled list of password-manager vaults,
  matching `pc_act`'s refusal of Mycellios and credential managers.

## Tool surface

New builtin tools, added to `BUILTIN_TOOL_NAMES`
(`packages/contracts/src/builtin-tools.ts`) so a Mico can disable them. They keep
the `browser_*` result shapes and act kinds so models and skills transfer, but
use their own names because their approval semantics differ: `browser_*` are
approval-exempt for the Mico's own computer, and reusing those names would leak
that exemption to the person's browser. Descriptions tell the model that
`browser_*` is its own computer and `chrome_*` is the person's Chrome with the
person's sign-ins.

| Tool | Input | Effect | Approval mapping |
| --- | --- | --- | --- |
| `chrome_tabs` | none | ≤ 50 non-incognito tabs, the focused window's active tab first: opaque tab handle, title (≤ 200 chars), address (origin + path; query and fragment dropped), active, audible, `working` (in this Mico's group) | read-only, approval-exempt, never unattended-safe |
| `chrome_snapshot` | `tab` | Same accessibility-style snapshot and refs as `browser_snapshot`; URL with credential-like query values redacted | read-only; requires site use consent |
| `chrome_navigate` | `url`, `tab` or `new_tab: true` | Open an http(s) URL (no embedded credentials, as `browserNavigateFromTool`); an existing tab only if it is already a working tab | consequential |
| `chrome_act` | `tab`, `actions[]` (`click`, `fill`, `type`, `select`, `scroll`, `key`) by ref, ≤ 24 like `MAX_BROWSER_ACTIONS` | Act in the page | consequential |

- All four results taint the run (`toolResultTaintsRun` default): titles,
  addresses and page text are untrusted data that can carry injected text.
- `chrome_navigate` and `chrome_act` join `APPROVAL_REQUIRED_BUILTIN_TOOLS` like
  `pc_act`, so the existing approval mode decides ordinary actions: Ask shows the
  existing approval card, Auto lets Auto Review judge on the owner's words, and
  Never ask runs them. Rule resolution for these tools ignores `site` allow rules
  (see Site use) and applies `deny` site rules first.
- Approval cards and Auto Review show the site, tab title, action and the
  element's accessible name labelled as page-provided text, plus the text the
  Mico wants to type. Auto Review keeps seeing no tool results.
- `context-pruning.ts` prunes old `chrome_snapshot` results like
  `browser_snapshot`.
- `upload`, `fill_secret` and pixel actions are not offered. For 2FA, CAPTCHA,
  passkeys or any step the Mico should not do, it calls `request_takeover`; for
  a Chrome tab, the card's **Open** focuses that tab and window instead of
  opening a computer view, and Continue resumes through the existing path.
- **Person first.** If the person used a working tab with trusted input in the
  last 3 seconds, or the tab is focused and receiving input, `chrome_act` returns
  `person_active` (settled) and the Mico waits or asks, as an active control
  lease blocks `pc_act`.
- **Tab ownership.** A tab belongs to at most one run at a time; another run gets
  `tab_busy`. The Mico can close only tabs it opened.

### Working indicators

- **Tab group.** The first use of a tab adds it to the Mico's group in that
  window (`chrome.tabs.group` + `chrome.tabGroups.update`): title is the Mico's
  name (sanitized, ≤ 32 characters), color is a stable hash of the bot id over
  Chrome's fixed palette. When the run ends, the person's own tabs leave the
  group; tabs the Mico opened stay grouped until the person closes them.
- **Glow, name and cursor.** `page-agent.js` adds a closed shadow-root host with
  `pointer-events: none`: a flat border in the group color, the Mico's name, and
  a cursor that moves to each click target before the click. It is excluded
  from snapshots, removed at run end, Stop sharing and navigation, honors
  `prefers-reduced-motion`, and uses flat colors (no gradients). A page can hide
  it, so it is cosmetic; the tab group and the strip are the indicators that
  pages cannot forge.

## Mandatory confirmations (browser consent)

These are browser consent, not approval-mode decisions. `planActionGate`
documents that Never ask "does not override ... native computer consent"; these
prompts follow that rule. They ask in every mode, cannot be allowed by Auto
Review or the model, and only new-site has an "always allow in this browser"
choice. They are enforced by the extension, so a compromised server, the framed
app or an injected page cannot skip them.

| Class | Detected by `sensitive.js` when | Choices |
| --- | --- | --- |
| New site | reading or acting on a site not pre-consented for the run | Allow once, Always allow in this browser, Deny |
| Password | `fill`/`type` into `type=password` or autocomplete `current-password`, `new-password`, `one-time-code` | Allow once, Deny |
| Payment details | `fill`/`type` into autocomplete `cc-*`, card/CVC/IBAN-like fields, or into a frame from a bundled payment-provider origin; a submit in a form containing them | Allow once, Deny |
| Sign-in | a click that submits a form with a password field; a click on a bundled identity-provider origin (OAuth/SSO consent) or navigation to an authorize URL with `client_id` | Allow once, Deny |
| Download | a download created while a Mico action runs in a working tab (phase 4, `chrome.downloads.onCreated` then `pause`) | Keep, Cancel |

Flow, reusing the existing waiting and continuation path:

1. The extension classifies the operation before executing it. A sensitive one
   returns `{status: "needs_consent", consentId, class, site, label}` without
   acting.
2. The executor puts the run in `waiting_takeover` with a needs-you card
   "Confirm in Chrome: …" whose action focuses the tab. The card cannot answer;
   it reports state. The strip in that browser shows the prompt, armed only
   after it has been visible for 500 ms to resist click-through.
3. The person's answer is posted by the extension to `/api/browser-tabs/consent`
   bound to `runId`, lease fence, `consentId` and the operation digest. Only
   the extension origin is accepted (see Channel). The API resolves the wait
   and continues the run through the existing checkpoint continuation.
4. The continuation re-dispatches the same operation with the `consentId`. The
   extension accepts it once, only if the target element, site and class still
   match; otherwise it returns `consent_stale` and nothing runs. Deny returns a
   settled "the person declined" result.
5. Downloads are asynchronous: the click's result says a download is paused for
   the person's decision; Keep resumes it, Cancel cancels and erases it. The
   Mico never gets file access to the person's downloads.

Classifiers are heuristics and a floor, not a guarantee. A field they cannot
classify inside a cross-origin frame without host access is treated as payment.

## Data handling

- Page text, titles and addresses are untrusted data. They enter only the run's
  tool results, with the existing conversation retention, and taint the run so
  later new destinations and connector reads follow the existing taint rules.
- No cookies or credentials leave the browser: no `cookies` permission; the page
  script never reads `document.cookie`, `localStorage`, `sessionStorage` or
  IndexedDB; snapshots omit values of password, payment, one-time-code and
  hidden fields; tab addresses drop query and fragment; snapshot URLs redact
  credential-like query parameters (`token`, `code`, `key`, `secret`, `session`,
  `auth`, `sig`, `password` and similar).
- Logs, diagnostics and telemetry carry only operation ids, codes, capability
  versions and sizes. Never titles, URLs, sites, page text, typed text or
  consent labels. Broker warnings follow `desktop.relay.*` reason codes.
- Page content goes to the Mico's model route. Routes served by third-party
  sellers or contributor nodes see it like any other prompt; the share consent
  must say so (see Open questions).
- Nothing from the tabs is written to memory, shared memory, skills or
  artifacts unless the Mico does so through those tools under their own rules.

## Failure and offline behavior

- Not sharing at run start: the tools are not offered; the Mico can say that
  sharing is off.
- Sharing stops, panel closes, session changes: in-flight and later calls fail
  as `chrome_not_shared` (settled). Pending consents are rejected.
- Lost delivery after an operation was handed to the extension: the result is
  uncertain ("Check the tab before retrying"), never replayed, as
  `LOST_DELIVERY` in the Desktop relay. API restarts behave the same.
- Tab closed or navigated: `tab_gone`; refs from an older document: `STALE_REF`,
  requiring a new snapshot. Busy: `tab_busy`, `chrome_busy` (op caps reached).
- Site cannot be scripted (refused list, Web Store, missing host grant after the
  person removed it): settled refusal with the reason.
- An action whose effect cannot be confirmed is reported as not confirmed, never
  as done.
- An older extension without the capability, or an older server, keeps today's
  side-panel-only behavior; the server offers tools only for advertised
  capability versions.

## Security review list

1. Bridge routes accept only the exact extension origins and header; no CORS;
   session re-checked on every poll; Space/session change revokes.
2. The hosted app framed in the panel cannot reach extension APIs (no
   `externally_connectable`, no trusted `postMessage`) and cannot answer consent.
3. No remote code: operations are JSON, injected scripts are bundled.
4. Refs in the isolated world; no page-controlled ref resolution; no page
   messages accepted by the content script.
5. Mycellios origins, browser-internal pages and vaults refused before
   injection and on navigation (including redirects observed after navigation).
6. Sensitive classifiers run in the extension at execution time; `consentId` is
   single-use and bound to run, fence, digest and target.
7. Never ask, Auto Review, `always_allow` rules and model text cannot bypass
   browser consent.
8. Taint, prompt-injection labelling in approval cards and Auto Review inputs.
9. No cookies, storage or secret field values read; URL redaction; log scrubbing.
10. Gating excludes every unattended, channel, background, subagent, side task,
    group and Desktop-executed run; tests cover each trigger.
11. Bounded sizes, concurrency, lease and deadlines; no replay of uncertain work.
12. Store disclosures, optional permissions and the privacy policy match the code.
13. Overlay is cosmetic, flat, reduced-motion aware and never trusted.
14. Incognito and other profiles excluded (the manifest sets `"incognito": "not_allowed"`;
    tabs with `incognito: true` are filtered anyway).

## Phased plan

Each phase is shippable alone and keeps older clients working.

1. **Sharing and tab list.** Strip with Share tabs/Stop sharing, optional `tabs`
   permission, Web Locks leader, contract, broker, API routes, the
   `browser_session_key` migration, `chrome_tabs`, run gating.
   Verify: contract parser tests over extension fixtures; broker lease/revoke/
   no-replay tests; API origin/header/session-change tests; executor gating
   tests for every trigger kind; isolated PostgreSQL check of the additive
   migration; a Chromium `--load-extension` fixture script
   (`scripts/verify-browser-extension-tabs.mjs`) that shares, lists tabs and
   stops sharing against local fixture pages.
2. **Read pages.** `page-agent.js` snapshot with isolated-world refs and
   redaction, `scripting`, per-origin grants via the new-site prompt, refusal
   list, `chrome_snapshot`, tab groups, pruning.
   Verify: classifier/redaction unit tests; a shared fixture suite that checks
   `chrome_snapshot` and the Docker helper produce the same ref format and
   redaction on the same pages; the extension fixture for consent, denial and
   always-allow; a page that tries to move refs or post messages.
3. **Act.** `chrome_navigate`, `chrome_act`, approval mapping, overlay and cursor,
   person-first guard, password/payment/sign-in consent through the waiting
   state and `consent` route, takeover Open for Chrome tabs.
   Verify: action-approval and executor approval tests (Ask/Auto/Never, deny
   site rule, web_fetch allow rule not applying); consent binding and
   `consent_stale`; extension fixture with login, checkout and OAuth pages;
   Never ask still prompting.
4. **Downloads.** Optional `downloads`, pause/keep/cancel.
   Verify: fixture download held, kept and cancelled; owner downloads outside a
   Mico action untouched.
5. **Store listing.** Package without `key`, disclosures, privacy policy, Store
   ID in `BROWSER_EXTENSION_ORIGINS`, review.
   Verify: the built ZIP's manifest and permission set; review outcome recorded
   separately.

Side item, independent of tabs: qualify the existing composer dictation inside
the side panel (the iframe already allows `microphone`). If Chrome cannot show
the microphone prompt in a side panel, add a one-time extension tab that
requests it. Do not add a new transcription route.

Qualification: fixtures and `--load-extension` runs do not qualify the feature.
Report separately a real Chrome stable session on Windows and on a Mac with a
real Mico completing a consented task, and the Store review result. When
implemented, add the durable rules to `src/agent/AGENTS.md` next to PC app
control and fold the outcome into canonical docs.

## Open questions for the owner

1. **Model routes.** Should page text and actions be allowed when the run's model
   is served by unidentified third parties (the default free AntSeed route, the
   contributor network)? Recommendation: allow `chrome_tabs` everywhere, and
   allow page reading/acting only on the person's own providers or contracted
   managed providers until decided, saying so in the share consent.
2. **Sharing default.** Off by default per browser (this spec) or on by default
   as in the reference?
3. **Panel-closed sharing.** Keep presence tied to an open side panel, or allow a
   service-worker WebSocket so Micos keep working with the panel closed?
4. **Never ask and ordinary actions.** Confirm that Never ask runs ordinary
   `chrome_act` without cards (the four consent classes still ask).
5. **`chrome.debugger`.** Ever acceptable as an opt-in per action for sites that
   ignore synthetic events, given the infobar and Store review?
6. **Saved logins.** Keep `fill_secret` out of Chrome tabs (the person signs in),
   or allow it with the sign-in consent?
7. **Desktop-executed runs and group chats.** Add them later, or keep them out?
8. **Screenshots for vision models.** Add `captureVisibleTab` later?
9. **Other Chromium browsers.** Publish the same package for Edge Add-ons?
