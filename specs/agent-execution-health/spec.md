# Execution health without duration-based cancellation

## Problem

A missing computer throws before attempt settlement and before the lease
heartbeat starts. The expired lease is reclaimed repeatedly while the UI says
Working. This is not model progress and must not be billed or reported as such.

## Behavior

- Missing-computer preflight failures settle through the existing fenced,
  transactional task/event finalization. The setup attempt is real worker work;
  it does not stamp model execution start or create model usage.
- The transcript distinguishes waiting to start, queued, missing configuration,
  current worker contact, silent long-running work and uncertain/lost contact.
- Existing lease renewal remains authoritative. Elapsed time and absence of
  output alone never terminate, restart or replay model/tool execution.
- Additive snapshot metadata exposes only update/lease/schedule/observation
  timestamps, without worker identities, credentials or raw errors.
- Older APIs that omit heartbeat metadata are explicitly uncertain. Background
  tabs do not poll and active reads do not overlap.

## Validation gates

Cover no-computer settlement, lost-fence races, a ten-hour render with current
contact and no output, expired contact, unsupported metadata, unrelated chat
messages, polling and disposal. Run focused adapter/API/web tests and incremental
typechecks locally before any release. Browser-check blocked and long-running
states. Production deployment is separate from source implementation and the
loopback UI preview; preserve other services and do not create fake usage.

## Worker release boundary (2026-10-30)

The worker-only additive release is recorded in
`src/agent/outputs/agent-recovery-20261030/deployment.json`. Its patch SHA-256 is
`70a2799d9de27b9c9b1bc1ebbcdf752ce2c39bea4954beee93f3748afa8aa03e`.
The verified bundle uses a versioned read-only mount over `/app/apps/worker/dist`;
future full releases must incorporate or preserve it and the existing API logs
hotfix. The public web and protected inference services were not replaced.

This release excludes unavailable computer tools and adds direct-answer and
factual progress guidance. It does not enable the computer provider, which
remains `none`, or ship every local execution-health and UI change described
above. A real image request completed with `openai-codex/gpt-6.1-sol`, no error
and zero tool calls. Dani's separate native-model conversation still exceeded
its context budget; its model and history were preserved.


## Context and web update release (2026-10-30)

The successor release receipt is `src/agent/outputs/agent-release-20261030/deployment.json`.
It preserves the earlier executor patch and API logs hotfix. Immutable worker/web
bundle overlay: `e57372a06cc25a67fe9e707761e8d45e7098273ffb8c7768eedb114cf7a21097`;
web build `20261030121630`; canonical main checked before promotion:
`1a45f32d6deb5149fb8f7490c918b8285a622d4b`. The source import remains local;
this receipt is not a claim of a GitHub commit, merge or complete main release.
Future full releases must incorporate or preserve these overlays.

295 focused release tests passed after local affected tests and incremental
TypeScript validation. Original-chat acceptance remains **failed**: the owned
native Qwen3-1.7B connection returned an empty summary, including the single
smaller-chunk recovery. All 21 original message IDs, sequences and content hashes
remain unchanged; the three new read-only validation runs made zero tool calls.
The text admission replica was reconnected after missing evidence; the model
service, Kokoro, embeddings and their reservations were not restarted or changed.
The live failure is recorded in `long-chat-proof.json`; do not describe this as a
successful real-model compaction or silently change the user's model to pass it.
