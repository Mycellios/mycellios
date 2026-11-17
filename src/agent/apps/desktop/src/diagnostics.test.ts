import { mkdtemp, readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopDiagnostics, desktopExceptionFields } from "./diagnostics.js";
const roots: string[] = [];
const instances: DesktopDiagnostics[] = [];
async function create(options: { maxBytes?: number; maxPending?: number } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mycellios-diagnostics-test-"));
  roots.push(dir);
  const value = new DesktopDiagnostics(dir, { version: "1.2.3", platform: "win32", ...options });
  instances.push(value);
  return { dir, value };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const i of instances.splice(0)) await i.close();
  for (const d of roots.splice(0)) await rm(d, { recursive: true, force: true });
});
it("persists and copies only safe categories and correlation, never error bodies or identities", async () => {
  const { dir, value } = await create();
  await value.start();
  value.record("operation_failed", {
    code: "desktop_disconnected",
    stage: "poll",
    operationId: "12345678-1234-4321-8765-123456789abc",
    runId: "cm00000000000000000000001",
    message: "Bearer private-secret",
    url: "https://private.test",
    command: "secret",
    account: "private@example.test",
    errorCode: "ECONNRESET",
    errorName: "TypeError",
  });
  const text = JSON.stringify(await value.snapshot());
  expect(text).toContain("ECONNRESET");
  expect(text).toContain("cm00000000000000000000001");
  expect(text).not.toMatch(/private-secret|private\.test|private@example|Bearer|command/);
  expect(await readFile(path.join(dir, "desktop.ndjson"), "utf8")).not.toContain("private-secret");
});
it("keeps only two bounded files and recovers valid records after a partial crash line", async () => {
  const { dir, value } = await create({ maxBytes: 800 });
  for (let i = 0; i < 12; i++) {
    value.record("operation_received", { runId: `run_${i}` });
    await value.flush();
  }
  const files = (await readdir(dir)).filter((n) => n.startsWith("desktop.ndjson"));
  expect(files.sort()).toEqual(["desktop.ndjson", "desktop.ndjson.1"]);
  for (const file of files)
    expect((await stat(path.join(dir, file))).size).toBeLessThanOrEqual(800);
  await writeFile(path.join(dir, "desktop.ndjson"), '\n{"partial":', { flag: "a" });
  expect((await value.snapshot()).events.length).toBeGreaterThan(0);
});
it("bounds pending disk work and reports dropped records without failing a run", async () => {
  const { value } = await create({ maxPending: 2 });
  for (let i = 0; i < 100; i++) value.record("operation_received", { runId: `run_${i}` });
  expect((await value.snapshot()).dropped).toBeGreaterThan(0);
});
it("records an unclean previous session separately from a requested quit", async () => {
  const { dir, value } = await create();
  await writeFile(
    path.join(dir, "session.json"),
    JSON.stringify({ clean: false, lastSeen: Date.now() - 1000 }),
  );
  await value.start();
  expect((await value.snapshot()).events).toEqual(
    expect.arrayContaining([expect.objectContaining({ event: "previous_unclean_exit" })]),
  );
  await value.close();
  expect(JSON.parse(await readFile(path.join(dir, "session.json"), "utf8")).clean).toBe(true);
});
it("keeps recent metadata usable when the diagnostic location cannot be written", async () => {
  const { dir } = await create();
  const file = path.join(dir, "blocked");
  await writeFile(file, "not a directory");
  const value = new DesktopDiagnostics(file, {
    version: "secret-version",
    platform: "secret-platform",
  });
  instances.push(value);
  value.record("operation_failed", { runId: "safe" });
  const snapshot = await value.snapshot();
  expect(snapshot.writeFailures).toBeGreaterThan(0);
  expect(snapshot.version).toBe("unknown");
  expect(snapshot.events).toHaveLength(1);
});
it("records OS causes across fetch wrappers without copying private exception text", () => {
  const cause = Object.assign(new Error("https://private.test Bearer secret"), {
    code: "ECONNREFUSED",
  });
  expect(desktopExceptionFields(new TypeError("fetch failed", { cause }))).toEqual({
    errorName: "TypeError",
    errorCode: "ECONNREFUSED",
  });
  expect(desktopExceptionFields({ name: "private-secret", code: "private-secret" })).toEqual({
    errorName: "Error",
    errorCode: undefined,
  });
});
it("copies a partial in-memory diagnostic when disk work stalls, instead of hanging support", async () => {
  const { value } = await create();
  await value.flush();
  vi.spyOn(value, "flush").mockImplementation(() => new Promise(() => {}));
  value.record("resume");
  vi.useFakeTimers();
  const copying = value.copyText();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(JSON.parse(await copying)).toMatchObject({
    state: "partial",
    events: [expect.objectContaining({ event: "resume" })],
  });
});
