import { test } from "node:test";
import assert from "node:assert/strict";
import { runHealth, lastRunOutput } from "./run-health.ts";
const now = Date.parse("2026-01-01T12:00:00Z");
const ago = (n) => new Date(now - n * 60000).toISOString();
const run = {
  id: "run",
  botId: "bot",
  status: "running",
  createdAt: ago(600),
  startedAt: ago(600),
  updatedAt: ago(1),
  leaseExpiresAt: ago(-4),
};
test("a ten-hour render with a current worker lease stays active even without output", () => {
  assert.equal(runHealth(run, { now }).state, "quiet");
  assert.equal(runHealth(run, { now, lastOutputAt: ago(1) }).state, "running");
  assert.equal(runHealth(run, { now }).elapsedMs, 10 * 3600000);
});
test("renewed dispatch is never presented as model execution before setup", () => {
  assert.equal(runHealth({ ...run, startedAt: null }, { now }).state, "starting");
  assert.equal(
    runHealth({ ...run, startedAt: null }, { now, missingComputer: true }).state,
    "blocked",
  );
});
test("missing heartbeat metadata and lost contact are distinct, never terminal", () => {
  assert.equal(runHealth({ ...run, leaseExpiresAt: null }, { now }).state, "unknown");
  assert.equal(runHealth({ ...run, leaseExpiresAt: ago(2) }, { now }).state, "recovering");
  assert.equal(run.status, "running");
});
test("waits and terminal states do not look like active work", () => {
  for (const status of ["waiting_input", "waiting_takeover"])
    assert.equal(runHealth({ ...run, status }, { now }).state, "waiting");
  assert.equal(runHealth({ ...run, status: "queued", wakeAt: ago(-20) }, { now }).state, "queued");
  for (const status of ["failed", "completed", "cancelled"])
    assert.equal(runHealth({ ...run, status }, { now }).state, "idle");
});
test("user messages, other bots and old history are not new output", () => {
  const current = { ...run, createdAt: ago(5) };
  assert.equal(
    lastRunOutput(current, [
      { role: "user", createdAt: ago(1), runId: "run" },
      { role: "bot", createdAt: ago(1), botId: "other" },
      { role: "bot", createdAt: ago(10), botId: "bot" },
    ]),
    null,
  );
  assert.equal(
    lastRunOutput(current, [
      { role: "bot", createdAt: ago(2), runId: "run" },
      { role: "bot", createdAt: ago(1), runId: "run" },
    ]),
    ago(1),
  );
});
