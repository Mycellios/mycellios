# Long-form transcription

Status: proposed, phase 1 in progress. Builds on
`specs/network-transcription/spec.md`, `specs/openai-transcription-bridge/spec.md`
and the unified speech replica (`specs/speech-replica/spec.md`).

## Goal

A caller can send a recording of up to several hours and get, quickly, a
transcript with segment timestamps, and later word-level timestamps and speaker
labels. The coordinator splits the recording and spreads the pieces across many
contributor replicas at once instead of running it on one machine.

This is a new product surface. It does not replace or delay the immediate gate:
a reproducible native route across two physical computers. A recording split
over several replicas is parallel independent work, never evidence of one model
executed across two hosts.

## Current state

- The network replica is `mycellios-whisper-small`. It accepts canonical mono
  16 kHz PCM WAV of at most 30 s per request.
- `deploy/transcription-openai-bridge/bridge.py` already cuts long audio into
  fixed 24 s segments outside the coordinator, optionally in parallel and
  dispersed. Fixed cuts can split words at a boundary.

## Job contract

A long-form job is a coordinator-owned parent over the existing per-piece
transcription request, so every piece keeps the current admission, holds,
receipts, settlement and no-replay rules.

1. **Admission.** The caller uploads canonical mono 16 kHz PCM WAV (the browser
   or bridge converts first) with language `es`, `en` or `auto`. Maximum
   duration and body size are explicit coordinator limits. The audio is bound by
   SHA-256; raw audio never enters durable conversations.
2. **Segmentation.** The coordinator finds silences and packs speech into pieces
   of at most the per-request limit, cutting only at the quietest point near each
   boundary. Phase 1 uses a deterministic energy detector in TypeScript (no new
   dependency); the speech replica's `vad` task (Silero) replaces it later.
   Silence-only input fails before any hold.
3. **Fan-out.** Pieces are dispatched in parallel as normal transcription
   requests, each bound to its own audio hash and the caller's account and key.
   A dispersion group per job keeps two pieces of one recording off the same
   worker, owner or public prefix when the caller asks for it. Parallelism is
   bounded by a job limit and the account's concurrency.
4. **Merge.** Piece texts and segment boundaries are shifted to the recording
   timeline and joined in order.
5. **Result.** JSON with `text`, `segments[]` (start, end, text) and usage;
   SRT/VTT from the same data. Later phases add `words[]` and `speaker`.

Failure rules: a piece is retried only after an explicit pre-dispatch refusal
(account concurrency or no capacity). An uncertain paid piece is never replayed;
the job fails and reports which pieces completed. Unexecuted pieces take no hold.

## Phase 1 implementation

`src/coordinator/long-form-transcription.ts` serves
`POST /v1/audio/transcriptions/long` with an `audio/wav` body and the
`x-mycellios-funding: contribution-credits` header. Query: `language`
(`es|en|auto`), `format` (`json|text|srt|vtt`), `stream` (NDJSON events
`accepted`, `segment`, `heartbeat`, then `done` or `error`), `parallel` (1-8,
default 2) and `dispersion` (`true` adds a random per-job group).

- Each piece is injected into `/v1/chat/completions` with the caller's own
  authorization, forwarding headers and client address, so authentication,
  local-trust checks, rate limits and billing are those of a direct request.
- Retries: `429 concurrency_limit_exceeded|rate_limit_exceeded` until the job
  deadline (30 min); `503 no_capacity` for at most
  `MYCELLIOS_LONG_TRANSCRIPTION_CAPACITY_WAIT_SECONDS` (default 60) per piece.
  Every other failure stops new dispatches and returns its status with the
  completed segments; nothing is replayed.
- Limits: `MYCELLIOS_LONG_TRANSCRIPTION_MAX_SECONDS` (default 1800, at most
  10800) sets the body limit; at most four uploads are buffered at once, and
  requests without any credential are refused before the body is read.
- Segment timestamps are piece boundaries; `whisper-small` returns no finer
  timing. A noise-only piece that the replica rejects as silence fails the job;
  the speech replica's Silero `vad` task replaces the energy detector.
- Pending: switch the Speakr bridge to this endpoint, an Agent surface, and the
  live funded qualification below.

## Billing

Each piece is billed exactly as today: the cl100k_base count of recognized text,
zero generated tokens, never audio bytes. The job adds no charge of its own.
Alignment and speaker labels, when added, are priced explicitly per audio second
if they carry a price.

## Phases

1. **Parent job and silence segmentation with the current model.** Coordinator
   endpoint, energy-based cuts, parallel fan-out over existing requests, merge
   and SRT/VTT. No new dependencies or models.
2. **Better models through the speech replica.** `large-v3-turbo` and `large-v3`
   as speech-replica catalog entries, each qualified per digest and hardware.
3. **Word timestamps** through the replica's `align` task.
4. **Distributed speaker labels.** Per-piece segmentation and speaker
   embeddings from the replica's `diarize` task; the coordinator clusters the
   embeddings into global labels (numeric work only, no model on the coordinator).

## Qualification

- Phase 1 unit tests: WAV parsing, silence detection and packing (piece bound,
  cut at quietest point, silence-only rejection), timestamp shifting and merge,
  SRT/VTT, bounded parallelism, retry only on pre-dispatch refusals, failure
  reporting without replay.
- Phase 1 live: one funded Spanish and one English recording of at least
  10 minutes through the coordinator, with per-piece debits, settled holds and
  zero ledger sum inspected.
- Later phases follow the speech replica's per-model native qualification.
  Physical tests that cannot run are reported as skipped, never as passing.

## Out of scope

Live streaming transcription, translation, and treating parallel pieces as
multi-host execution of one model.
