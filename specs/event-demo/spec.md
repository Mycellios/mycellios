# Bounded, registration-free event demo

## Authorized event

One explicit operator campaign, open for at most 48 hours. The first 50 browser
guest identities receive 200,000 promotional microunits each (10 Credits total).
This is an event grant, separate from verified-account welcome and referral grants.
No email, password, payment, registration, API key or second provider setup is asked.
Each guest sees their own wallet and a fixed Mycellios model. Personal accounts,
their sessions and their model choices are untouched.

## Boundaries

- Campaign configuration and secrets remain on the coordinator, disabled by default.
- A cryptographically random browser enrollment nonce makes concurrent/lost-response
  admission idempotent. Its hash is stored; the server issues a scoped HttpOnly,
  SameSite cookie. A separate view capability exposes only aggregate event telemetry.
- Slot allocation and the expiring 0.20 grant share the serialized wallet writer
  transaction. No other route accepts this guest capability; no API key is issued.
- Chat accepts bounded text-only history and the fixed approved managed model;
  server-owned instructions, output limits, price quotes, holds, real-cost +4%
  settlement and uncertain-result recovery reuse the normal managed gateway.
- No automatic paid retries, media, tools, checkout, privileged Agent RPC or
  account/provider management. Stop new work at campaign expiry or disabled flag.
- Joining alone does not spend credits. Reloading does not allocate another slot.
- Browser Play reuses the existing signed mobile runtime, explicit activation,
  pause/visibility cancellation and verified worker binding. Connected, loading,
  working and settled are distinct. Matrix benchmarks never mint Credits.
- The browser's pinned small pretrained model is separate from managed DeepSeek
  chat. Show no claim that DeepSeek runs on phones or that connection equals work.
- Presenter view reveals pseudonymous slot, broad device type, live connection and
  verified work/settled earnings only; never names, prompts, IPs, tokens or proofs.

## Qualification

Isolated PostgreSQL: simultaneous >50 joins, replay/reload, rollback, expiry,
cookie isolation, grant conservation and real gateway hold/settlement/recovery
with fictional supplier responses. HTTP tests for scoped cookies, Origin checks,
capability separation, bounded body/model/history and no paid GET/automatic join.
Real browser fixture at desktop/mobile sizes: QR entrance, chat, error/recovery,
Play/Pause, no cross-guest transcript and live presenter updates. Real pinned
browser model on loopback with fictional balances; no supplier charges in tests.
Publishing keeps the existing coordinated release, immutable source, private
migration owner, rollback, runtime overlays, active-work drain and public health.
