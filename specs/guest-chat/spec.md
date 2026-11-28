# Registration-free guest chat on the web

Status: phases 1 (coordinator) and 2 (Agent web) implemented and disabled by
default. Phase 3 (conversation import) and phase 4 (production rollout) are not
started. Nothing here is enabled until an operator turns it on (see "Enabling").

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
  is in guest mode and cannot use tools) and the output token ceiling. The
  instructions list what a Mico with an account really does (routines, waits, web,
  its computer, apps published in Mycellios, teams, notifications, memory), forbid
  recommending outside hosting, databases, schedulers or automation services, and
  keep code to one compact self-contained HTML file. The final `result` event carries
  `truncated: true` when the model stopped at the output limit (`finish_reason`
  `length`); the shell then shows a notice with Continue under that answer. Under the
  latest answer the shell always draws its own account offer ("Get it running ·
  Create free account"), so it never depends on the model writing one.
- Execution reuses the managed free path in `managed-provider.ts` with a synthetic
  account namespace `guest:<session id>`. Implementation must confirm the
  zero-priced path needs no wallet row, and must add none. Purchases are recorded as
  today with `maximum_usd='0'`, so the existing safety stop and receipts apply.
- Guest traffic never takes a priced offer and never falls back to another
  provider. On an explicit 429 allowance refusal the seller rests as usual and, like
  an account, the guest request retries on another exact-zero route
  (`FREE_REFUSAL_RETRIES`), moving down to the next strongest free model.
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
  solves it with batched WebCrypto digests, yielding between batches, in about a
  second on a mid-range phone. This needs no third-party script and no new privacy
  processor.
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
| Output tokens per answer | 2,048 (room for a small complete app) |
| New sessions per network prefix (/24 IPv4, /64 IPv6) per hour | 5 |
| Guest messages per network prefix per UTC day | 40 |
| Global guest messages per UTC day | 2,000 |
| Concurrent guest turns, global | 16 |
| Concurrent turns per session | 1 |
| Proof-of-work difficulty (leading zero bits) | 16 |

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
2. **Agent web.** The ordinary shell in guest mode over the browser guest data layer,
   locked account features, entry routing, notices, limit and busy states, Dev proxy
   cookie forwarding.
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
- Managed provider tests with fictional zero-priced sellers: strongest-first routing,
  moving down when a route leaves, seller rest and reserve promotion.
- Agent web tests: entry routing (bare route versus deep links, signed-in, native,
  standalone), the guest data layer never calling the Agent API, locked controls and
  shortcuts, resume and retry, markdown hardening, `sessionStorage` failure, limit and
  busy states.
- A real browser fixture at desktop and mobile sizes against a loopback coordinator
  with fictional free sellers: first message, limit reached, reload in the same tab,
  sign-in handoff. No production accounts, credentials or paid suppliers in fixtures.
- Before enabling in production: the `/privacy` update is published, the operator
  confirms the limits and a short real canary passes with the low budget.

## Decisions for the first release

The owner asked for the recommended defaults. They can change later without a
schema change.

1. Proof of work only (SHA-256 leading zero bits, default 16, signed challenge valid
   5 minutes, one session per challenge). No Turnstile, no new processor or CSP change.
   The browser solves it with WebCrypto in small batches on the page: about 0.5 s at
   130,000 digests per second on a desktop, a few seconds on a slow phone.
2. The default limits in "Limits" above.
3. Guests always get the stable recommended free model (`mycellios/managed/free`); no
   model picker.
4. No conversation import in the first release (phase 3 stays open).
5. No moderation step in phase 1; the kill switch, server persona and limits apply.
   Revisit with real traffic in phase 4.

## Implementation

- Coordinator: `src/core/guest-chat-config.ts` (`MYCELLIOS_GUEST_CHAT_ENABLED`,
  `MYCELLIOS_GUEST_CHAT_CONFIG_JSON`), `src/economy/guest-chat-schema.ts`
  (`guestChatSchemaSql`, `guestChatAccessSql`), `src/coordinator/guest-chat.ts` and
  `guest-chat-routes.ts`. `GET /mobile/v1/guest/config` always answers and reports
  `{ enabled: false }` when guest chat is off, its owner tables are missing or
  unprotected, or no managed free route exists. Session counters use
  `guest_chat_usage` rows keyed by bucket and scope (`global`, `prefix:<digest>`,
  `sessions:<digest>` per hour) with conditional upserts, in the same transaction as
  the session counter. A turn that did no work (not submitted, or refused by the free
  seller) gives its message back; an uncertain result keeps its count and is never
  replayed. `freeRefusalRetries(options)` lets a caller only lower the AntSeed free
  retry budget; guest turns pass 0.
- Agent web: `lib/guest-chat.ts`, `pages/guest/GuestEntry.tsx` and `GuestChat.tsx`.
  The signed-out `/` and `/app` routes show guest chat only for an ordinary tab with no
  query string; otherwise the existing welcome page or sign-in redirect. Hosted Agent
  redirects `/agent` and `/agent/` to `/agent/app` at the front proxy, so `/app` is the
  entry visitors actually reach in production. The Dev proxy forwards only the guest
  cookie on guest paths (`event-demo-proxy.ts`). The existing one-time language
  question still comes first on a first visit.
- Landing copy is unchanged ("Open in browser"); "Try it free, no sign-up" can follow
  once guest chat is enabled in production.

## Qualification run

- `tests/guest-chat.test.ts` (config, prefixes, proof of work, request shape, disabled
  routes) and the guest case in `tests/managed-free-offers.test.ts`.
- `tests/guest-chat.postgres.test.ts` on an isolated cluster
  (`node scripts/test-referrals-postgres.mjs tests/guest-chat.postgres.test.ts`): cookie
  flags and scope, exact Origin, no CORS, request bounds, nonce resume, challenge replay
  and expiry, concurrent session creation per prefix, every limit with rollback, UTC
  day rollover, session expiry, concurrency, refusal refund, no priced quote,
  content-free storage and logs, and missing or unprotected tables.
- Agent web: `lib/guest-chat.test.ts`, `pages/guest/GuestChat.test.tsx` and
  `event-demo-proxy.test.ts`.
- Real browser: `npx tsx scripts/verify-guest-chat-ui.ts [--output=<folder>]` runs the
  Agent web Dev server against a loopback coordinator with the real guest routes,
  isolated PostgreSQL and a fictional zero-priced seller, at desktop (English) and
  mobile (Spanish) sizes: three turns, scoped cookie, reload in the same tab, limit
  reached with the account offer, deep link and installed web app keep sign-in.

## Client address and retention

- In production the coordinator sits behind Cloudflare, `mycellios-cloudflared` and the
  `mycellios-ingress` nginx, so its direct peer is the ingress for every visitor. The
  optional `clientAddress` setting (`{ "header": "cf-connecting-ip", "trustedProxies":
  ["<private proxy network CIDR>"] }`) reads the edge's address header only when the
  direct peer is inside a trusted proxy network; otherwise the default derivation applies.
  Without it, every visitor would share one network prefix and its limits.
- Ended sessions and old counters are deleted 7 days after they end (`GUEST_RETENTION_MS`,
  hourly, at session creation); the runtime role therefore also has DELETE on both tables.
  `/privacy` states this in "Guest chat without an account".

## Enabling

1. The migration owner applies `guestChatSchemaSql` and `guestChatAccessSql(<runtime
   role>)` to the coordinator database.
2. Publish the guest-mode paragraph in `/privacy` (done in the release that adds
   `clientAddress`).
3. Once a release with `clientAddress` support is live, set
   `MYCELLIOS_GUEST_CHAT_CONFIG_JSON` with `publicOrigin` (the exact first-party origin,
   for example `https://www.mycellios.com`), a fresh 43+ character `secret`, a low
   `messagesPerDay` for the canary (for example 200) and `clientAddress`, then
   `MYCELLIOS_GUEST_CHAT_ENABLED=true`. Unset it to switch guest chat off. The config is
   strict: an older release refuses unknown keys at startup.
4. Confirm `GET /mobile/v1/guest/config` reports `enabled: true` and run a short canary.
