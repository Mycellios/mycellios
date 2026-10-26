# Worker heartbeat reliability

Health and hardware observations must not block the authenticated control channel.
Each heartbeat waits at most one second for each independent observation, sampled
concurrently. Keep one underlying observation per source until it settles, even
after a timeout, so an unavailable dependency cannot accumulate probes.

Missing or rejected adapter metrics close admission: advertise draining, zero
available slots and no loaded models while preserving active leases. Recover only
from a fresh successful sample; never reuse a late result as current readiness.
Hardware observations remain optional and cannot delay adapter observations.

Regression checks cover hung and rejected probes, overlapping heartbeats,
continued heartbeat publication, closed admission, and subsequent recovery.
Run `npx vitest run tests/heartbeat-observation.test.ts tests/worker-hardening.test.ts
tests/worker-protocol.test.ts --maxWorkers=1`, typecheck, structure and architecture.

This change neither certifies physical contribution nor authorizes settlement.
The text canary measures generated tokens. Native embedding/audio qualification
uses `/internal/v1/native-replica-qualifications` with both operator credentials,
three normal leased requests, actual execution receipts and validated payloads.
Evidence binds the authenticated worker session, build, model, activation and
physical GPU node. Preserve zero output-text tokens; never fabricate tokens, reuse
activation receipts as deployment canaries, or waive identity checks. Worker
claims cannot mint or preserve this evidence across session/build changes.

`/internal/v1/workers/:workerId/maintenance` requires the same credentials. It
blocks new lease offers at the actual send boundary while preserving existing
leases and worker heartbeats. Releasing maintenance restores the latest owner
pause state. The maintenance flag is scoped to the current coordinator process.

The optional backend qualification watcher reads an operator-owned allowlist of
exact worker/deployment/model/build/activation/node tuples. It refreshes evidence
after a session change or after six days, only when an approved replica is idle.
Keep at most three attempts per worker per day and 15 minutes between
attempts, including uncertain or successful requests. It never retries uncertain
inference within a cycle, approves source drift, adds funds or changes pricing.
Reserve attempts in an atomic private journal before sending; invalid journals
fail closed, and restarts cannot reset the daily limit.

Production currently contains separately built embedding and database components.
A main-branch worker build alone is not a replacement for that runtime. Release
requires preserving those components and validating the actual worker artifacts.

## Prepared embedding admission follow-up

`src/coordinator/embedding-admission.ts` reuses a supplied, pinned embedding
contract before accounting or job creation and returns a bounded 400 error.
The current public source tree does not contain the separately deployed embedding
contract, so this helper is deliberately not wired into the main HTTP route yet.
The production-image overlay candidate passed 18 isolated HTTP cases locally,
including rejection without jobs or usage, valid envelopes, and unaffected
Kokoro/other-model admission. This is candidate evidence, not deployment or a
speedup measurement. Keep the original JSON contract and model revision;
Jarvis's 900/1800 limits are UTF-8 bytes, while native budgets are 1024 tokens
per micro and 2048 total. Do not convert one unit into the other by estimation.

Promotion still requires a common admission barrier and deadline-preserving
handoff. Per-worker maintenance and an empty jobs query cannot provide that
barrier. An ingress validator without coordinator restart is an alternative to
review, not an implemented release; direct/internal callers need explicit
coverage. Do not restart the seller, open healthcheck buyer channels, widen
limits or promise a throughput improvement from pre-change vector counts.
