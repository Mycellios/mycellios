# Realtime calls with a Mico

Status: OpenAI transport implemented behind an operator flag and a device switch; not yet
qualified with a real provider session, microphone or measured latency. Gemini Live is not
implemented.

## Outcome

A call with a Mico feels like a phone call: replies start without waiting for a full
transcription and synthesis turn, the person can interrupt naturally, and the Mico still
does its real work with its own model, tools, memory and approvals. The turn-based call
(endpoint silence, transcription, a full Mico turn, then speech synthesis) remains the
default and the fallback.

Behavior reference: the public MIT project `javiersgjavi/ade-call` (a voice line to
coding agents). Its design is a reference only; our code and prompts are our own.

## Shape

The realtime speech model is the *voice* of the call, not the Mico's brain.

- `POST /api/voice/realtime/call` (`apps/api/src/voice-realtime.ts`) takes the browser's
  WebRTC offer and the Mico id, checks that the Mico belongs to the caller in the current
  Space, loads the caller's own OpenAI voice connection and posts the offer with the
  session to OpenAI's `/v1/realtime/calls`. The key never reaches the browser; the app's
  CSP stays `connect-src 'self'`. The answer SDP goes back to the browser.
- Audio then flows between the browser and the provider over WebRTC; provider events
  arrive on the `oai-events` data channel (`apps/web/src/lib/realtime-call.ts`).
- The session gives the speech model four tools, run in the person's own client by
  `RealtimeCallTools` (`apps/web/src/lib/realtime-call-tools.ts`) through the same RPCs
  a tap uses, with the call's client nonce:
  - `ask_mico(request)`: `threads.send`/`followUp` to the Mico on the call. Waits up to
    40 s for the reply; otherwise returns "still working" and keeps watching, then the
    result arrives as a notice.
  - `read_conversation()`: the latest messages and any request waiting for the person.
  - `answer_request(decision)`: `allow` or `deny` only.
  - `end_call()`.
- The speech model never receives Mico tools, credentials, memory tools or computer
  access. The call keeps its existing card, transcript, mute, hang-up, the server-side
  call close (`threads.endCall`) and the notices about other work (`call-notices.ts`).

## Safety rules

1. A sending tool (`ask_mico`, `answer_request`) runs only if the person has new
   transcribed words since the words that authorized the previous send. If a committed
   utterance is still being transcribed, the tool waits up to 2.5 s for it.
2. Each provider `call_id` runs at most once. An uncertain send is reported as uncertain
   and never retried.
3. `answer_request` re-checks the person's own last words with `spokenApprovalAction`
   (`packages/core/src/speech-text.ts`): it must be a clear yes for `allow` or a clear no
   for `deny`. "Always allow" is never available by voice.
4. While an approval or a credential request waits, `ask_mico` sends nothing; credentials
   are entered on screen.
5. Thread contents and tool results reach the speech model as data.

## Payment, configuration and fallback

- Operator: `MYCELLIOS_REALTIME_CALLS=true`; optional `MYCELLIOS_REALTIME_MODEL`
  (default `gpt-realtime`), `MYCELLIOS_REALTIME_VOICE` (`marin`) and
  `MYCELLIOS_REALTIME_TRANSCRIPTION_MODEL` (`gpt-4o-mini-transcribe`).
- Person: Settings → Voice → "Realtime calls" (device preference `realtimeCalls`).
- Payer: only the person's own OpenAI voice connection; no Credit route or other payer.
- Any failure to start (flag off, no OpenAI key, provider refusal, microphone, network)
  continues the same call on the turn-based pipeline and says why.
- The Mycellios network route (Whisper + Kokoro) keeps the turn-based call; it is not a
  realtime transport and must not be presented as one.

## Not done yet

- Gemini Live transport.
- Calls the Mico starts (an incoming call with an opening) stay turn-based.
- Qualification: a real OpenAI session on Desktop and a physical phone, first-audio
  latency, barge-in, approval by voice, provider failure mid-call. Fixtures do not
  qualify any of these.

## Verification

`apps/api/src/voice-realtime.test.ts`, `apps/web/src/lib/realtime-call.test.ts`,
`apps/web/src/lib/realtime-call-tools.test.ts`, `apps/web/src/lib/call-session.test.ts`
and `packages/core/src/voice-scenarios.test.ts`.
