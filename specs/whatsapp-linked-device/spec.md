# WhatsApp linked device (Desktop connector)

Status: server, web and Desktop connector merged (#391); not shipped. Desktop release
builds omit the WhatsApp runtime since the move to PolyForm Shield (see below).

## Goal

Let an owner link their own WhatsApp number to Mycellios Desktop as a linked
device (like WhatsApp Web), and talk to a chosen Mico from WhatsApp:

- **Personal number**: only the owner's "Message yourself" chat and the contacts
  and groups the owner allows reach the Mico. Mycellios never writes first to
  anyone else.
- **Dedicated number**: a second WhatsApp account used only by the Mico. A person
  who is not allowed gets one message with a 6-character code, and the request
  shows in Mycellios. The owner approves or denies it.
- Link with a QR code (WhatsApp → Linked devices → Link a device) or a pairing
  code typed on the phone.
- A direct chat is one conversation. In an allowed group, a mention of the number
  or a reply to one of the Mico's messages starts a request; other group messages
  are ignored.
- 👀 on the triggering message when it is accepted; ✅ when the answer was sent,
  ❌ when the run failed.

This mirrors the behaviour the reference app published for its WhatsApp connector. No
reference app code is used: the reference app is PolyForm Noncommercial; this implementation is
written independently.

## Risk and licensing

- WhatsApp does not permit unofficial clients and may restrict or block a number
  it sees as automated. The link UI says so and recommends a dedicated number.
- The client is upstream **Baileys** (MIT), whose Signal dependencies are
  `libsignal` (GPL-3.0) and `whatsapp-rust-bridge` (contains AGPL-3.0 code).
- On 2026-11-21 Mycellios moved to the PolyForm Shield License 1.0.0, which is
  incompatible with distributing those dependencies. Release builds therefore do
  not bundle `dist/whatsapp-runtime.js`; Desktop reports WhatsApp as unavailable,
  and `scripts/verify-release.cjs` refuses to package the runtime. Only a local,
  non-distributed build may include it (`MYCELLIOS_DESKTOP_WHATSAPP_RUNTIME=local-gpl`).
- Shipping requires a Signal implementation under a compatible license (for
  example an independent clean-room implementation with legal review).
- The WhatsApp Business Cloud API provider (`provider: "whatsapp"`) is unchanged
  and remains the official server-side route.

## Architecture

```
Phone WhatsApp ⇄ WhatsApp servers ⇄ Desktop main (Baileys socket, encrypted keys)
                                         │  POST /api/desktop-whatsapp/<action>
                                         ▼  (session cookie + native marker)
                                   API: whatsapp links, senders, outbox
                                         │ sendUserMessage / run.continue
                                         ▼
                                   Mico thread → run → mirror → outbox → Desktop pull
```

- **Desktop** (`apps/desktop/src/whatsapp/`) owns the socket and the encrypted
  auth state (keys wrapped with the existing local data key). It filters locally:
  in personal mode, nothing outside the self chat and allowed chats is uploaded.
  It long-polls the outbox, performs each claimed operation once and reports a
  result. Uncertain operations are reported as failed, never replayed.
- **Protocol**: `src/contracts/desktop-whatsapp.ts` (strict hand-written parsers,
  same style as `desktop-executor.ts`). Actions: `register`, `sync`, `inbound`,
  `pull`, `result`, `unlink`.
- **API** (`apps/api/src/desktop-whatsapp.ts`): same authentication rules as
  `/api/desktop-relay/*` (no `Origin`, `x-mycellios-desktop: 1`, fresh session,
  bot ownership). Link rows are bound to the Desktop device id that registered
  them; every action re-checks that binding.
- **Conversations**: self-chat messages are owner messages in the Mico's thread
  (`trigger: "messaging"`, clientNonce `whatsapp-device:<linkId>:<waId>`).
  Contact and group messages are third-party messages: they use the existing
  `channel_message` block so the executor applies the messaging-channel privacy
  mode (no personal memory or owner-only tools). Replies are mirrored into the
  WhatsApp outbox instead of the generic messaging outbox.
- **RPC** `whatsapp.links.*` / `whatsapp.senders.*` (`packages/contracts/src/whatsapp-link.ts`)
  back the settings page. Linking itself happens only inside Desktop (IPC
  `window.rakazoDesktop.whatsapp`), because the session must stay on the PC.

## Not in this first version

- "Working on it…" placeholder edits, 1.5 s message batching, numbered approval
  replies ("1"/"2") and `stop`.
- Outbound files; inbound attachments are limited to 8 MB.
- 90-day local history search and per-connection workspace memories.

## Verification

- Contract parser tests, API route tests (auth, ownership, device binding,
  allowlist enforcement, idempotency, claim/result), Desktop connector tests with
  a fake socket, web component tests.
- A live link with real phones is required before release; it is not covered by
  CI and must be reported as not run until done.
