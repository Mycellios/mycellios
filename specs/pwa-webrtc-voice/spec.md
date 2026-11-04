# Shared PWA WebRTC voice MVP

## Scope

One browser/PWA implementation for continuous voice with the selected existing Mico.
Do not create another agent, model configuration or native application. The first
qualification is local only. Android and iPhone physical lock-screen acceptance is
deferred until physical devices are available; web qualification comes first.
No production backend, database, installed client or release is changed by this work.

## Implementation

- Opt-in API flag `MYCELLIOS_VOICE_RTC_MVP=1`; the capability and session routes mount
  only with a loopback PostgreSQL database URL. The normal project-local environment
  preserves this flag while continuing to remove remote databases and provider keys.
- Open an authenticated local Mico main chat with `?voice-mvp=1` to display the compact
  experimental panel. It probes the capability before rendering. The usual voice
  interface and production defaults remain unchanged.
- Browser captures its microphone once, creates one send/receive WebRTC audio
  transceiver and retains the remote audio element. Node receives encrypted RTP,
  detects the end of a turn, transcribes it, invokes the normal Mico conversation
  pipeline, and sends synthesized speech back on the same media connection.
- Transport uses mandatory G.711 PCMU at 8 kHz for this narrowband trial, with
  `werift@0.26.0` and local `ffmpeg` for bounded speech decoding. This is a speech to
  text → existing Mico → text to speech pipeline, not an end-to-end audio model.
- An incoming authenticated request is revalidated during the session. Owner,
  Space, Mico and optional task thread remain fixed. The accepted run ID determines
  which reply is spoken. Credentials stay in the existing server provider path.
- `threads/send` uses `queueOnlyWhenIdle` atomically. Voice never accepts an approval
  or secret card, steers another active run, or retries an uncertain send. Waiting
  cards and failures end the trial and direct the user to the normal chat.
- Hangup stops tracks, playback, peer and server-owned timers. Leaving the account,
  Space, Mico or task destroys that client. A 30-second connection deadline,
  15-minute session lifetime and bounded negotiation/turn/audio buffers limit leaks.
- The server sends ordinary silence between replies on the established call. It
  does not play an unrelated background track, suppress OS permissions or bypass
  platform suspension rules. Audio Session and Media Session are optional hints.

## Qualification and limits

Focused tests cover mu-law/WAV, server turn detection, real ffmpeg conversion,
origin/authentication refusal, real bidirectional RTP, session cleanup, idle-only
Mico admission, exact-run/task reply reads, revoked sessions, microphone cancellation
and preservation while the page is hidden. `scripts/verify-voice-rtc.mts` additionally
drives the real browser implementation against an isolated Node WebRTC fixture.

The transport fixture uses synthetic microphone audio and a scripted response. It
is explicitly **not a real account or live model/provider call**. The Mico adapter
is tested separately against the ordinary route contract. Existing production Micos
and speech providers have not been exercised end to end by this local trial. No
production credentials, account sessions or databases have been copied to the fixture.

There is no TURN server in this LAN/loopback MVP. It is not a cellular/WAN call service.
On a phone, a trusted HTTPS origin and microphone permission will be required.
Desktop mobile viewports, headless Chromium, hidden-page events and RTP counters do
not prove Android or iPhone lock-screen support. Exported diagnostics deliberately
retain `physicalLockResult: unverified` and omit spoken text.

Evidence is stored outside the checkout in `outputs/voice-webrtc-mvp-20261104`,
including the 138-path pre-change snapshot, preserved original diff, verification
results and transport diagnostics. The canonical qualification status is maintained
only in `docs/STATUS_AND_EVIDENCE.md`.

## Local commands

All checks go through the shared PC scheduler described in AGENTS.md:

- Incremental TypeScript checks for `apps/api/tsconfig.json` and `apps/web/tsconfig.json`.
- `npx vitest run apps/api/src/voice-rtc/rtc.test.ts apps/api/src/voice-rtc/mico.test.ts apps/web/src/lib/rtc-voice-mvp.test.ts --maxWorkers=1`.
- `node --test scripts/project-local-env.test.mjs`.
- `npx tsx scripts/verify-voice-rtc.mts ABSOLUTE_EVIDENCE_DIRECTORY`.

For an isolated interactive local API, set `MYCELLIOS_VOICE_RTC_MVP=1` before
`npm run dev:local:backend`; start the existing `npm run dev:local:web` separately.
After normal local authentication, select a configured local Mico and append
`?voice-mvp=1` to its chat URL. The current `main` UI exposes this trial in the Mico's
primary chat; the server also validates optional owned task targets. These commands do not import production accounts
or replace their credentials. A real-account qualification remains a separate step.
