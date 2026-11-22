# Changelog

Notable product changes in Rakazo. See GitHub Releases for tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
- Stdio MCP servers can connect with OAuth from the MCP servers settings. Rakazo runs the authorization against the provider you name (for example Google), stores the grant encrypted, refreshes it, and passes it to the process through environment variables (`{{oauth.access_token}}` and similar references) or through credential files written to a private temporary directory, so packages that expect a browser login or a token file run unattended. Any client can also limit the scopes it requests.
- Stdio MCP servers can be given environment variables when added in **MCP servers**, under **Advanced**. Values are stored encrypted, like the other server credentials, so API keys a local server reads from its environment no longer have to be pasted into a chat. The form's secret fields no longer invite the browser to fill in a saved password.
- Honcho memory can read an existing Honcho user peer. After entering the workspace another Honcho app already uses, a Space can name that app's user peer under User peer, and recall then includes what Honcho already knows about the user. Rakazo only reads that peer through Honcho's chat; it never creates it or writes conclusions to it.
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
