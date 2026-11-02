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
barrier. The separate ingress proxy provides a release path without replacing the
coordinator; direct/internal callers still need explicit coverage. Do not restart the seller, open healthcheck buyer channels, widen
limits or promise a throughput improvement from pre-change vector counts.


## Reproducible ingress release

Build the independent transport with `scripts/build-embedding-admission-proxy.mjs`.
Supply a new output directory, immutable base/Nginx image IDs, exact embedding
contract SHA-256, fixed credential-free upstream origin, fetched main revision
and `--compiler-api` pointing to the installed TypeScript 6.0.3 API. This emitter
is explicitly pinned because the project's TypeScript 7 compiler does not expose
that legacy transpilation API. It does not replace the project typechecker.

The builder emits the module, startup entrypoint, configuration and hash manifest.
The startup entrypoint verifies each mounted runtime file before listening. Mount
only those files read-only into the pinned image; grant no database or persisted
API credentials, no host port and no new wallet. Record whether source files
actually belong to the named Git commit rather than attributing dirty additions
to that commit. Preserve the existing coordinator's independent build identity.

Route only the exact public chat-completions path through the proxy. Preserve
all other Nginx routes, logging, request limits and parser exceptions. Confirm
readiness privately; use a non-generative OPTIONS route marker to prove the new
Nginx worker is serving traffic before a negative control. No model inference or
AntSeed channel is required for healthchecks. Never infer activation from a
configuration file read alone. Keep direct/internal bypasses explicit.

Reload Nginx rather than restarting workers or seller. Before writing, lock the
promotion, check current config and protected runtime identities, and save the
old bytes. For file bind mounts retain the original inode. Validate with nginx -t
before reload; revert the previous bytes if validation fails. A rollback must
leave the proxy running until old Nginx workers and their buffered/active calls
have drained. Never cut calls to remove an otherwise unused proxy.

Verify real traffic with a post-activation baseline and readback, not extra
competing GPU probes. Correlate rejected requests with seller event/session IDs
without storing payloads or secret headers. Do not call a 400 response monetary
savings: on-chain OPEN precedes payload delivery. Keep price, daily cap, ledger,
audit, channel TTL, owner quotas and chat priority unchanged.
