# Complete the Mico's own browser

Status: proposed design. No product code changes with this spec.

This spec covers the Mico's own browser: the Chromium on its computer that
`browser_navigate`, `browser_snapshot` and `browser_act` drive. The person's
Chrome belongs to `specs/agent-chrome-tabs/spec.md` (`chrome_*` tools, attended
runs only); this spec does not change it and keeps the same ref format where both
apply. Handoff (`specs/mico-browser-handoff`), Close browser sessions
(`specs/mico-browser-reset`) and the person's project browser
(`specs/project-browser`) keep their behavior.

## Existing behavior

- Three tools (`packages/adapters/src/builtin-tools.ts`, parsed in
  `browser-tools.ts`): `browser_navigate` opens an http(s) URL without embedded
  credentials and returns its URL and title; `browser_snapshot` returns the page
  text (at most 12,000 characters) and the first 80 visible controls with refs;
  `browser_act` runs up to 24 steps of `click`, `fill`, `type`, `upload` (10 files,
  100 MB) and `fill_secret`, and `fill` also sets a `<select>`. They are
  approval-exempt because the computer is the Mico's (`APPROVAL_EXEMPT_TOOLS` in
  `packages/core/src/action-approval.ts`); old snapshots are pruned
  (`context-pruning.ts`).
- The page-browser helper in `infra/sandboxes/computer` (stdlib Python over
  CDP) keeps one tab per conversation (`scoped_target`, one mapping file per
  conversation key), serializes whole commands under a display lock, builds refs
  in an isolated world and refuses stale refs. A snapshot waits up to 3 s for load
  and network idle and otherwise reports `loading`.
- Not in the helper: named keys (`type` sends printable characters and a newline
  as Shift+Enter, so there is no plain Enter, Tab or Escape), scroll, hover, wait
  conditions, JavaScript dialogs, popups or other tabs (only the saved target is
  reachable), frames ("Embedded frames require desktop tools."), downloads (a
  navigation that starts one is refused), page images, scripts and viewport or
  locale emulation. Each falls back to `computer_act` or a takeover.
- Each Mico has its own Chromium profile per computer, so sign-ins persist
  between conversations, and Close browser sessions deletes them. `fill_secret`
  types a saved login only on its saved origin. 2FA, CAPTCHA and passkeys go to
  `request_takeover`, whose Open shows only that conversation's tab.
- Page tools need a graphical server computer whose provider implements
  `pageBrowser` (`pageBrowserAllowed` in `packages/adapters/src/executor.ts`); only
  `docker-sandbox.ts` does. E2B, Daytona, Boat, Railway and CreateOS computers have
  a screen but no page tools. This PC Micos (`computerKind === "desktop"`, the
  default for Micos created in Desktop) get neither page nor screen tools; only PC
  app control (Windows x64, separate opt-in, every `pc_act` approved) reaches the
  person's own browser windows. Routine and workflow runs
  (`routineConversation`) and isolated project runs never get page tools.

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) gives each agent managed tabs on the person's
computer and on servers: several tabs per conversation with popups adopted, tools
to open, list and close tabs, wait conditions, key presses, hover, scroll and
select, page dialogs answered by the agent, page evaluation, screenshots,
viewport settings and downloads. `navigate` returns the first snapshot, a
snapshot waits for skeleton placeholders to go, cookie banners are refused, and
bot checks that clear by themselves are waited for while the rest go to a person.
Routines browse too. It also changes its browser identity and clicks one-click
captcha checkboxes, which this spec rejects.

## Decision

Make the Mico's own browser complete where it already runs, then bring it to
This PC Micos, routines and the other providers, in six phases that each ship
alone. Each new capability extends the page-browser command contract
(`PageBrowserCommand` in `packages/adapter-kit`) once, so every host that
implements it later gets the same tools.

1. Phase 1 — complete the page tools on Docker computers.
   - `browser_act` gains `press` (Enter, Tab, Escape, arrows, Backspace, with
     modifiers), `scroll` (a ref into view, or the page by a direction), `hover`
     and `wait` (text appears or disappears, the URL changes, or the page is quiet;
     at most 15 s per step). Batches keep the 24-step bound.
   - `browser_navigate` returns the first snapshot, saving a turn. A snapshot also
     waits, within its 3 s, while `aria-busy` or skeleton markers are visible.
   - `browser_snapshot` takes `from` to read a long page past 12,000 characters
     and 80 controls, with the same refs.
   - A dialog (`alert`, `confirm`, `prompt`) opened by a Mico step ends that step
     and returns its type and message. The Mico answers with a `dialog` step
     (accept or dismiss, with text for `prompt`); until then other steps on that
     tab are refused. Dialogs it did not cause stay for a person.
2. Phase 2 — a browser for This PC Micos.
   - Desktop hosts the Mico's tabs in sandboxed WebContentsViews, as the project
     browser does: no preload or application bridge, and a persistent partition
     per Mico on that PC, never the app's own session or the person's Chrome
     profile. Desktop drives them through Electron's debugger with the same
     contract and snapshot script as the Docker helper, over the existing
     host-computer channel.
   - The tabs show in the review workspace beside the chat, so the person can
     watch, and `request_takeover` hands the tab to the person there. Pages use
     the PC's own network. The user agent is Electron's Chromium without the app
     and Electron tokens; nothing else about its identity changes.
   - Close browser sessions also clears the Mico's partition on that PC. While
     the PC is offline, a turn that falls back to the server uses the server
     computer's browser and its separate sign-ins.
3. Phase 3 — several tabs, popups and frames.
   - A conversation owns up to 8 tabs. Popups and new-window links opened from
     its tabs join them, so OAuth and "open in new tab" flows stay in the page
     tools. `browser_tabs` lists them (handle, title, origin and path); the other
     tools take an optional `tab`, `browser_navigate` takes `new_tab`, and
     `browser_act` gains `close_tab`.
   - Snapshots include iframes, same-site and cross-site, with refs bound to their
     frame. `fill_secret` checks the frame's own origin.
   - Tabs stay open across turns of their conversation and close when it is
     archived or deleted. Idle tabs are unloaded and reload on next use, within a
     bound of loaded tabs per computer.
4. Phase 4 — downloads, page images and page reads.
   - A download started by a Mico step lands in a per-conversation folder of the
     Mico's home, within a size bound. The step's result lists completed and failed
     files; they are ordinary Mico files.
   - `browser_snapshot` takes `image` and returns a bounded JPEG of the tab's
     viewport when the run's model accepts images (`modelAcceptsImageInput`).
   - `browser_act` gains `evaluate`: one expression in the helper's isolated
     world, a JSON result of at most 64 KB and a 10 s deadline, for reading data
     the snapshot leaves out.
5. Phase 5 — routines and fewer stops.
   - Routine and workflow runs get the page tools, in their conversation's own
     tab; screen tools stay excluded. Where an interactive turn would call
     `request_takeover`, a routine run ends with `routine_report_failure` and the
     reason.
   - A snapshot reports `challenge` (`waiting`, `needs_person` or `blocked`, and
     the vendor) from bot-check interstitials; a long page that only mentions a
     captcha does not count. A check that clears by itself is waited for, up to
     15 s across reads. `needs_person` leads to a takeover (or the routine report)
     and `blocked` to a report. The Mico never clicks, solves or retries a check.
   - On Mico tabs, a visible cookie banner's reject-only button is clicked once per
     page. Banners without one stay; nothing is ever accepted.
6. Phase 6 — the same tools on other server providers.
   - E2B, Daytona, Boat, Railway and CreateOS computers built from the Mycellios
     computer image run the same helper through the provider's command API, with
     the conversation key. A stock image keeps `computer_act`. The tab-only
     handoff stays on Docker; elsewhere Open shows the computer's screen.

Open decisions (defaults in bold):

- This PC browser consent: **covered by the existing local-access consent, with
  a per-PC switch to turn it off**, or a separate opt-in like app control.
- Page reads: **isolated-world `evaluate` only**, also the page's main world, or
  no `evaluate`.
- Cookie banners: **reject-only clicks on**, or off.
- Routines: **page tools in routine and workflow runs**, or interactive only.

Rejected:

- Clicking or solving captchas and bot checks, sending page data to a solving
  service, or changing the browser's identity (user agent beyond removing app
  tokens, client hints, GPU names) to pass them.
- A sandboxed script runtime for many steps. `browser_act` batches 24 steps, and
  longer jobs belong in a program the Mico writes on its own computer.
- Shared or named browser profiles across Micos and per-profile proxies. Per-Mico
  profiles keep isolation (`mico-browser-reset`); the PC's network comes from
  phase 2.
- Using the person's Chrome for unattended work. Chrome tabs stay attended
  (`agent-chrome-tabs`).
- Recording the person's browsing to teach a task. It belongs with skills.

## Rules

- Page text, titles, URLs, dialog messages, file names and `evaluate` results are
  untrusted data and taint the run.
- The model never sees a `fill_secret` value. In a document that received one,
  `evaluate` and page images are refused until a new document loads, and a
  snapshot keeps the field's value out.
- Tabs, downloads and partitions are scoped by account, Space, Mico and
  conversation; a conversation never reaches another's tab. No partition or tab
  carries the app's own session.
- `browser_*` stay approval-exempt only in the Mico's own browser (Docker, other
  providers, its This PC partition). The person's Chrome keeps `chrome_*` and
  their approvals.
- Every step is bounded: 24 steps per call, 15 s per wait, 8 tabs per
  conversation, loaded tabs per computer, download size and the 512 KB result.
- An uncertain step is reported as uncertain and never replayed; the Mico inspects
  the page before continuing (`formatBrowserResult`).
- A tab held by a person is untouched by Mico tools until the person returns it.

## Verification

- Phase 1: helper fixtures in `infra/sandboxes/computer/test_page_browser.py` for
  each new kind, wait timeouts, dialogs and long-page reads; `browser-tools`
  parser tests; `apps/web/e2e/page-browser.spec.ts`; the Docker replay
  (`packages/testkit/src/computer-replay.docker.test.ts`).
- Phase 2: Desktop tests for partition isolation (no app cookies or bridge),
  host-computer protocol and takeover lease tests, and the shared ref fixtures
  against both hosts. A real installed Desktop on Windows and macOS is reported
  separately.
- Phase 3: fixtures for an OAuth-style popup, new-window links, cross-site
  iframes, `fill_secret` per frame origin, the tab bound and cleanup on archive.
- Phase 4: download size and folder-scope fixtures, image gating by model
  capability and secret protection, `evaluate` bounds and refusal after a fill.
- Phase 5: executor gating tests per trigger (page tools offered, screen tools
  not), challenge fixtures (clears, needs a person, blocked, long page that only
  mentions a captcha) and banner fixtures (reject only, never accept). CI uses no
  live sites.
- Phase 6: provider adapter tests over fake command APIs. A real provider
  computer run is reported separately.
