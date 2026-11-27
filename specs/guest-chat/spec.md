# Registration-free guest chat on the web

Status: proposed, not implemented. Owner decision pending on the open questions
at the end. Nothing here is enabled until an operator turns it on.

## Goal

A visitor who presses "Open in browser" on the landing page can talk to a Mico
right away, without creating an account. Registration moves from the first step
to the moments where it adds value: keeping the conversation, sending more
messages, using tools or files, connecting a device, or earning Credits.

Guest chat exists only in an ordinary browser tab. Desktop, the Android host, the
Expo app and installed PWAs (standalone display mode) keep requiring sign-in.

## Non-goals

- No tools of any kind for guests: no computer, shell, files, browser, Chrome tabs,
  MCP, web fetch, memory, routines, workflows, delegation, groups, voice, media or
  app building. Guest chat is text in, text out.
- No Credits, wallet, welcome grant, referral grant, Spore or contribution for
  guests. Guests never reach a priced offer.
- No Agent user, Space, Mico, thread or message rows are created for a guest.
- No change to the event demo (`specs/event-demo/spec.md`); it stays a separate,
  operator-run campaign with its own grant and presenter.

## Product flow

1. The landing "Open in browser" button keeps linking to the Agent entry URL.
2. An unauthenticated visitor on the bare Agent entry route (no `?task=`, `?inbox=`,
   `?settings=` or other deep link) sees the guest chat when the coordinator reports
   guest chat as enabled. Deep links keep the existing sign-in redirect.
3. The guest chat shows one default Mico, a composer, a visible notice
   ("Guest mode. Answers come from a free model served by third-party providers
   and the Mycellios network. Do not share sensitive information.") and persistent
   Sign in / Create account actions.
4. The visitor can send up to the per-guest message limit. The remaining count is
   visible once it is low.
5. Registration is offered when the limit is reached, when the visitor asks for
   something that needs an account (attach a file, use a tool, save, new Mico), and
   from the persistent actions. Reaching a limit never deletes the visible transcript.
6. After a verified registration in the same browser tab, the person can keep the
   conversation: the client offers to import it into a new side conversation of
   their first Mico (phase 3).
7. When guest chat is disabled, exhausted or failing, the entry route falls back to
   today's sign-in flow with a short explanation. A signed-in visitor never sees
   guest chat.

## Architecture

Guest chat reuses the coordinator's managed free route and the event demo's
scoped-cookie pattern. It adds no Agent tenant data.

### Coordinator

- Configuration `MYCELLIOS_GUEST_CHAT_*`, parsed in `src/core` like
  `event-demo-config.ts`, disabled by default. It carries the enabled flag and every
  limit in "Limits" below. Invalid values fail startup, like the managed provider
  config.
- Routes under `/mobile/v1/guest/`:
  - `GET  config`: enabled flag, limits shown to the visitor, challenge parameters.
    No cookie needed, cacheable for a few seconds, no account data.
  - `POST session`: verifies the admission challenge (below), creates or resumes a
    guest session and sets the cookie. Idempotent per browser nonce, like the event
    demo enrollment nonce (only its hash is stored).
  - `POST chat`: one bounded chat turn for the current guest session, streamed as SSE
    with the same terminal-event and usage requirements as native loopback chat.
- Every write route requires the exact first-party `Origin`, a JSON body within a
  fixed byte bound, and the guest cookie. There is no CORS grant. GET never starts
  inference or admission.
- The guest cookie is `__Secure-mycellios-guest` (`mycellios-guest-local` on
  loopback): HttpOnly, Secure, `SameSite=Strict`, `Path=/mobile/v1/guest`, holding a
  random session token whose SHA-256 is stored. No ordinary route accepts it, and it
  never replaces or reads the SSO session cookies. The Agent web Dev proxy forwards
  only this cookie on guest paths, mirroring `event-demo-proxy.ts`.
- `POST chat` accepts only text messages: at most the history and size limits below,
  roles `user`/`assistant`, no tool calls, no images, no attachments, no model field.
  The model is always the configured free model (`mycellios/managed/free`). The
  server owns the system instructions (a short, friendly Mico persona that says it
  is in guest mode and cannot use tools) and the output token ceiling.
- Execution reuses the managed free path in `managed-provider.ts` with a synthetic
  account namespace `guest:<session id>`. Implementation must confirm the
  zero-priced path needs no wallet row, and must add none. Purchases are recorded as
  today with `maximum_usd='0'`, so the existing safety stop and receipts apply.
- Guest traffic never takes a priced offer and never falls back to another
  provider. On an explicit 429 allowance refusal the seller rests as usual, but a
  guest request does not retry on another exact-zero route
  (`FREE_REFUSAL_RETRIES` is 0 for guests), so guests do not drain the reserves that
  registered accounts rely on.
- Before each guest turn, admission checks: kill switch, session expiry, per-session
  message count, per-network-prefix counters, global guest daily budget, global
  guest concurrency, the provider safety stop and free-pool headroom. Refusals are
  explicit error codes, mapped to visitor-facing text like
  `managed_free_daily_limit_reached` today.
- Schema: export `guestChatSchemaSql` as owner SQL (like `eventDemoSchemaSql`),
  applied by the migration owner, never at coordinator startup. Tables hold only
  counters and digests:
  - `guest_chat_sessions`: id, token hash, nonce hash, network prefix digest
    (HMAC with a coordinator secret, never the raw IP), created/expires, message
    count, state.
  - `guest_chat_usage`: per UTC day and per network prefix digest, plus the global
    daily total, updated in the same transaction as the turn admission.

  Without the tables, guest chat reports itself unavailable instead of crashing.
- No request or response content is written to the database, logs, telemetry or
  error reports. Logs carry error codes, session digests and timings only, as with
  `contentFreeFailure` for contributors.

### Admission challenge

- Session creation requires a proof of work issued by `GET config`: a server-signed,
  short-lived challenge with a difficulty the operator configures. The browser
  solves it in a Web Worker in about a second on a mid-range phone. This needs no
  third-party script and no new privacy processor.
- An optional Cloudflare Turnstile verifier can replace or add to the proof of work
  later. Adopting it requires a CSP change, a privacy-policy update and an owner
  decision (see open questions).
- The challenge gates session creation, not every message. Per-message abuse is
  bounded by the session, prefix and global limits.

### Agent web

- A `GuestChat` surface mounted before `SessionApp` when the visitor has no session,
  the route is the bare entry and `GET config` reports guest chat enabled. It never
  mounts `Shell`, RPC clients, realtime or service-worker push.
- It reuses the transcript and composer presentation components with tools,
  attachments, voice, model picker, pins and menus disabled. No duplicate design
  system: same kit and tokens.
- The transcript lives in memory and `sessionStorage` only (with try/catch), so a
  reload keeps it in the same tab and closing the tab forgets it. The client sends
  the bounded recent history with each turn, because the server stores none.
- Assistant markdown is rendered without remote images, iframes or HTML, and links
  open with `rel="noopener noreferrer nofollow"`. This prevents tracking pixels and
  exfiltration through generated content.
- The surface shows the guest notice, the remaining message count, a clear
  limit-reached state with Create account / Sign in, and a busy state when the global
  guest budget or the free pool is exhausted.
- Native hosts (Desktop bridge, Android WebView host, Expo) and standalone PWAs never
  show guest chat. They keep the current sign-in flow.

### Landing

- Copy near "Open in browser" may say "Try it free, no sign-up" only while guest chat
  is enabled in production. The landing reads the same public config and falls back
  to today's copy otherwise.

## Limits (defaults, all operator-configurable)

| Limit | Default |
| --- | --- |
| Messages per guest session | 12 |
| Session lifetime | 24 hours |
| History sent per turn | last 8 messages, at most 24 KiB of text |
| Single message size | 4,000 characters |
| Output tokens per answer | 800 |
| New sessions per network prefix (/24 IPv4, /64 IPv6) per hour | 5 |
| Guest messages per network prefix per UTC day | 40 |
| Global guest messages per UTC day | 2,000 |
| Concurrent guest turns, global | 16 |
| Concurrent turns per session | 1 |

The global guest daily budget is separate from, and never consumes, the per-account
free allowance of registered users (`DEFAULT_FREE_DAILY_REQUESTS`).

## Threats and mitigations

- **Free API scraping.** No CORS, exact Origin, SameSite=Strict cookie, proof of work
  per session, per-prefix and global caps, short output ceiling and a fixed model.
- **Draining the shared free pool.** Separate global guest budget, no reserve
  promotion retries for guests, admission only with free-pool headroom, and a kill
  switch.
- **Tool abuse and prompt injection.** No tools exist on the guest path. The server
  rejects tool calls, images and attachments in the request shape.
- **Content exfiltration and tracking through rendered output.** No remote images or
  HTML in guest rendering.
- **Privacy.** Guest prompts go to third-party free providers and network machines.
  The notice says so before the first message. The server stores no content, and
  network prefixes are stored only as keyed digests. The `/privacy` policy needs a
  guest-mode paragraph before enabling.
- **Illegal or harmful content attributed to Mycellios.** The server-owned system
  instructions, operator kill switch and per-prefix limits apply. Moderation is out
  of scope for phase 1; revisit with real traffic (open question).
- **Cookie confusion with real accounts.** Separate cookie name and path. Guest
  routes never read SSO cookies, and ordinary routes never accept the guest cookie.

## Phases

1. **Coordinator.** Config, owner SQL, admission challenge, session and chat routes,
   limits and free-route reuse. Disabled by default.
2. **Agent web.** `GuestChat` surface, entry routing, notices, limit and busy states,
   Dev proxy cookie forwarding.
3. **Conversion.** After verified registration in the same tab, an explicit "Keep
   this conversation" imports the bounded `sessionStorage` transcript into a new
   side conversation of the person's first Mico through an authenticated,
   idempotent RPC. Imported messages are marked as imported, carry no tool or
   approval state and never start a turn.
4. **Rollout.** Enable in production with a low global budget (for example 200
   messages a day), watch content-free counters (sessions, messages, limit hits,
   refusals, sign-ups started from guest chat), then raise the limits.

## Qualification

- Unit and HTTP tests:
  - cookie scope, name and flags, exact Origin and no CORS;
  - body and history bounds, and rejection of tools, images, attachments and model
    fields;
  - proof-of-work signing, expiry and replay;
  - every limit and its error code;
  - kill switch and missing-table behavior;
  - no priced fallback and no free-route retry for guests;
  - content-free logs.
- Isolated PostgreSQL: concurrent session creation from one prefix, concurrent turns
  at the global cap, UTC day rollover, idempotent nonce reuse and the counters
  staying consistent under rollback.
- Managed provider tests with fictional zero-priced sellers: guest refusal, seller
  rest, no reserve promotion and registered accounts unaffected.
- Agent web tests: entry routing (bare route versus deep links, signed-in, native,
  standalone), no `Shell` or RPC mount, markdown hardening, `sessionStorage`
  failure, limit and busy states.
- A real browser fixture at desktop and mobile sizes against a loopback coordinator
  with fictional free sellers: first message, limit reached, reload in the same tab,
  sign-in handoff. No production accounts, credentials or paid suppliers in fixtures.
- Before enabling in production: the `/privacy` update is published, the operator
  confirms the limits and a short real canary passes with the low budget.

## Open questions for the owner

1. Proof of work only, or Cloudflare Turnstile as well? Turnstile adds a third-party
   processor and a CSP change.
2. Are the default limits right, especially 12 messages per guest and 2,000 guest
   messages per day globally?
3. Should guests choose between Mycellios network models and AntSeed free models, or
   always get the stable recommended free model?
4. Is the conversation import on registration (phase 3) wanted in the first release?
5. Is a moderation step required before public launch, or after observing traffic?
