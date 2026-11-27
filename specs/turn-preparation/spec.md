# Turn preparation latency

Status: phase 1 in progress; phase 2 waits for the phase 1 measurements.

## Problem

A Mico takes several seconds before its model starts. The worker rebuilds the whole
turn from the database every time: thread, Mico, history (up to 200 decrypted rows),
connections, skills, secrets, memory, model credential, MCP tool lists, the PC's answer
and a long series of policy reads, mostly one after another. A production turn on
2026-11-27 logged `run.prepare_ms` = 16,885 before its first model request, while its
model calls took 1-8 s each.

The reference app keeps its sessions warm instead: tools are fixed when a session is
created, MCP tool lists are reused for 30 minutes, idle engine processes stay for
5 minutes and a new turn only sends what changed. It is a behavior reference only; no
code is copied.

The PC is not where the time goes. Desktop already keeps its Pi runtime for the
signed-in account between turns (recreated only when the account scope changes), and
the Codex and Claude Code engines keep their idle process for 5 minutes. A "warm Pi
session on the PC" would mostly save sending the history, which is small next to the
server's setup.

## Phase 1 (this change)

- `run.prepared` also logs `run.prepare_stages`: milliseconds since setup began at
  `loaded`, `context`, `recall`, `model`, `computer`, `host` and `tools`.
- Setup reads that do not depend on each other start together (`startedEarly`):
  history position, location, agent environment, model override credential, live
  plugin list, routine/workflow ownership, personal memory, local memory scope, the
  PC's provision kind, group context, messaging identity, member name, source message,
  branch handoff, routine browser, task tools, owner defaults and workflow answers.
  Each result is still taken where it was used; a failure surfaces there, and a run that
  ends earlier ignores it. No check moves before what it depends on.
- A live MCP session keeps its tool list for `MCP_TOOL_LIST_TTL_MS` (30 minutes) in the
  API and worker. The session is revalidated first (revision, credential record and
  digest, token expiry), so a changed server, a rotated credential or a relaunched
  process asks again. Tool calls are unchanged.

Not changed: credential resolution and decryption, the model catalog (already cached),
approval and policy reads, and the order of anything that writes.

## Phase 2 (after one day of `run.prepare_stages`)

Pick the stage that dominates and remove it, in this order of preference:

1. `loaded` dominates (history decrypt, skills, secrets): keep a per-thread warm
   context in the worker for 5 minutes, keyed by thread, `contextStartSeq`, compaction
   generation and the last message sequence, and read only newer messages. Any delete,
   edit, reset, branch or compaction invalidates it (the same events that already
   invalidate summaries, checkpoints and native session reuse).
2. `computer`/`host` dominate (relay round trips): ask the PC's provision kind and
   environment in one relay request and keep the answer for the turn's lifetime only.
3. `tools` dominates (tool building and policy reads): fingerprint the built tool set by
   Mico settings revision, disabled tools, connections and MCP revisions, and reuse it
   while the fingerprint matches.
4. `recall` dominates (memory and MCP discovery): bound automatic recall with a shorter
   deadline and continue without it, as personal memory already does.

A warm PC-side Pi session with delta history is not planned unless the measurements
show history transfer to the PC as a significant cost.

## Verification

- Adapters executor suites and `mcp-connector.test.ts` (the TTL test covers reuse,
  expiry and rotation).
- After deploy: compare `run.prepare_ms` before and after, and read
  `run.prepare_stages` for phase 2.
