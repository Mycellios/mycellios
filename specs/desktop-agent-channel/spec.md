# Desktop agent channel

Status: phases 1 and 2 merged; phase 3 in progress.

## Problem

A Mico turn that runs on the owner's PC keeps its agent loop on Desktop, while the worker
keeps leases, checkpoints, tools, model credentials and billing. Every worker → PC message
is a separate relay operation:

1. worker → API `POST /api/desktop-relay/internal` (HMAC, nonce, `ownsBot` query);
2. API → Desktop: the held long poll answers after re-authorizing (session, membership and
   `ownedBots` queries);
3. Desktop → loopback host `POST /computer`;
4. Desktop → API `POST /api/desktop-relay/result` with `done` (authenticated again);
5. API → worker: end of the internal response;
6. Desktop re-arms its long poll (`register`, binding recheck and authentication again).

That is three internet legs, two internal legs and four to six database queries per message.
PC → worker calls travel on the open `agentRun` result stream and are cheaper.

### Measured (installed Desktop on Windows, 2026-11-26 20:55 – 2026-11-27 08:07 UTC)

| Operation | Count | p50 | p90 |
|---|---|---|---|
| `agentMessage` | 613 | 256 ms | 505 ms |
| `execute` (computer lane) | 72 | 2.7 s | 14.2 s |
| `environment` | 49 | 2.5 s | 3.6 s |

Per run: 16 relay operations at p50 and 32 at p90. The earlier batching (desktop-model-batch,
result-line batching) already cut this from 45–90 per turn. Separately, 639 poll `502`
responses and 577 poll errors clustered in the deploy windows: deploy handoff is the other
half of the problem and is tracked with the Nucleus relay handoff (`/internal/desktop-relay/handoff`).

### Where the remaining round trips come from

- **Model streams are pulled.** After `open`, the PC asks for each batch with a call and waits
  for its `agentMessage` reply, so a stream costs `2 + reads` operations and cannot overlap
  them. The stream then always sent `cancel()`, one more operation, even after its end.
- **Notifications are answered.** `onCheckpoint` and `onToolCompleted` are fire-and-forget on
  the PC, but the worker still replied with a full `agentMessage` operation each.
- **Global control cap.** One API instance admits 8 open control operations in total, shared
  by every Desktop turn.

## Invariants that every phase keeps

- No replay of uncertain work: a claimed `agentRun` that loses its transport stays
  `DESKTOP_RUN_INTERRUPTED_ERROR`; recovery uses the existing checkpoint segment rules.
- Segment fencing (`desktopAgentSegmentId`, broker `runs`, Desktop receipts) is unchanged.
- A failed checkpoint save still fails the run.
- Credentials, provider endpoints and billing stay on the worker; the PC never reports usage.
- Mixed versions keep working: every change is negotiated, and an old peer gets the old
  behaviour.
- Deploy handoff: open runs keep their callbacks; new work gets `desktop_updating`.

## Phases

### Phase 1: fewer operations on the current protocol (this change)

- The PC no longer cancels a model stream that reached `done`; the worker already releases it
  on `done`. Saves one operation per model call.
- `DesktopAgentRpc.notify(fn)` marks worker callbacks as notifications (`mode: "notify"` on the
  function handle). A PC that understands it sends `{ kind: "call", notify: true }` and gets no
  reply; an older PC still gets one. A one-way call to an ordinary function is refused.
  `onCheckpoint` (failure still fails the run through `accept`) and `onToolCompleted` (best
  effort, as before) use it. Saves two operations per tool call.

### Phase 2: pushed model streams

The worker pushes batches to a PC-side sink as numbered one-way calls instead of answering
reads, so batches overlap within the binding's control lane. The PC consumes them in order and
acknowledges progress inside its existing result stream; it falls back to reads with an older
worker. Target: one operation per batch instead of a call plus a reply, with no wait between
batches.

As built: the PC passes `push`, a function marked `oneWay`, in `open`'s accept argument. A
worker that supports it answers `pushed: true` and sends each later batch as a one-way call
`push(seq, batch)`, numbered from 1. It awaits each send, which returns once the PC took the
message, so one batch is in flight while the next one gathers. The PC keeps at most 64 numbers
ahead, refuses repeated or already read numbers, and hands batches out in order. A stream that
breaks on the worker is released and ends with `push(n, { failed: true })`. An older PC passes no
`push` and an older worker answers no `pushed`; both keep reads.

### Phase 3: one downstream per agent session

Negotiated as `agentChannel: 1` in `account` registration. For an admitted `agentRun`, the API
holds one streamed response to Desktop (the same long-lived NDJSON style as `agentRun`
results, so the current ingress and Electron session keep working) carrying every
worker → PC message for that session, with per-session sequence numbers. Desktop
acknowledges sequences on its result stream; the broker keeps unacknowledged frames for
redelivery on reconnect, by sequence, never re-executing a call. Authentication happens when
the stream opens and is rechecked periodically, as `threads.subscribe` does, instead of twice
per message. The per-message long-poll re-arm disappears for agent traffic. Control operations
stop counting against the global cap of 8.

As built:
- **Negotiation.** The API answers `account` and `poll` with `agentChannel: 1`. A Desktop with
  agent execution then keeps `POST /api/desktop-relay/channel` open. Older Desktops never open
  it, and a Desktop polling an older API never sees the offer.
- **Delivery.** The broker writes each `agentMessage` for that PC session to the channel as one
  NDJSON line, in the same shape as a poll operation, the moment it is dispatched. It never
  hands that message to a poll, wakes the held poll for it, or lists it in a poll's `active`.
- **Acknowledgement.** The result POST acknowledges and closes the operation, unchanged
  (sequence and digest deduplication included), and does not re-arm the poll.
- **Caps.** Channel messages do not count against the global cap of 8 open control operations.
  The per-Mico cap of 4 and the shared byte bound still apply.
- **Redelivery.** A new channel replaces the previous one and first rewrites every channel
  operation that is still open. The PC skips any it is running or has settled
  (`startOperation`), so nothing runs twice. An operation nobody acknowledges ends at its
  deadline, as before.
- **Liveness.** The channel opens with a keepalive line and sends another every 15 s. It closes
  itself after 4 minutes, and the PC opens the next one. The PC drops a channel that has been
  silent for 45 s.
- **Authorization.** Opening the channel authenticates the session and rechecks its bound
  Micos. Every 60 s the API checks the session again (a changed session revokes the PC) and
  rechecks the Micos. Revoke, release and relay restart close the channel.

The acknowledgement still uses one authenticated result POST per message; moving it onto the
`agentRun` result stream remains for a later change.

### Phase 4: worker ↔ API stream

The worker keeps one signed stream to the owning API instance per agent session instead of
one internal POST per message.

## Qualification

- Unit: `desktop-agent-rpc`, `desktop-model-stream`, `desktop-model-batch`,
  `desktop-agent-runtime`, broker and client relay tests, including mixed-version cases.
- End to end: `apps/api/src/desktop-agent.test.ts` and the update-resume integration test.
- Installed Desktop: compare `operation_confirmed` counts and `agentMessage` latency per run
  from `desktop.ndjson` before and after each phase, on the same PC.
