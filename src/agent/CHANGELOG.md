# Changelog

Notable product changes in Mycellios. See GitHub Releases for tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.34.0] - 2026-11-26

### Changed

- A Mico on Claude Code answers the next message of the same conversation sooner: for 30
  seconds after a reply, Claude Code stays started instead of launching again for each
  message, as Codex already does.

### Fixed

- Load short conversations in one history response when opening them in Mycellios.
- A message that waits while its Mico is busy in another conversation now starts as soon as
  that conversation finishes. Before, it could wait up to 30 more seconds.
- A waiting message names the conversation it waits for, such as "Waiting for “Daily scout”
  to finish", instead of only "Queued".
- Opening a conversation shows its messages and starts receiving the reply sooner: status
  reads for the header, rail and composer menus now wait until the messages load.
- A Mico on Claude Code, Codex or OpenCode no longer makes your messages wait while one of
  its routines with a separate browser runs. Those routines run on a server computer with
  the Mico's server model, so they now run beside your conversation instead of taking its
  turn.
- On Windows, Restart to update no longer fails with "Could not restart. Try again." when
  Windows briefly refuses to start the update helper. The app now tries again by itself for
  about 30 seconds before it shows the error.
- A Mico working on your computer can resume from a saved tool checkpoint when
  the server connection drops. Commands with an uncertain result are checked
  before the Mico can make more changes.
- On Windows, the installers of earlier updates are deleted again after an update. Before, a
  backup left by an older update stopped the cleanup, and each new version added about 590 MB
  that stayed on disk.

## [0.33.0] - 2026-11-26

### Added

- Start workflows from text summary and draft review templates.
- Test a step or run from it using saved inputs and a new execution.

### Fixed

- Start preparing recent project messages as soon as Desktop opens so older chats do not have to wait for the sidebar.

## [0.32.0] - 2026-11-26

### Added

- A routine with a separate browser uses an isolated server computer while your Mico keeps its usual computer.

### Fixed

- Open more project chats faster by preparing their latest messages across folders before you click.

## [0.31.3] - 2026-11-26

### Fixed

- Routines with a separate browser can see their navigation tools from the start of the run.

## [0.31.2] - 2026-11-26

### Fixed

- Start loading the last opened project conversation earlier when launching Mycellios.

## [0.31.1] - 2026-11-26

### Fixed

- Mycellios prioritizes the last project chat you opened when preparing conversation histories at startup.

## [0.31.0] - 2026-11-26

### Changed

- Codex conversations show when the model starts thinking, even before the first reply text arrives.
- Follow-up messages can reuse the Codex process and loaded conversation, so the model can start sooner.

### Fixed

- Agents can start processing a saved message while the live chat notification is still being delivered.

## [0.30.0] - 2026-11-26

### Security

- A configured MCP action can require one-time approval for an exact account, space, Mico, and connector. The approval card stays in the chat and other tools keep their existing approval settings.

### Added

- Prepare a paused morning briefing from Routines.
- Import and export workflow drafts and match their Micos by name.
- Pause workflows for owner approval. Independent branches can run together, and joins wait for their results.
- Browse and restore workflow versions. Restoring a version pauses its schedule.
- Connect a saved workflow version to a signed webhook and revoke the signing secret from the editor.
- Use Mycellios CLI from the Windows, macOS and Linux Desktop resources.
- Declare typed answer fields and use their verified values in workflow conditions and later steps.
- Repeat a workflow section from a condition, with a fixed limit on passes.
- Let routines opt in to a fresh browser on a managed isolated computer.

### Fixed

- Desktop asks before quitting while a Mico is still working on this computer.
- Project conversations start loading sooner when you point to or tab to a folder, so opening a chat right away is more responsive.

## [0.29.0] - 2026-11-25

### Added

- Behind the server setting `MYCELLIOS_SPACE_MEMBERS_ENABLED` (off by default), the server side
  of sharing Micos in a space other than Personal: the owner or an admin shares a Mico with
  chosen people or with everyone in the space, and each person talks to it in their own
  conversations. The Mico's owner pays in Credits, up to a daily limit per person (1 Credit per
  day unless the owner sets another; 0 pauses their messages), and can read those
  conversations. The invitation page now says so. A person's turns never use the owner's
  memory, connected apps, secrets, computer, schedules or other Micos. The screens to share a
  Mico and to talk to one come in a later release; with the setting off, nothing changes.
- Scripts can use a token scoped to one Mico. Its owner can disable access or
  revoke a token without changing the Mico's other credentials.
- Allow selected programs launched by a Mico on This PC to use its AI through OpenAI or Anthropic text requests. The billing owner can set a Credit limit per turn in Mico settings.

### Fixed

- Project chats prepare their recent messages in the background so opening them can show the history immediately.

### Self-host upgrade notes

- Apply the additive migration `20261125120000_space_member_sharing` before starting this
  version, and run the API and worker of this version together before turning
  `MYCELLIOS_SPACE_MEMBERS_ENABLED` on. It adds the `mico_shares` and `mico_share_members` tables
  with row-level security and nullable columns that name the person behind a conversation,
  message, turn, upload, receipt and Credit hold. People's turns run only on Mycellios Credits,
  so a Mico on the owner's own key or sign-in answers them with a refusal.

## [0.28.0] - 2026-11-25

### Added

- Update managed copies of Codex, Claude Code and OpenCode from the model picker. Mycellios
  shows the new version and verifies its package before installing it. Ongoing turns keep
  their version and new turns wait while the update is checked.

### Fixed

- A configured text model can take over when a reasoning model is rate-limited on a text request that has no explicit thinking preference.
- Waiting for replies can fold away on desktop. On small screens, a compact button opens replies and queued messages in one sheet.

## [0.27.0] - 2026-11-25

### Changed

- The conversation bar has a dedicated Main chat tab and a labeled list of all conversations. The list marks which conversations are open as tabs.

### Fixed

- Opening a project conversation keeps the workspace and Projects sidebar visible while its chat history loads.

## [0.26.0] - 2026-11-25

### Added

- Ask a Mico in your own chat to create a signed webhook routine. The chat card
  provides the event URL and lets you reveal the signing secret once.

## [0.25.0] - 2026-11-25

### Added

- Choose the Claude Code model and effort in the chat model menu, from the models your signed-in
  Claude Code account offers. Micos on This PC also list the Codex models of that PC.
- A "Use my Claude Code settings" switch in the model menu of a Claude Code Mico on This PC loads
  your own Claude Code instructions, hooks and skills. It is off by default.
- Mycellios publishes its own self-host images, built from this repository for amd64 and arm64:
  `ghcr.io/mycellios/mycellios/app`, `computer` and `updater`, tagged `sha-<commit>` and `edge`
  from main, and `v<version>` for each Desktop release, which also tags its commit `v<version>`.
  The installer, the Compose files and the updater keep their current images until a later
  release moves them.
- Sign in to ChatGPT (Codex) or Claude Code on your PC from the chat model menu. In Desktop the
  program's own sign-in opens on that PC; from the web or a phone, Codex shows a one-time code
  to enter on its sign-in page. Claude Code signs in from Mycellios on that PC.
- Sign out of Codex or Claude Code on your PC from the same menu, after a confirmation. It also
  signs you out of that program in your own terminal and in every Mico on that PC.
- Routines and Workflows are now available. The side menu, the computer panel and links open
  them instead of showing Coming soon. Your saved routines and workflows stay as they were.
- The plan usage beside the workspace rail now shows the ChatGPT (Codex) plan of your PC while a
  Mico that works on This PC is open, the same way it shows the plans of your model accounts.
- Behind the server setting `MYCELLIOS_SPACE_MEMBERS_ENABLED` (off by default), the owner or
  an admin of a space other than Personal can invite people by email or with a one-use link,
  valid for seven days. People who join see the space in the space menu with its owner's name,
  can see who is in it and can leave; the owner changes roles and anyone who manages the space
  can remove a member. Sharing Micos and talking to them in a shared space come in a later
  release. With the setting off, nothing changes.
- The server answers `GET /api/v1/status` with only `{"status":"ok"}` or
  `{"status":"degraded"}`, from the same database check as `/ready` and with no version or
  other details, so a status page or uptime monitor can tell whether Agent works. `/health`
  is unchanged.
- Codex, Claude Code and OpenCode Micos can work in several conversations at once, up to the
  Mico's conversation limit, and their main chat no longer waits behind those conversations.
  This stays off until the server's operator turns it on; until then these Micos still work on
  one conversation at a time, main chat included.
- Mycellios Desktop runs at most 6 agent engine turns (Codex, Claude Code or OpenCode) at once on
  your PC. Another turn waits, says so in its conversation, and starts when one of them finishes.
- Install Codex, Claude Code or OpenCode on your PC from the chat model menu when it is missing.
  The menu shows the version, the npm package it comes from and the download size first. Mycellios
  checks the download against the hash its maker published before it runs, needs no administrator
  rights and leaves any copy you installed yourself as it is.
- Each webhook routine now has its own address and secret. Senders sign events in the Standard
  Webhooks format, and an event signed more than five minutes away, sent again with the same id
  or past 60 in an hour does not start another run.
- A webhook routine can wait for one event type and check fields of the event before it runs.
  Events it skips, and events that arrive while it is paused, show in its run history.
- Rotate a routine's secret without missing events: the previous one keeps working for 24
  hours. Revoke ends both at once, and Send test event runs the routine on a signed sample.
- The Chrome side panel has its own appearance settings. Choose Mycellios, white, dark or system colors and optionally tone down branding and Mico avatars with Discreet mode.
- A Mico using the browser on its server computer can now press keys such as Enter, Tab or
  Escape, scroll, point at a menu to open it and wait until a page shows what it expects. Opening
  a page also shows the Mico what is on it, and it reads long pages to the end. When a step makes
  the page ask a question in a pop-up, the Mico reads it and answers it before going on. A
  computer gets these after its owner updates the computer image; until then the Mico is told
  that the step needs a newer image.

### Changed

- The model picker marks Claude Code or Codex as "Sign in required" when that program is installed
  on the Mico's computer but nobody is signed in to it, instead of letting you choose it and fail
  on the first message. The Mico's current choice stays selectable.
- Claude Code now works in the Mico's own folder on your PC (or its linked project) instead of a
  hidden folder. The first message after updating starts a fresh Claude Code session that keeps
  the conversation history.
- A new Mico on This PC starts on Claude Code, or else Codex, when that program is already
  signed in on your PC and you did not choose a model when creating it. You can switch it to
  another model from the model menu.
- When your PC is offline, a Claude Code, Codex or OpenCode Mico on This PC answers new messages
  on the server with its saved model (or your main model) instead of waiting, and the chat says
  so. Without any model it keeps saying that the PC is offline.
- Your existing Micos on This PC move once to Claude Code, or else Codex, when that program is
  signed in on your PC. Only Micos that are not working move, each chat says so, and choosing a
  model in the model menu takes a Mico back for good.
- When your PC has its own copy of Codex, Claude Code or OpenCode and one that Mycellios installed,
  Micos use yours if it is the same version or newer.
- Adding a webhook to a routine no longer creates the Mico's shared webhook key. Senders that
  already use that key keep working for routines that have no secret of their own.
- Self-hosted Mycellios installs and updates from this repository: the installer, the Compose
  files and the updater sidecar use the `ghcr.io/mycellios/mycellios` images and this
  repository's `v<version>` releases, and the installer fetches its files from the tag it
  installs. `bash install-images.sh --release v<version>` installs a release instead of `edge`.
  Desktop's Docker stack uses the images of its own version from this repository too.

### Fixed

- When a Mico opens a conversation of its own for part of a task, it now tells you the result in
  its main chat even when an update or a lost PC connection stops the turn in which it reads that
  result. That turn starts again on its own, up to three times over about eight minutes, and the
  Mico checks what it already did before going on. Before, the result stayed in the other
  conversation and the main chat said nothing.
- Fixed chat history loading and jumps to individual runs in grouped routines.
- Kept emoji-only Mico replies visible in natural mode and made long routine summaries easier to read on phones.
- Reduced redundant rendering of settled messages while a reply arrives.
- Load routine suggestions when you type a mention instead of making one routine request per Mico as the chat opens.
- Rapidly switching chats now reuses the Space's recent task overview instead of making duplicate requests.
- A conversation whose run failed before saving a message now explains what happened alongside the existing recovery controls.
- Switching to a chat in another Space now continues if the browser stalls while capturing the transition.
- When one Mico asks another for something, an update or a lost PC connection no longer ends the
  exchange. If the turn of the Mico doing the work stops halfway, it starts again on its own, up
  to three times over about eight minutes, and the Mico that asked keeps waiting for the answer
  instead of being told it failed. The same happens to the turn in which the Mico that asked
  tells you the answer. Each Mico checks what it already did before going on. Before, the
  request failed at once or the answer never reached you.
- Open a chat with its recent messages first, with earlier history available when you scroll back.
- Prioritize messages over background controls when opening a chat for the first time.
- Create Routine on the Schedule page opens a new routine for the Mico you picked. Before, it
  opened the Mico's computer panel.
- Start new chat history at selection and keep deferred controls from refreshing all at once.
- On macOS and Linux, Mycellios opened from Finder or an app launcher now also finds the coding
  programs your terminal finds (for example ones installed with Homebrew or npm). Before, they
  showed as not installed.
- Reopen the official cloud workspace in Desktop when the bundled interface stalls during startup.

### Self-host upgrade notes

- Apply the additive migration `20261125100000_space_members` before starting this version. It
  adds the `space_invitations` table with row-level security and makes a new organization
  membership join the organization's default space only for an owner, so a person invited to
  one space never reaches the owner's Personal space. Set `MYCELLIOS_SPACE_MEMBERS_ENABLED=true`
  to turn the feature on and `MYCELLIOS_SPACE_MEMBER_LIMIT` (2 to 100, default 20) to change
  how many people a space can hold. Email invitations use the email provider already configured
  for sign-in; without one, share the link instead.
- Set `MYCELLIOS_NATIVE_CONCURRENCY=1` on the API and the worker to let Codex, Claude Code and
  OpenCode Micos run several conversations at once. Leave it unset to keep one turn at a time.
  A generic ACP agent always stays at one turn.
- An install whose `.env` still names the images of the project Mycellios Agent was imported from
  keeps them until you move it. Rerunning the installer asks once (`--move-images` and
  `--keep-images` answer without asking), and the updater sidecar offers the same with
  `POST /move`. The move first checks the database and changes nothing when it records a
  migration this repository does not ship. Until it moves, the updater refuses official updates
  instead of pulling this repository's releases onto the other images.

## [0.24.0] - 2026-11-24

### Added

- Word documents (.docx) open in the file preview, with headings, lists, tables, and bold,
  italic, underlined and struck text. You can attach them to a chat, and a Mico can send them
  back. Before, Word files could not be attached and opened only in another app. Shared links
  to a Word file still download it.
- Groups can share up to 8 folders from your PC. In Group settings → Folders, add folders with Mycellios Desktop; the group's Micos on This PC can change files and run commands in them during group turns, and the list shows which members can't reach them.
- A Mico can ask for your location when a request needs it, such as "restaurants near me".
  It shows a card in the chat and nothing is sent until you answer it. Share location sends
  your current position once, rounded to about 100 m, in the web app, the installed phone app
  and the Android app; anywhere, including Desktop, you can type a place instead or choose not
  to share. The Mico receives the location only while it works on that request, and it is
  deleted when the request ends. The card and your activity list never show it and the
  Mico's steps in the chat hide it, but the Mico's own reply, and a notification quoting
  that reply, can still mention the place.

### Fixed

- When you connect a Mico on one computer while it is still working on another, Mycellios Desktop
  now says so and asks you to wait or stop it there. Before, it asked you to sign in again or
  reconnect the project, which did not help.
- Generate AI can always be paused while your computer is contributing, even after the
  contribution status could not be read. Before, the button only offered Retry and could
  not stop the contribution.
- The card that opens when you rest on a Mico in the sidebar keeps long messages and
  conversation titles inside it instead of spilling over the chat.
- In the natural response style, the short notes a Mico writes while it works no longer show up cut
  in pieces, such as "Sigo" and "dond" on separate lines. A note appears once it is complete, and a
  note the Mico already showed in the same turn is not shown again.
- When a program a Mico runs on your computer needs its own AI, the Mico first checks whether
  Claude Code, Codex or OpenCode is already signed in there and only asks you when none is.
  Before, it asked which AI to use even when one was ready.
- Creating a Mico shows the model picker directly. Before, it sat inside a second
  "Model · automatic" section that never changed after you picked a model.
- Micos that work on your PC answer, write files and run commands much sooner. Before, a
  reply reached the PC a few words per round trip to the server, writing a long file could
  take minutes, and every step waited for extra confirmations from the server.
- During the closed beta, creating an account without an invitation now says that new accounts need
  an invitation and that you should open your invitation link in the same browser. Before, it only
  said that the account could not be created.
- A Mico that hands work to another Mico now comes back to you with the result even when an
  update or a lost PC connection stops the turn in which it reads that result. That turn starts
  again on its own, up to three times over about eight minutes, and the Mico checks what it
  already did before going on.
  Before, the conversation stopped there without an answer.
- When the other Mico could not do the work, the Mico that asked now knows why, for example
  that several PCs are connected and none was chosen for that Mico, and can tell you. Before, it
  only knew that the work had failed.

## [0.23.0] - 2026-11-24

### Added

- Talk to a group by voice. The voice conversation button now shows in a group's message box:
  what you say goes to the group like a typed message, and each Mico that answers is read
  aloud in its own voice as soon as it finishes. The panel shows the Mico that is speaking or
  working, else the group's lead.
- "Read new replies aloud" now works in groups too. It reads the first answer to your newest
  message, or the answer of the Mico you named, in that Mico's voice.

### Fixed

- Show the Credits balance more reliably when the Mycellios service is busy. The server now
  shares one short balance read per account, and still reads a fresh balance after a turn
  ends or contributed work is verified.
- Mycellios checks for computer updates much less often while none is running, and not at all
  while the window is hidden. Progress still appears at once when you start an update, and an
  update started on another device appears within a minute.
- A PC connected to a project folder now waits for work instead of asking the server every
  two seconds, which cuts its background traffic sharply. New work still starts right away.
- The web app can update when you click Update with a saved chat draft. Your draft is still there after the page reloads.
- Once every teammate has answered, "Waiting for replies" shrinks to one "Replies in" line
  that closes as soon as you click it. Before, the full list stayed open and closing it waited
  for the server.
- Mycellios Agent can open in Chrome's side panel with the Chrome Web Store version of the extension.
- Windows updates no longer fill the disk. Each update kept a full copy of the previous
  version (about 1.5–2 GB) next to the app and never removed it. Now only the two most recent
  copies stay, for rolling back by hand, and older ones are removed after the next successful
  update.

## [0.22.0] - 2026-11-24

### Added

- Open Mycellios Agent in Chrome's side panel with the new Mycellios browser extension. It uses
  your existing Mycellios sign-in. The extension is not in the Chrome Web Store yet; load it from
  `apps/browser-extension` as an unpacked extension.

### Changed

- The Mycellios browser extension uses icons at the exact sizes Chrome expects, so the toolbar and
  extension pages show a sharp icon.

## [0.21.3] - 2026-11-24

### Fixed

- When a Mico needs you on its computer, the top bar no longer overlaps: the
  "Needs you" label keeps its place and the bar shows one main action, "I'm done".
  Skip, Show desktop and Stop are in the "…" menu, and Teach a task waits until
  the request is answered.
- While the computer's screen is still starting, the view says it is connecting
  instead of showing an empty page.
- Mycellios uses much less server time while it sits open: the list of Micos refreshes every
  3 seconds only while one is working (every 15 seconds otherwise), and the Desktop dock no
  longer reloads a waiting Mico's whole chat on every refresh.

## [0.21.2] - 2026-11-24

### Fixed

- OpenCode in Desktop can use Mycellios tools to read and edit files in a linked project.

## [0.21.1] - 2026-11-24

### Fixed

- Pause and resume on "Generate AI" now reach the computer. Before, the network refused the
  command and the button kept showing Pause.
- Work a Mico does on your PC is saved again when its folder holds a file larger than 8 MB,
  such as a video it made. Before, one large file stopped the whole folder from being saved.
  Files over 100 MB stay on the PC only.

## [0.21.0] - 2026-11-23

### Added

- Run OpenCode in an authorized Desktop project folder or task worktree and reopen its session in that project.
- Choose from the coding engines available on the Mico's selected computer. When Desktop is offline, its coding task waits for that computer.
- Each routine can now run in its own conversation or in the Mico's main chat, with a "Run in
  its own conversation" switch in the routine settings. A routine in its own conversation no
  longer waits behind a question or a takeover pending in the main chat. Routines a Mico
  creates outside a group now get their own conversation too, unless it is asked to post in the
  main chat; routines in a group stay in the group.

### Fixed

- Sending a message in a conversation opened from its tab no longer fails with "Load this task
  conversation before sending changes". The conversation is now checked on the first send
  instead of refusing it.
- When the server does not answer while Mycellios Desktop checks access to this computer, the
  chat now says the message was not sent and to try again, instead of showing a technical
  "Error invoking remote method" message. A server outage no longer asks you to sign in again.
- A conversation whose Mico waits for your answer can now be deleted; deleting it cancels the
  question. Before, Delete stayed disabled until you answered.
- Archiving a conversation now confirms it with a message that names it and offers Undo, and the
  Mico leaves "Needs you" at once. Before, the sidebar kept asking for an answer until the page
  reloaded, so archiving looked like it did nothing.
- With two of your PCs online, a Mico now stays on the PC you last used it from, even after
  Mycellios restarts. Before, a Mico used on both PCs stopped answering after each update and
  its routines failed until you sent it a message from Desktop again. When no PC has been chosen
  yet, the message is translated and opens the Mico's computer settings instead of offering to
  change the model.

## [0.20.0] - 2026-11-23

### Added

- Let a Mico save to your personal memory, and forget what it saved, when you allow it.
  - Turn this on per Mico in Settings > Memory > Personal memory: "Can save new memories" and
    "Can forget what it saved".
  - Forgetting follows your approval settings, like other actions that change data.
  - It works with memory servers that offer saving.

### Fixed

- Opening a Mico's request for help on a busy computer now shows its browser tab. Before, finding
  the tab could take a few seconds too long and the whole desktop opened instead.
- While the server restarts, Desktop now waits a little longer between reconnection attempts
  instead of retrying many times a second. It still reconnects within a few seconds once the
  server is back.
- Micos using apps on your PC can now read web pages in Chrome: reading one region of a window
  returns all of it instead of stopping at the browser's outer frames, and each read waits for
  the page to finish building before answering.
- Keyboard shortcuts written as "Ctrl+L", "F6" or "Enter" are accepted instead of failing.

## [0.19.1] - 2026-11-23

### Fixed

- Opening a Mico's request for help now shows its browser tab instead of the whole desktop.
  Before, the tab view started before the control screen was ready and fell back to the desktop.
- Show a Mico's computer screen when Mycellios is served under a path such as `/agent`.
  Before, the screen stayed on "Screen not connected" because its address pointed outside the app.

## [0.19.0] - 2026-11-23

### Added

- Connect your own memory server in Settings > Memory > Personal memory. Any MCP server that
  implements the open Memory MCP profile (`memory_search` and `memory_read`) works, with OAuth or a
  bearer token. Mycellios checks whether the server is compatible and whether it allows writing.
  No Mico uses a connected memory yet; per-Mico access comes in a later release.
- The sign-in page offers "Forgot your password?". It emails a reset link, and opening that
  link lets you choose a new password and continue signing in where you left off.
- Choose which Micos can read each personal memory in Settings > Memory > Personal memory. A Mico
  with access searches that memory before each reply in your own chats and can look things up in it
  with `recall_memory`. No Mico has access until you give it, and personal memory is never used in
  messaging channels, groups or other people's conversations. Micos cannot write to it yet.

### Fixed

- Writing in a Mico conversation started by delegated or transferred work from Mycellios Desktop no
  longer fails with "Reconnect this project conversation before continuing". These conversations
  now use the Mico's own folder, like its other conversations.
- Open on a pending computer request selects the Mico’s existing browser tab and lets you take control in one click on supported computers.
- That tab now opens on its own, without loading the whole remote desktop, and sign-in windows it opens appear in front of you. Show desktop returns to the full screen.
- Creating an account with a password that is too weak now says so, instead of the general
  "Could not create your account" message.
- Mycellios Desktop work is less likely to stop while the server is busy. The server keeps more
  database connections open for the requests that keep a Desktop task running.
- Sending a message in a conversation a Mico received as delegated work no longer fails with
  "Internal server error" in Mycellios Desktop. The message now runs in the Mico's own folder,
  like the delegated work itself.
- Open on a Mico's sign-in request now shows only its browser tab on server computers; it was falling back to the whole desktop.
- If that tab is gone, Open still shows the computer so you can help, instead of only an error.
- A Mico can open its own side conversation again when message content is encrypted, and a queued
  message can be moved to a new conversation. Both failed in production because the first message
  was sealed before the new conversation's Space was known.
- Windows now shows the installer confirmation from the Mycellios window before closing for a restart. If the security check stalls, it cancels that attempt so you can retry.

## [0.18.0] - 2026-11-23

### Added

- Delete a message you sent from its menu when your private conversation is idle.
- Request context compaction from the conversation options of an idle Pi Mico chat while keeping all messages visible.
- Settings → Account has two more Mycellios API sections next to API keys. API subscription (Suscripción de la API) shows
  the Mycellios Go plan, its status, the monthly tokens and the API token balance, and opens Stripe Checkout or the
  billing portal. API usage (Uso de la API) shows the requests made with your API keys, grouped by model. Both explain how
  they differ from Billing and from what your Micos use. Links to `?settings=api-plan` and `?settings=api-usage` open them
  directly, also after signing in, and old dashboard account links now land there.
- Link or unlink Google and X as sign-in methods in Settings → Profile. The last
  sign-in method of an account cannot be unlinked.

### Changed

- Mico browser commands use a dedicated tab for each conversation on managed Docker computers.
- On phones, the workspace menu opens beside the chat list with a short slide, leaving the
  list visible. Menus and conversation switches use brief transitions and respect reduced
  motion. Options that are not available yet say "Coming soon".
- On phones, the keyboard opens only when you tap a text field and closes when you do
  something else. Unsent drafts are kept. Send, attach and dictation keep the keyboard open.

### Fixed

- A Mico working on your computer no longer stops with "Desktop execution interrupted" when the
  server answers slowly for a few seconds. Mycellios Desktop now resends its latest result until the
  server takes it, for up to about a minute and a half, instead of giving up after 20 seconds.
- A Mico that was waiting when Desktop updated, or whose tools changed meanwhile, resumes its task instead of failing with a model provider error.
- A message for a Mico on your computer no longer fails with "The operation was aborted due to
  timeout" when the server is slow to check whether your PC is connected. Before, that check gave up
  after five seconds and the message, including replies from other Micos waiting to be delivered,
  was lost. Now the message waits and tries again, without moving to a server workspace, and if your
  PC still does not answer it ends saying so.
- With two PCs connected to the same account, a Mico set to This PC now runs on the PC that holds
  its folder. Before, messages from other Micos or delegated work could run on the server instead,
  and a Mico using Codex, Claude Code or OpenCode failed with "not authorized to use the server's
  native agents" while both PCs were online. When neither PC or both hold the Mico's folder, the
  chat now asks you to send it a message from Mycellios Desktop on the PC that should run it.
- A Mico using Codex, Claude Code or OpenCode no longer moves to the server when its PC is offline
  and the server cannot run that agent for you. It shows that your Desktop is offline instead.
- Micos that work on This PC can use their tools again. Since Desktop 0.17.0, every tool call
  of a Mico running on the PC failed with "Unsupported Desktop runtime value".
- Typing in the message field on phones no longer lags: the draft is saved in the background
  instead of on every keystroke, and the field measures its height once per frame.
- Conversations open faster on phones: the next conversations are prepared before you pick
  them, even when only the current tab fits. A slow background read no longer holds up the
  others.
- A Mico on This PC can pass dates between the PC and the server. When a value still cannot
  cross, the error names its kind and where it was, so a routine's history shows what failed.
- Changing a Mico's model applies to new conversation turns. A paused turn keeps its original model and connection, and a new native session carries the conversation history forward.

## [0.17.0] - 2026-11-22

### Added

- Messages that wait while a Mico works now show in a "Waiting to send" panel that
  says why they wait: the current turn, a full set of conversation slots, a restart,
  a usage limit or a needed sign-in, or an edit in progress.
- Each waiting message can be sent into the running turn (Steer now), sent next by
  stopping the current turn (Send now), edited, deleted, reordered by dragging or with
  the arrow keys, or moved to a new conversation of the Mico with the +. A message
  being edited holds the queue until you save or cancel, also after a reload or on
  another device.
- A turn that waits for its own background commands shows "Waiting for background
  work…" with a timer.
- A Mico can send one message to up to 32 teammates at once, share up to 10 files from
  its workspace with them, answer a specific message, and say whether it expects a reply.
  When it asked several teammates, it continues once all of them have answered or were
  stopped, with every answer together and the names of anyone who did not answer.
- A Mico's chat shows "Waiting for replies" above the message box: how many answers are
  in, what each teammate is doing, and Stop for each one still working. A delegated task
  that was stopped offers Continue, Reassign and Cancel. A finished list can be hidden.
- Groups have a purpose and a lead that you choose when creating the group or in its
  settings. Messages that name nobody go to the lead, which answers or hands the request
  to the right member in the chat.
- Writing "continue" or "keep going" in a group picks up the work that stopped on the
  last request instead of starting over.
- "Send to group" on a message opens the group with that text ready to send.
- A Mico can see what its teammates are doing before it starts work, start work in one of
  its groups and get the results back in its own chat, and stop work it asked a teammate
  for when it is no longer needed.
- Settings → Account has an API keys section (Claves de API in Spanish): it shows the API base URL, creates a named key
  whose secret is shown once with a copy button, lists each key with its prefix, creation date and last use, and revokes a
  key after you confirm. The key that Mycellios Agent uses for your Credits is marked "Used by Mycellios Agent" and cannot
  be revoked there. Links to `?settings=api-keys` open this section directly, also after signing in.

### Changed

- A Mico's main chat no longer counts toward its limit of tasks at once, so it never
  waits behind side conversations; side conversations past the limit wait for a free
  slot. Native engines still run one turn at a time.
- A message sent into a running turn reaches the Mico with a short note that it adds
  to the current work, and Codex, Claude Code and ACP Micos now receive it after their
  next tool step instead of only after the turn. A running shell command moves to the
  background instead of holding the message back.
- After a turn fails on a usage limit or a needed sign-in, the queued messages wait
  for you instead of failing one after another.
- Ask aside can follow up on more of the recent questions and answers in its panel.
- Desktop uses the Mycellios bridge name while keeping older Desktop and web builds compatible.
- Messages between Micos show as folded lines ("Messaged", "Informed", "Message from",
  "Update from") that open to show the text. A teammate's quiet reply to an update folds
  under it.
- In a group, each member answers from its own view: it sees the other members' replies to
  the same message only after it has replied.
- Supermemory saves new memories under the Mycellios name and continues to find previously saved memories.
- Servers accept Mycellios sign-in and account callback links for future iPhone app updates.
- Expo notifications use Mycellios links when opening conversations.
- The mobile Conversations menu groups unread, read and archived chats, shows how many need your attention, and puts conversation actions within reach of a tap.
- Archiving a conversation can bring its memory review forward when automatic memory reviews are enabled and within your Credit limits.
- Permanently deleting a conversation also removes saved memory revisions from that conversation. Notes from other conversations stay available.

### Fixed

- Let the Windows updater retry briefly when another process has its progress receipt open.
- Switching conversations reuses recent messages while the history refreshes. The Answer shortcut opens the conversation with the pending question.

### Self-host upgrade notes

- Apply the additive migration `20261123090000_message_queue_controls` before starting
  this version. It adds the nullable `position`, `heldBy`, `heldAt` and `editDraft`
  columns to `steering_messages` and gives messages that already wait their current
  order.

## [0.16.0] - 2026-11-22

### Security

- Carry the private beta invitation through hosted sign-in so a new Mycellios account can be admitted before it opens an Agent workspace.

### Added

- The iPhone app can open Mycellios links and continues to open existing links.
- On desktop and the web, the menu of a Mico's last reply in a finished turn offers
  "Branch in new conversation". It copies the conversation up to the end of that turn,
  with its files, into a new conversation of the same Mico, which opens in a tab right
  after the one it came from. It works from the main chat and from any conversation of
  the Mico, and waits while a turn is still running.
- A branch is named after its source with a number ("Trip budget #2"), or after your
  last message when it comes from the main chat. A divider where the copy ends says
  "Branched from …" and opens the original at that point, or says that the original
  was deleted.
- The Mico's first reply in a branch knows that the earlier messages are a copy and
  that files on its computer were not rolled back to that point.
- Reactions, pins, read marks, queued messages and usage stay with the original.
  Deleting the original never deletes a branch; deleting a branch also removes the
  files copied into it.

### Changed

- Open Settings faster on Desktop and reuse the system font list during the session.
- Show layout-shaped loading placeholders across chats, the Library, tasks, schedules, usage, the Store, and Settings.

### Fixed

- Continue a Mico's task after answering its questionnaire with a fresh tool budget and the existing plan and results.
- Desktop could hang when quitting from an offline profile. It now waits for the offline notice only if it has a relay connection to release.
- Micos can spend their tool budget verifying the request and still close the work plan. Internal planning and tool discovery have their own limit.

## [0.15.0] - 2026-11-22

### Added

- In Tasks, a question also offers "Answer in the chat", which opens the
  conversation at that question. A conversation waiting for you to take over the
  computer offers "Open in the chat".
- The Tasks panel can be resized from its edge, with the mouse or the arrow keys.
  It stays at least 320 pixels wide, leaves the list at least as much, and keeps
  its width on this device.
- The Mico picker in Tasks has a search box and says when no Mico matches.
- After you start a task, the line names the Mico and the task's title. Its Open
  button starts the task right away and shows it, without waiting for the six
  seconds to undo.
- A conversation where a Mico waits for a routine result, a run or a time now shows
  an "Open waits" card: what each wait is for, when it times out, whether it is
  still waiting or already continuing, the note the Mico saved and the original
  request. "Cancel the wait" stops a wait that has not woken yet; a wait that
  already woke is never reported as cancelled. The Conversations list in the side
  panel marks conversations with an open wait.
- A Mico can list its open waits and close one it no longer needs, so that wait
  does not wake its request later.
- When a wait wakes in an archived conversation, the conversation comes back, and
  the continued turn gets the original request and the Mico's saved note again.

### Changed

- Tasks rows say how a conversation ended (Answered, Failed or Stopped). Failed and
  stopped rows are red and rows that need you are amber, always with the words too.
  Conversations a Mico opened by itself are marked.
- The empty Tasks page explains what it is for in fewer words.
- Archived tasks list the most recently archived first.
- Archiving a conversation keeps a request that only waits for a routine result,
  a run or a time, so it can continue there later. Stop still cancels it.
- For a job that should end within about 15 minutes a Mico now checks it during
  the same turn at growing intervals, and for longer jobs it saves a wait instead
  of keeping the turn open.

### Fixed

- A message sent while Mycellios Desktop is quitting or installing an update no
  longer fails with "Desktop execution interrupted; check existing results before
  retrying". Desktop now tells the server it is going offline, so the message runs
  as it would with the PC offline. If the PC goes away before it receives a
  message, the message is tried again instead of being reported as possibly half
  done, and the chat says the PC is offline if it has not come back.
- A conversation that has not started yet is listed under Waiting instead of To
  continue.
- A conversation that failed stays under Needs you, with its reason, even when a
  background step ran after the failure.
- Conversation tabs could look empty while the same history was requested twice and slow reads were retried. Tabs now reuse their previous messages when reopened and show loading during the first read.

## [0.14.0] - 2026-11-22

### Added

- A Mico can look through all of its conversations: in its main chat or a side
  conversation, search_history without a query lists the main chat and the side
  conversations (archived ones too) with their state and latest request and reply,
  and a search covers this conversation, the main chat and the newest side
  conversations, naming the conversation of each match. read_history reads any of
  them by its taskId.
- A Mico can pin a message in its own conversation for you, for example a final
  draft. Its pins show "Pinned by" with its name, count toward the 100 pins of a
  conversation, and you can unpin them.
- The pinned messages list can show the pins of all of a Mico's conversations.
  Opening one from another conversation opens that conversation, restoring it if
  it was archived, and jumps to the message.
- Each chat has a "Search messages" box that jumps between matches with Previous
  and Next.
- Sidebar search also finds messages in a Mico's side conversations and opens the
  right conversation, and its results can be narrowed to Messages, Micos, Groups,
  Files or Routines.
- A Conversations pane in the chat's side panel lists a Mico's open conversations and the draft
  with their state and time, and shows how many are waiting for you. A conversation opens in the
  chat or beside it, where you can read it, answer its questions and write to it.
- Questions, approvals and takeovers from a Mico's conversations also appear in its main chat.
  Answering a question or an approval there answers it in the conversation; once answered
  anywhere, it disappears everywhere.
- A Mico in the sidebar can be expanded to show the conversations that need a look and the most
  recent ones. Resting the pointer on a Mico shows its conversations.
- The sidebar shows how many replies are unread in a Mico's main chat, and a separate mark when
  only its conversations have new replies.
- A "Needs you" group at the top of the sidebar lists the Micos waiting for an answer, a review or
  a takeover, only while something waits.
- A view menu next to the sidebar search filters chats (Micos, groups, unread, working, folders),
  sorts them by recent activity on request and marks everything as read. The default order does
  not change.
- In a long chat, a banner says how many messages are new, with Jump and Mark as read.
- Notifications say why work stopped: a message or routine that could not start,
  a helper or teammate that failed, a usage or credit limit, and a provider that
  needs you to sign in again. With previews off they still show only fixed text,
  never the Mico's name or the reply.
- Answering a question, approval or takeover on one device closes its
  notification on your other devices that get background web notifications or
  use the Android app. iPhone and iPad keep theirs until opened, because Apple
  requires every push to show an alert.
- Settings > Notifications has a "Replies in task conversations" switch for all
  your devices. It is on by default; turned off, a Mico's own task conversations
  stop alerting when they finish or fail, while questions, approvals and routines
  still alert.
- Both pause controls offer 15 minutes, 1, 3, 8 or 24 hours, or until you turn
  notifications back on.

### Changed

- Mark as Read on a Mico in the sidebar also reads its conversations. Mark as Unread makes its
  newest reply unread again.
- A reply to another Mico's message or delegated task no longer plays a sound or
  sends a notification. It still counts as unread, and its questions, approvals
  and failures still alert.
- A group notifies once per request, when its last member finishes with unread
  replies, instead of once for every member.

### Fixed

- Muting the current server "Until I turn it back on" is saved instead of being
  rejected as longer than seven days.
- A Windows update that was interrupted while installing no longer leaves Mycellios
  Desktop unusable. The next installation restores the previous version first and
  then continues. Before, every later installation stopped at once.
- Keep the faster GitHub download available when recent Desktop releases include many assets.

### Self-host upgrade notes

- Apply the additive migration `20261122200000_message_pin_authors` before starting
  this version. It adds a nullable `pinnedByBotId` column and two indexes to
  `message_pins`; existing pins stay your own pins.
- Apply the additive migration `20261122230000_notification_requests` before
  starting this version. It adds a nullable `sentAt` column to
  `web_push_deliveries` and a system-only `notification_requests` table; older
  services keep delivering notifications without them.

## [0.13.0] - 2026-11-22

### Added

- When a routine runs in its own conversation, the Mico's main chat now shows a short line such
  as "Morning brief ran · Open" that opens that conversation. Several runs of the same routine
  in a row share one line ("3 runs of Morning brief") that lists them when you open it.
- A routine can mark its own run as failed and say why, for example when a site it checks asks
  for a new login. The reason shows in the run history and in the failure notice.
- The routine run history labels each run by what started it (schedule, change, you, a local
  script, a chat mention, a webhook, GitHub or an automatic retry), shows runs with nothing new,
  runs that started late, and how many earlier runs did not happen and why. It loads 100 runs
  at a time instead of 20.
- When a routine pauses itself because its job is done, it says so, and the routine shows
  "Paused by its … run".

### Changed

- A routine run with nothing new no longer marks the Mico's main chat unread, changes its
  preview or moves it up the list; its line in the main chat says "nothing new". A Test or Run
  you start, or a routine you mention in chat, always answers.
- A routine's conversation now follows the routine's new name unless you renamed the
  conversation yourself, comes back from Archived when the routine runs again, and is archived
  (with its history) when you delete the routine.

### Self-host upgrade notes

- The `20261122180000_routine_run_markers` migration adds columns to `runs` (`quiet`,
  `missedRuns`, `missedReason`) and `routines` (`pausedByRunId`, `pausedByRunAt`). It is
  additive with constant defaults and rewrites no table; older releases ignore the columns.

## [0.12.0] - 2026-11-22

### Added

- Each conversation tab of a Mico now has a menu to open it, close it, close the other tabs or the
  tabs to its right, rename it, archive it and delete it. Archive stops the conversation first.
  Delete hides it at once and offers Undo for a few seconds; it waits while the conversation still
  works, and on a phone it asks first.
- Conversation tabs and the Conversations list show whether a conversation is working, waiting in
  line, waiting for you, failed or has a new reply. The list puts the most recently active
  conversations first with their time, and the Conversations button shows a dot when a reply
  arrives in a conversation without a visible tab.
- Keyboard and mouse shortcuts for conversation tabs: Delete or Backspace and a middle click close
  a tab, F2 or a double click renames it, Alt+Shift+Left/Right moves it, Ctrl/Cmd+Shift+O starts a
  new conversation and Alt+Shift+Down/Up go to the next or previous conversation. Tabs can also be
  dragged into a new order, which is kept on this device.
- A conversation that a Mico opens by itself appears as a new tab at the end, without leaving the
  conversation you are in, and says that the Mico opened it. You can rename or delete it like
  your own.
- "New conversation" in a Mico's menu in the sidebar, and conversations of the same Mico can be
  mentioned with @ in a message, which then shows a button to open them.
- A conversation whose last turn failed shows the error until its next turn.

### Changed

- The + button now opens a draft tab. The conversation is created when you send its first message,
  so closing the draft leaves nothing behind, and its unsent text is kept per Mico, also after a
  reload. Before, + created an empty conversation at once.
- Choosing an archived conversation in the Conversations list restores it and opens its tab, and a
  tab closes when its conversation is archived or deleted on another device, coming back when it
  is restored.
- When the header is narrow, the conversation tabs become a switcher with the current title, and
  only the list button when it is very narrow. The Conversations button is hidden while a Mico has
  no conversations.
- Older messages of a conversation now load by themselves when you scroll near the top, keeping
  your place.

## [0.11.0] - 2026-11-22

### Added

- The server can now archive a Mico conversation from any device, restore it, and delete it with
  a 6-second Undo. A conversation is never deleted while it works, and the main chat can never be
  archived or deleted. Each conversation also reports whether it is working, waiting for you or
  finished, how its last turn ended and its last error.
- A Mico can open its own side conversation for a separate job, such as drafting and following
  a forum thread, and keep talking with you in its main chat. The job appears as its own
  conversation, and when it finishes a folded "Update from" note arrives in the main chat with
  the result and a link to that conversation; the Mico then tells you the result. A Mico can
  have up to 8 of these jobs unfinished at once, and it can send a job more instructions or
  close it.
- When you stop one of these jobs, the Mico learns that you stopped it and does not start it
  again unless you ask.
- A Mico can read a conversation it opened from its main chat to find more detail.

### Changed

- The Conversations list of a Mico now marks routine, workflow and delegated threads with a
  short label, and shows conversations archived in Tasks in their own Archived group at the end.
  Only conversations you started can be renamed there.
- A new Mico now greets you in its chat with one question: it says who it is and offers three
  first tasks that fit its role, and you can pick one or write your own. This also happens for
  your first Mico, for the Micos of a team you set up and for Micos that another Mico creates.
- Archiving a conversation in Tasks now stops it first and then archives it. Before, Tasks asked
  you to stop it yourself.
- Writing in an archived conversation from Tasks now brings it back with all its messages. Before,
  Tasks asked you to restore it first.
- A new conversation takes its title from the first line of your first message, up to 120
  characters. Before, it joined the whole message and stopped at 80 characters.
- A conversation title can have 1 to 120 characters on one line, and a title you set is never
  replaced by an automatic one.
- OpenRouter requests now name Mycellios as the referring site, and the Agent docs link to this
  repository instead of the former upstream project.
- Each finished job starts a turn in the Mico's main chat, which uses Credits like any other
  turn.

### Fixed

- Opening a task conversation in a Mico tab now marks it as read, as the main chat does. Before,
  its new replies stayed unread in Tasks until the window lost and regained focus or another
  reply arrived.
- A Mico can now find and reread earlier messages of a task conversation with its history tools.
  Before, searching the history of a task conversation found nothing.
- Writing to an archived conversation from its Mico tab now brings it back to Tasks, with all its
  messages. Before, it stayed archived while the Mico worked on the new message.
- Screens, messages and setup text that still showed the former upstream product name now say
  Mycellios.
- A Mico created by another Mico no longer opens to an empty chat with only a "Created by"
  notice.
- A Mico created before you chose a model no longer stays silent: its welcome starts the next
  time you open its chat with a model ready.
- Windows updates install in about a minute. Mycellios now quits,
  installs and reopens without copying or scanning its files first: the installer already
  keeps the previous version and puts it back if anything fails, and never touches your data.
- On Windows, opening Mycellios while an update is still installing no longer breaks the
  update. The app now says the update is in progress and closes, and the installer reopens
  it when it finishes.
- On Mac, Restart to update now replaces the app and opens the new version by itself instead
  of leaving the disk image for you to drag. If the app cannot replace itself (for example
  without write access to Applications), it opens the disk image as before.
- Mycellios Desktop is smaller. The built-in local server no longer ships type definitions,
  TypeScript sources or test and build tools that it never runs.
- Pausing Generate AI always works. A failed update or settings command on the computer no
  longer leaves the control stuck on "Could not confirm contribution", and a click on a
  running contributor now sends a new pause instead of only checking again.

### Self-host upgrade notes

- The `20261122120000_thread_lifecycle` migration adds nullable columns, checks and indexes to
  `threads` and copies the archive mark of each Tasks entry to its conversation. It changes no
  existing column, so the previous release keeps working if you roll back.

## [0.10.0] - 2026-11-22

### Changed

- Micos you create in Desktop now work on your computer by default, each in its own folder.
  Micos created on the web or mobile keep their own private workspace on the server. You can
  still change where a Mico works in its settings.
- When a Mico set to This PC gets a new message while the PC is offline, the chat now says that
  the message runs on the server, without the PC's files.
- New Micos that work on This PC keep their files in a folder you can find, named after the Mico,
  under Mycellios/Micos in your home folder. Mico settings show where it is and open it. Micos that
  already work on this PC keep their files where they are.

### Fixed

- The This PC setting now says what really happens when the PC is offline: a new message runs
  on the server, without the PC's files, and work already running on the PC stops.
- A Mico with its own server computer no longer fails with "Computer limit reached" when another
  Mico in the same space left its computer running. An idle computer is put to sleep, with its
  files saved, so the new one can start. Computers that are working keep running.

## [0.9.1] - 2026-11-21

### Fixed

- Long Mico tasks on your computer with many screenshots or images no longer stop with
  "Desktop execution interrupted". The oldest images are left out of the request when the
  conversation gets too large for the connection; the latest ones are kept.
- On a Mac, a Mico task on your computer no longer stops with "Desktop execution interrupted"
  while you use another app. Mycellios now keeps macOS from pausing it until the task ends.
- A Mico working on your computer no longer stops with "Desktop execution interrupted" when
  several of its steps, or a routine of the same Mico, run at once. It now waits for the
  computer to have room instead of giving up.
- Desktop no longer refuses to send messages to a Mico that has its own server computer
  ("The workspace response did not match this Mico"). Those messages now run on the server,
  as they do on the web, without connecting your PC.

## [0.9.0] - 2026-11-21

### Changed

- Windows updates download only what changed: Mycellios reuses the parts of the installer it
  already has and fetches the rest, falling back to a full download whenever that is not possible.
- The Windows installer is about 40 MB smaller and the installed app uses about 200 MB less disk:
  it no longer ships the debugging maps of its bundled libraries.

## [0.8.1] - 2026-11-21

### Fixed

- When the server cancels a step running on your PC, Mycellios Desktop now stops that step
  instead of finishing it unobserved and resending results the server no longer accepts.
- A chat now says "Working in another conversation…" when its Mico is busy in another of its
  conversations, instead of showing nothing while the sidebar says it is working.
- Desktop updates download much faster: Mycellios now fetches the installer from the release's
  download network, falling back to the website copy of the same verified file.
- Updates on slow connections no longer fail after 15 minutes; a download is only abandoned when
  it stops receiving data.

## [0.8.0] - 2026-11-21

### Added

- The model picker lists new models from every connected provider as soon as they are released,
  without waiting for a Mycellios update. Recent models carry a New label, and earlier models of
  each provider fold under Older models; a search still finds every model.
- Micos can watch public videos. Paste a YouTube, TikTok, Instagram, Facebook, Vimeo or X link
  and ask for the highlights: the Mico reads the title, description and captions and looks at
  still frames. Without captions, it transcribes the audio when speech recognition is set up in
  Voice settings.
- Build an app with a team of Micos. In the app editor, choose "Construir con equipo", pick
  teammates and send the prepared request: the app's Mico splits the work and reviews it. While
  they work, the private preview shows each Mico's named cursor at the part it is editing and
  how many are building.
- A server can now require a newer Mycellios Desktop. When the installed app is older than the
  server's minimum version, a full-screen notice offers to download and install the update; "Not
  now" hides it for an hour so you can finish unsaved work first.
- On Windows, Micos can use the apps on your PC: they read your open windows and press buttons,
  choose menu items and fill in fields, without needing a vision model. Turn it on in Settings >
  Computer use. Each action asks for your approval, and Micos never control Mycellios, password
  managers or system security prompts.
- Share what your Micos make with anyone. Open a file in the Library and choose Share to get a
  link that opens that version without signing in. Newer versions stay private until you share
  them, and Stop sharing turns the link off for everyone.
- Close a Mico's browser sessions from its Computer settings. The Mico is signed out of every
  website and its next task starts with an empty browser. Your own PC's browser is not touched.

### Changed

- "Use free models" now always starts on Mycellios Free, served through AntSeed. When no free
  AntSeed route is available it says so instead of switching to OpenCode's free models or another
  free model.
- Mycellios is now published under the PolyForm Shield License 1.0.0: you can use,
  modify and share it, but not to build a competing product. Earlier versions keep their
  original licenses, and code from other projects keeps its own.

### Fixed

- Tools from remote MCP servers can now take up to two minutes to answer. Before, a
  slow answer was cut off after 30 seconds, the same limit used for connecting.
- Show newly released ChatGPT models in the model picker. Before, a ChatGPT subscription only
  listed the models that an older Codex release supported, and some showed their raw id and no
  image support.
- Restarting to update on Windows shows a progress window as soon as Mycellios closes, instead of
  leaving the screen empty until the installer starts. The update also finishes faster, because it
  no longer backs up development source copies.
- An update no longer fails when Windows keeps one of the app's saved files busy for a moment
  after it closes.
- Mycellios removes old update downloads and backups after an update, instead of keeping every
  installer it has downloaded.
- The usage indicator keeps a ring for each connected subscription while its quota is being
  checked, so accounts no longer disappear and reappear in the sidebar.
- Right-clicking in the desktop app now opens a menu to copy an image, a link or selected text,
  and to cut, copy and paste in text fields.
- Micos that use a Claude subscription no longer fail on newer Claude models with "Claude Code
  version too old". Mycellios now identifies with the current Claude Code release.

### Self-host upgrade notes

- The WhatsApp linked-device connector stays off until the API runs with
  `MYCELLIOS_WHATSAPP_DEVICE_ENABLED=true`. Apply the database migrations first.
  Desktop release builds do not include the WhatsApp runtime yet, so linking a number
  is not available in the published app.

## [0.7.0] - 2026-11-20

### Security

- Desktop's PC command executor now accepts connections only from this computer. Before, other
  devices on the same network could reach it, although they still needed its private key.
  Installations that still use the older Docker setup keep the previous behaviour.
- The local Desktop server rejects requests addressed to any name other than this computer, which
  blocks web pages that try to reach it through DNS rebinding.
- Account actions refuse requests that the browser marks as coming from another site, in addition
  to the existing cookie protection.
- Desktop now protects the local server's identity, which holds the local database password and the
  key that encrypts saved conversations, with the system's secret store: Windows DPAPI, the macOS
  Keychain or the Linux keyring. Before, it was a plain file in the profile folder. Existing
  installations are converted on the next start without changing any data. On Linux without a
  keyring, the key stays in a file only your user can read, as before.

### Added

- With "Show a plan before long tasks" on, a Mico shows its plan in a card with Start and
  Cancel before a long task. Without an answer it starts by itself after 10 seconds; the
  setting can change the wait (5 to 60 seconds) or make it always wait for you.
- While a Mico works, its task list stays open and updates with each step.
- With developer mode on, the Mycellios Dev entry shows its state: the current step and
  elapsed time while it prepares, and "Mycellios Dev is running" once it is open. A stop
  button ends it, and a logs button shows its recent output.
- Generating an image in a chat now shows a card straight away, in the shape the Mico
  asked for, with a moving dotted canvas while the picture is made. The finished image
  replaces it at its real proportions, with its size, the prompt and buttons to download
  it or open it full size. A failed or stopped generation stays visible on the card with
  the reason.
- Micos can ask for a square, portrait or landscape image.
- A Mico that edits an app can hand parts of it to other Micos: the teammates it delegates
  to can read and edit the same app draft, and Micos working on different files of the app
  can save at the same time without overwriting each other. Publishing still needs your
  explicit action.

### Changed

- Micos answer in short chat messages: the result first, in about 60 words, without run
  numbers, hashes or logs unless you ask for them.
- In the natural response style, a chat turn shows the Mico's short notes between steps,
  one folded steps line and then the complete answer, instead of an answer that grows
  while it streams. Repeated or empty notes no longer appear, and progress notes on long
  tasks have no message actions. Classic keeps the earlier view.
- A Mico that delegates work tells you the outcome in its own words instead of forwarding
  the other Mico's report. Delegated work answers with a short status, result and evidence.
- Several messages in a row between Micos fold into one "N messages with …" line.
- A Mico's task list shows as a folded "{done} of {total} tasks done" line above its answer.
- Notifications show the first whole sentences of a reply, and unfinished tasks or short
  readable errors get a clear message instead of a generic error.
- A finished reply over 20,000 characters shows its beginning with "Show full message".
- "Use free models" starts new accounts on Mycellios Free, which spreads conversations over
  every free model Mycellios has checked can use tools, and moves on by itself when one stops
  being available. It never falls back to a paid model: when no free model is available, it
  says so and leaves the subscription option open.

### Fixed

- Image generation through Codex works on Windows again. Before, Codex refused to start the
  image session there, and every request failed with a generic error. When the ChatGPT plan
  behind Codex reaches its usage limit, the Mico now says so instead of a generic failure.
- Opening Mycellios Dev for the first time no longer stops after 10 minutes while it
  installs dependencies, which made every attempt start the installation again.
- Opening Mycellios Dev again from the same chat while it prepares joins that launch
  instead of failing.
- Mycellios Dev no longer reinstalls a checkout's dependencies only because Desktop and the
  terminal use different patch versions of Node.

## [0.6.0] - 2026-11-19

### Added

- Hifa Store app owners can let their app save each visitor's own data (for example
  a project's settings) in their account. The app never sees who the visitor is,
  each person only sees their own data, and the app's card shows that it can save.
- Hifa Store app owners can let their app download the files it creates, such as an
  exported video. Apps without this permission still cannot download anything.
- The app editor keeps the last 50 versions of each draft, including your Mico's
  edits, under "Historial de versiones". Restoring one makes it a new draft version
  and never changes the published app.
- Hifa Store apps can ask to keep large files for each person, such as videos or
  images. This stays unavailable for now: the editor shows it as "No disponible
  por ahora" and nothing can be uploaded until a server operator turns it on.
- New accounts start with one question: use free models, or connect your ChatGPT or Claude
  subscription. Free models open your team on a free Mycellios model. Without a Mycellios
  account they use OpenCode on this computer, and the team still opens if neither is available.
- The subscription step lists Codex, Claude Code and OpenCode installed on this computer
  next to ChatGPT and Claude sign-in.
- The rail shows a usage ring for each connected account that reports its plan limits, such
  as ChatGPT and Claude together, instead of only one.

### Changed

- Hifa Store apps can play video and audio that they include or create in the
  browser. Before, any video in an app stayed blank.
- Settings switch sections without delay. The app behind the full-screen Settings panel no longer
  redraws on every click.
- The bottom of the left rail now shows, from top to bottom: usage, Hifa Store, Help, Settings and
  your server. Sign out is in Settings > Profile and connected apps are in Hifa Store > Integrations.
- Startup, background and keep-awake options have their own Settings section, "Application
  behavior", under the new "This computer" group. "Account" groups Profile, Billing and Mobile
  connection.
- Setup screens use one simpler layout: a centered title, grouped choices and one main button.
  The step-by-step team questions are no longer part of first run.

### Fixed

- A Mico working on your PC no longer stops when its workspace holds a large file. Its
  workspace now belongs to the PC: Mycellios only copies the saved files into a new PC
  workspace, sends large files in verified pieces, and never copies `.git`, `node_modules`,
  `.env` files, private keys or archives between machines.
- If preparing the Mico's computer fails after the task reached your PC, the chat now says
  why, instead of retrying it and showing a misleading "connection changed" error.
- Desktop no longer reports finished operations as interrupted.

### Self-host upgrade notes

- Apply the database migrations `20261118170000_hosted_web_data` and
  `20261118190000_hosted_web_snapshots` before starting this version.
- Apply the database migration `20261118210000_hosted_web_files` before starting
  this version. Large app files stay off unless you set
  `MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true` and configure object storage
  (`OBJECT_STORAGE_*`); they are never stored on the server's local disk.
  `MYCELLIOS_HOSTED_WEB_FILE_MAX_MB` and `MYCELLIOS_HOSTED_WEB_FILES_QUOTA_MB` can
  lower the limits of 25 MB per file and 250 MB per person per app.

## [0.5.1] - 2026-11-18

### Fixed

- Use each Mycellios model's own context window and output limit. Before, DeepSeek and other
  AntSeed models shared the network's smaller default window, so a Mico with computer tools
  could stop with "This model's context window is too small".

## [0.5.0] - 2026-11-18

### Added

- The sign-in page says how your data is used and links to the Terms of Service and the
  Privacy Policy, now published as drafts at /terms and /privacy.

### Changed

- What's new shows every version since your last update, grouped into New, Improved and Fixed.
  Long fix lists start closed, and the dialog links to the full changelog.
- The chat list on narrow screens uses smaller avatars and names.

### Fixed

- Restart in the update notice now restarts Mycellios right away instead of leaving the
  update waiting. Running local tasks are saved and resume after the restart; unsaved
  changes and calls still ask you first.

## [0.4.0] - 2026-11-17

### Added

- Ollama Cloud preset in Models settings on web and mobile, using an OpenAI-compatible connection with model discovery and no deployment configuration.
- Bot computer homes can live in any S3-compatible bucket instead of only on the server's disk: set `OBJECT_STORAGE_BUCKET` and its connection settings on the API and worker. Homes are encrypted on the server before upload with a per-home key, each saved revision is a single object, and deleting a bot or space makes its stored home unreadable at once. `home-storage migrate` uploads existing homes and verifies each one. Without the setting, homes stay under `DATA_DIR` as before ([self-hosting](docs/self-host.md#bot-homes-in-object-storage)).
- Stdio MCP servers can connect with OAuth from the MCP servers settings. Mycellios runs the authorization against the provider you name (for example Google), stores the grant encrypted, refreshes it, and passes it to the process through environment variables (`{{oauth.access_token}}` and similar references) or through credential files written to a private temporary directory, so packages that expect a browser login or a token file run unattended. Any client can also limit the scopes it requests.
- Stdio MCP servers can be given environment variables when added in **MCP servers**, under **Advanced**. Values are stored encrypted, like the other server credentials, so API keys a local server reads from its environment no longer have to be pasted into a chat. The form's secret fields no longer invite the browser to fill in a saved password.
- Honcho memory can read an existing Honcho user peer. After entering the workspace another Honcho app already uses, a Space can name that app's user peer under User peer, and recall then includes what Honcho already knows about the user. Mycellios only reads that peer through Honcho's chat; it never creates it or writes conclusions to it.
- Remote MCP servers whose OAuth provider does not offer dynamic client registration can now be connected: enter a client you created in the provider's console under **Advanced** when adding the server, and allow the **Redirect URI** shown there. The client is stored encrypted, its secret is never returned, and it survives **Disconnect**; switching to a different client drops the current grant.
- The web app installs as a PWA on phones: Android Chrome offers a real install prompt, the app shell and its assets are cached so an installed app opens offline (showing its reconnecting state), and a new deploy takes over on the next launch or reload. On iOS the installed app runs full screen and keeps content clear of the notch and home indicator. Electron and dev builds never register the service worker, and API, RPC and screen traffic always go to the server.
- Self-hosted deployments can run multiple Telegram bots, for example one per space, using `TELEGRAM_BOT_TOKEN_<NAME>` and `TELEGRAM_WEBHOOK_SECRET_TOKEN_<NAME>` pairs.
- Railway computers can start in a chosen region. Set `RAILWAY_SANDBOX_REGION` to keep them near the API instead of Railway's default region, so each command, click, and screenshot avoids a cross-region round trip. Unset, nothing changes.
- A ```mermaid block in a bot's message is drawn as a diagram, on the web, in the desktop app and on mobile, in the app's light or dark palette. Source Mermaid cannot draw stays a code block, and a block the bot is still writing reads as code until it is complete. On the web, Mermaid loads only when a message contains a diagram, and a diagram's source can be copied. The mobile app draws diagrams with Mermaid served by your own server (`/api/v1/assets/mermaid.js`), so an older server keeps showing code blocks.
- A routine can run on its own model and thinking level, picked in the routine editor. Left on the bot's model, nothing changes. A run keeps the model chosen when it was created, so editing the routine afterwards cannot move a waiting run, and a later resume does not treat the model an attempt recorded as that choice. Webhook, GitHub, and message deliveries use a routine model when every routine in that delivery chose the same one, including when the delivery has to wait for the bot to finish.
- The deployment-wide default model can run on Amazon Bedrock without a key. With `PI_DEFAULT_CREDENTIALS=host`, `PI_DEFAULT_PROVIDER=amazon-bedrock` and `PI_DEFAULT_MODEL` set, a deployment whose host has an AWS role (an ECS task, IRSA or EC2 instance role) counts as having a default model, and runs use those credentials instead of a stored Bedrock API key.
- Voice mode: spoken replies, hold-to-talk dictation, and half-duplex calls with ElevenLabs, OpenAI, Cartesia, or Fish Audio.
- Desktop owners using Docker can opt into running bot shell commands directly on their computer. This grants access under the owner's OS account; see [computer providers](docs/self-host.md#choosing-a-computer-provider).
- GitHub Copilot and SuperGrok / X Premium sign-in for model access.
- Spawn peer bots (each with its own thread and computer) and short-lived in-thread subagents.
- ChatGPT Plus or Pro sign-in for model access.
- Mobile: point the app at a self-hosted API origin, a native iOS inbox, and take control of the live desktop.
- Provider-neutral integrations: managed apps through Composio or Pipedream Connect, plus encrypted user-installed Treg, HTTPS MCP, and OpenAPI tool sources on web and mobile.
- Disconnect connected Composio plugins.
- Routines in plain language instead of raw cron.

### Changed

- Mobile routine and connector mention suggestions load only when requested, with bounded routine-request concurrency.
- MCP result truncation no longer allocates an encoded copy of the full oversized result.
- Sitemap filtering reads blog category counts only for category URLs, without caching content across builds.
- Linux idle probes inspect background-work descriptors in one process. Browser shutdown polls the selected browser and checks for a replacement before clearing lock files.
- Browser unit tests use jsdom's isolated local storage on Node 26 instead of inheriting the host storage global.
- The production and source-checkout Compose stacks run Postgres 18 instead of 16. An existing install runs `infra/compose/upgrade-postgres.sh` once ([upgrading to Postgres 18](docs/self-host.md#upgrading-to-postgres-18)): it copies roles, passwords and databases to a new volume, checks grants, row-level security and row counts, and leaves the Postgres 16 volume as it was for rollback. Until then the new database container refuses to start on the old volume instead of starting empty, and production deploys stop before replacing anything. The published-images stack and the desktop app stay on Postgres 16.
- A bot's Model field on the web and in the mobile app, and the mobile model settings, now mark models that cannot read images, as web Settings already did. Moving a bot to a text-only model is no longer a silent loss of image reading.
- Message bubbles in the web/PWA transcript use more of a wide window's width (70%/74% caps raised to 84%/88%, still leaving room for the hover-actions gutter), instead of leaving a quarter to a third of a long message's row empty.
- Every run's system instructions now state the current date and time (UTC), so bots judge deadlines, recency and scheduling from the real present instead of guessing it from training data or quoted timestamps.
- Connect Slack, WhatsApp Business Cloud, or Telegram DMs to a bot from Messaging settings, alongside iMessage/SMS. Each app can use a different bot. Group conversations remain iMessage-only.
- Model picker includes Grok 4.6 (xAI) and Ox Alpha Free / GLM-5.3 (OpenCode Go).

### Removed

- Nonfunctional Grant folder picker in the desktop app.

### Fixed

- Mobile threads now show work started by another client as soon as the run starts, without hiding waiting runs or another group member's error.
- Mobile chat and call subscriptions reject oversized event frames and release their readers after cancellation or connection failure.
- Thread snapshot recovery replays durable events instead of retaining their payloads in memory, without repeating notifications already delivered. Late voice-call snapshots no longer replace newer work or a replacement call.
- The offline installer now rejects missing local inputs without downloading files or starting services.
- Development backups use private permissions. Restore validates files before importing SQL, replaces the saved data tree instead of merging it, and preserves the previous tree for recovery.
- Gemini runs could fail with "Function call is missing a thought_signature" after earlier tool calls in the same turn lost their signature on the way back to Google. Every Gemini request now carries the original signature when one is usable and Google's documented placeholder otherwise.
- Images and files a bot attached to its reply in a Telegram chat were dropped, so only the text arrived. They now follow the text as their own messages: PNG, JPEG, GIF and WebP images under 10 MB as photos, anything else up to 50 MB as a document. A file that still cannot be sent after its retries is replaced by a short note naming it, and the text is never sent twice. Other chat apps still receive the text only.
- Self-hosted stacks behind a reverse proxy on the host gave every user one shared sign-in rate limit, so ten failed sign-ins anywhere locked everyone out for 15 minutes. If `TRUSTED_PROXIES` is unset, the API in a container now trusts loopback and the stack's own networks. Outside a container it trusts loopback only. Each client gets its own limit again, and bot computers still cannot choose their address.
- Upgrading a stack installed before restricted computer egress existed stopped its Docker computers from starting until the host firewall rules were installed. The updater now also adds a missing `POSTGRES_APP_PASSWORD` before it recreates services, so the newer Compose files start.
- A Railway computer whose sandbox had been destroyed could not start again: it failed with "Railway live screen requires PRIVATE networking" instead of creating a new sandbox, because Railway no longer reports networking for a destroyed sandbox. It now starts a new sandbox and restores the portable home.
- The Amazon Bedrock model picker was missing newer models available on Bedrock: Claude Sonnet 5.5, GPT-6 Luna, GPT-6 Sol and GPT-6.1 Sol, Grok 4.7, Kimi K3, GLM-5.3, and the India (`in.`) Claude inference profiles. They are now listed with their regional and global inference profiles until the bundled provider library ships them.
- Fish Audio speech can use a model other than s2.1-pro. Each Fish connection can set Speech model in Voice settings; `FISH_TTS_MODEL` is the default only when that field is empty (unset still uses s2.1-pro). A failed speak, transcribe, or voice-list request logs the upstream Fish status and message, including when the error body cannot be read, and the message returned to the client does not include the API key.
- A picture attached to an earlier message is now visible to the bot when a later turn asks about it, for a model that can see images. Only the current turn carried its images; older turns arrived as a text marker, so the bot asked for the picture again. The most recent user turns now keep their images, within a fixed turn, byte, and per-model image budget. A turn whose pictures exceed the byte budget keeps the newest ones that fit. If an earlier picture cannot be read, its history marker says it is unavailable.
- A bot on a reasoning model could answer with "No response. Try again." on a harder question: thinking is billed against the same output ceiling as the reply, and the 4k default left nothing for the reply itself. Reasoning models now get a 32k output ceiling instead, still bounded by whatever the model itself allows.
- A newly created bot's thread opened empty and stayed silent until given real work, so a misread `title`/`description`/`instructions` went unnoticed until it cost a run. Creating a bot now queues one turn where it states how it understood its role and asks for anything it needs.
- A message sent while that introduction was still running was answered by the intro, which cannot use tools. The message now waits until the introduction finishes and is answered in the following turn, and the introduction does not send a finish notification. A reply to a message from a linked chat app still goes back to that app. Messages held from different chats, such as a group channel and a direct chat, are answered in separate turns.
- A message sent to a bot while it was working on another bot's request joined that request. The bot's answer went back to the other bot and was folded under its "Message from" line, so the person who asked saw no reply. The message now waits until that request finishes or stops for input, and is answered in its own turn in the chat.
- A message sent while one of the bot's routines (or an inbound webhook) was running in the same thread was folded into that turn as steering, so the bot answered without the conversation ("I have no earlier context"). The message now waits until that turn finishes and is answered in its own turn with the full thread. A composer reply while that run is already waiting for input still answers the ask, unless a live conversational run is active to take the message.
- Every turn failed on Claude models through Amazon Bedrock with "input_schema does not support oneOf, allOf, or anyOf at the top level": `request_secret` declares its two destinations as a root `oneOf`, and Anthropic rejects the whole request for it. Root unions in tool schemas, including ones from MCP servers, are now merged into a single object schema before they reach a provider; the executor still enforces credential or `connectionId`, not both.
- Pipedream exposed every tool of every connected app at once, so a handful of apps could fill a run's tool list. Above 20 tools the connector now offers the same lazy catalog the MCP connector uses (`pipedream_search_tools`, `pipedream_load_tool`, and `pipedream_execute_tool`), with names grouped by app.
- The Needs you computer card in a thread now includes Open, which opens that bot's computer the same way the computer panel does, including from a group member bot.
- Bots with more than 20 MCP tools failed on every Claude model behind a Claude Pro/Max/Team sign-in with "You're out of extra usage": Anthropic rejects Claude Code OAuth requests that carry a tool named `mcp_*`. The lazy catalog wrappers are now `connectors_search_tools`, `connectors_load_tool` and `connectors_execute_tool`.
- Changing a bot's model, thinking level or voice failed with a validation error once its instructions outgrew the description limit, and saving any other setting overwrote those instructions with the shorter description text. Bot settings now put the description and instructions on the wire only when that field was edited, clamped to each field's own limit.
- On macOS, the window buttons (close, minimize, zoom) now sit inside the left rail, centred on the
  top row. Before, they overlapped the rail border and the workspace name.
- On macOS, the window can be dragged from any empty part of the top bar. Before, the conversation
  tabs and the workspace name covered most of it, so only small gaps moved the window.

### Self-host upgrade notes

- Back up Postgres and `DATA_DIR` before upgrading, and store `ENCRYPTION_KEY` (and `ENCRYPTION_MASTER_KEYS`, if set) apart from them. New messages, events, memory and files are encrypted at rest with keys derived from them, and that content cannot be read without them. To roll back to an earlier release, first run `content-encryption decrypt` ([content encryption](docs/content-encryption.md#rollout)).
- Content written before this release stays in plaintext until you run `content-encryption migrate` ([content encryption](docs/self-host.md#content-encryption)); new content is encrypted from the first start. Set the new `CONTENT_ENCRYPTION=off` to store content readable instead: existing ciphertext still reads, and `content-encryption decrypt` converts it. Compose, published images and Railway default to `on`; the desktop app's **This computer** stack and local development default to `off`.
- The API and worker connect as a separate database login, `rakazo_app`, whose password is `POSTGRES_APP_PASSWORD` in `.env`. `install-images.sh`, the updater, the desktop app and `deploy-main.sh` add it when it is missing. If you upgrade a source checkout (`docker-compose.yml`) or run the production Compose commands by hand, first run `echo "POSTGRES_APP_PASSWORD=$(openssl rand -hex 16)" >> .env`. Otherwise Compose stops with `Set POSTGRES_APP_PASSWORD in .env`.
- The API and worker containers receive only the settings they read, not the whole `.env`. A setting whose name you choose, such as `TELEGRAM_BOT_TOKEN_<NAME>`, needs an [override file](docs/self-host.md#settings-with-names-you-choose). `install-images.sh` names every `.env` setting that no container receives, and layers `docker-compose.override.yml` when it is present.
- Unless `SANDBOX_COMPUTER_EGRESS` is set, Docker computers use restricted egress when the host firewall rules are installed, and open egress as before when they are not ([restricted computer egress](docs/self-host.md#restricted-computer-egress)).
- Only the deployment owner can use an OpenAI-compatible model or voice server on a private address, such as a LAN Ollama, `host.docker.internal` or a host listed in `RAKAZO_OPENAI_COMPAT_PRIVATE_HOSTS`. Other users' runs on such a connection fail with "Private model endpoints are limited to the deployment owner." Set `MCP_ALLOW_PRIVATE_ENDPOINT=true` to allow them for every user, or serve the models to everyone with `RAKAZO_LOCAL_MODELS`.
- A bot asks before fetching a site that it was not given in the run. This includes routines. Choose **Always allow** on the approval card or turn on Auto Review. Webhook runs refuse such sites.
- The web app sends a strict Content-Security-Policy, which blocks scripts that a CDN or proxy injects. Search the API logs for `csp.violation` and add the origins with `RAKAZO_CSP_SCRIPT_SRC` and `RAKAZO_CSP_CONNECT_SRC`.
- Mobile app users need to sign in again once.

### Messaging upgrade notes

- Webhooks use `/api/v1/messaging/webhook/<provider>`; the previous Sendblue path remains supported.
- Configure credentials for each messaging provider in `.env`; see [.env.example](.env.example).
- Unknown senders are ignored by default. `MESSAGING_OPEN_SIGNUP=true` restores automatic account
  creation from incoming messages and requires a deployment model key.

## [0.1.0-beta] - 2026-08-13

Initial public beta: web, Electron, and Expo clients; Pi runtime; Docker and E2B computers; plugins; one thread, computer, memory, routines, and history per bot.
