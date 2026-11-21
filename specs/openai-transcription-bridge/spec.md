# OpenAI-compatible transcription bridge

Status: running beside Speakr (opened 2026-11-21).

## Goal

Speakr and other OpenAI-style clients can transcribe with the Mycellios
network (`mycellios-whisper-small`) by changing only their base URL, without a
coordinator release.

## Behavior

`deploy/transcription-openai-bridge/bridge.py`:

- **Accepts** `POST /v1/audio/transcriptions` as multipart with `file`,
  optional `language` and optional `response_format` (`json`, `text` or
  `verbose_json`).
- **Converts** the audio with ffmpeg to mono 16 kHz s16le PCM and cuts it into
  segments of 24 s or less. The coordinator keeps the default 1 MiB request
  body limit, and 24 s of PCM stays below it after base64 encoding and the
  JSON envelope.
- **Sends** each segment as a `mycellios-transcription-input/1` envelope to
  `/v1/chat/completions` with `x-mycellios-funding: contribution-credits`,
  `max_tokens: 1` and `deadline_ms: 60000`. Without a tiny `max_tokens`, the
  scheduler's SLO estimate (configured at 1 token/s) rejects every replica
  with `candidate_slo_exceeded`.
- **Joins** the segment texts and returns `{"text"}`.
- **Credentials.** The caller's bearer key is forwarded and never stored.
- **Retries.** Only explicit pre-dispatch refusals (429 account concurrency,
  503 no capacity) are retried with backoff, within a 15-minute deadline. Any
  other failure is returned, and paid work is never replayed.
- **Dispersion (opt-in).** With `DISPERSION_POLICY=fallback` or `fail`, each
  upload gets a random group sent with every segment, and the coordinator never
  gives two segments of one recording to the same node, owner or network
  (`specs/node-owner-privacy/spec.md`, D3). `503 dispersion_exhausted` is not
  retried: under `fallback` that segment goes to the fallback provider, under
  `fail` the upload fails (and, like any network failure, goes whole to the
  fallback provider when one is configured). `TRANSCRIPTION_PARALLEL` (1-8)
  sends that many segments at once; keep it within the account's concurrency.
  The defaults (`off`, 1) keep the serial, ungrouped behavior. With a single
  Whisper replica, `fallback` sends every segment after the first to the
  provider, so enable it only with Daniel's chosen policy.

## Deployment

On the Speakr host the bridge runs as the `speakr-mycellios-transcription`
container, using the Speakr image (Python and ffmpeg) with the script mounted
read-only. It is reachable only on the `speakr-internal` network at
`http://speakr-mycellios-transcription:8080/v1`.

To switch Speakr over:

- `TRANSCRIPTION_BASE_URL=http://speakr-mycellios-transcription:8080/v1`
- `TRANSCRIPTION_MODEL=mycellios-whisper-small`
- `TRANSCRIPTION_API_KEY`: the Mycellios key in
  `/srv/data/speakr/secrets/mycellios.key`.

Measured on 2026-11-21: 40.5 s of Spanish MP3 was transcribed in 26.4 s,
across two segments.

## Operational notes

- **Native qualification.** Each time the GPU replica reloads, for example
  after the placement broker releases it, it loses its native qualification.
  Economic settlement then rejects completed jobs and clients get 502. Refresh
  the qualification through `POST /internal/v1/native-replica-qualifications`
  (at most 3 attempts per day). Follow-up: run the native qualification watch
  with Whisper and Kokoro in its allowlist.
- **Concurrency.** The account allows 2 simultaneous requests, shared with
  the owner's other keys. A dedicated Speakr account would avoid 429 waits.

## Verification

`python3 -I -B -m unittest discover -s deploy/transcription-openai-bridge -p 'test_*.py'`
covers the WAV contract, segmentation, the envelope hash, multipart parsing,
the retry policy and the request shape.
