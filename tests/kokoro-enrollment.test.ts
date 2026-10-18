import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createCoordinator } from "../src/coordinator/server.js";
import { NodeEnrollmentStore } from "../src/coordinator/node-enrollment-store.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, verifiedSpeechEnvelope } from "../src/contracts/speech.js";
import { health, speechReply } from "./kokoro-fixture.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it("binds the standalone speech CLI to its owning account before opening an authenticated worker session", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycellios-speech-enrollment-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const engine = createServer(async (request, response) => {
    if (request.url === "/health") { response.end(JSON.stringify(health)); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.end(JSON.stringify(speechReply(JSON.parse(Buffer.concat(chunks).toString()).text)));
  });
  await new Promise<void>((done) => engine.listen(0, "127.0.0.1", done));
  cleanup.push(async () => { engine.closeAllConnections(); await new Promise<void>((done) => engine.close(() => done())); });
  const runtime = await createCoordinator({
    host: "127.0.0.1", port: 0, databasePath: ":memory:", networkToken: "test-enrollment-network-token",
    requestTimeoutMs: 30_000, allowDevelopmentAdapters: false,
    mobileAssetsPath: resolve("tests/fixtures/mobile-assets"), landingAssetsPath: resolve("tests/fixtures/landing-assets"),
  });
  cleanup.push(() => runtime.close());
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const identityId = "standalone-enrolled-speech";
  const enrollments = new NodeEnrollmentStore(runtime.database);
  // The account grant is a fixture; the CLI still redeems through the real HTTP route.
  const issued = enrollments.issue({ accountId: "speech-owner", expiresInSeconds: 600,
    actor: { kind: "account", id: "speech-owner", scopes: ["node:identity"] } });
  enrollments.confirm({ enrollmentId: issued.enrollmentId, accountId: "speech-owner", actorId: "speech-owner" });
  const enrollmentPath = join(root, "enrollment.json");
  await writeFile(enrollmentPath, JSON.stringify({ schema: "mycellios-node-enrollment-bundle/1", coordinatorUrl: address, ...issued }), { mode: 0o600 });
  const configPath = join(root, "worker.json");
  await writeFile(configPath, JSON.stringify({
    instanceId: identityId, region: "test", offeredVramMb: 2048,
    limits: { maxConcurrency: 1, pauseWhenForeground: false },
    adapter: { kind: "kokoro", model: KOKORO_MODEL, baseUrl: `http://127.0.0.1:${(engine.address() as { port: number }).port}/` },
    deployment: { modelDigest: KOKORO_WEIGHT_DIGEST, peakVramMb: 1536, contextLimit: 8192 },
  }));
  const child = spawn(process.execPath, ["--import", "tsx", resolve("src/worker/main.ts")], {
    env: { ...process.env, GPU_MESH_COORDINATOR: address, GPU_MESH_WORKER_CONFIG: configPath,
      MYCELLIOS_WORKER_CREDENTIAL_PATH: join(root, "credential.json"), MYCELLIOS_WORKER_ENROLLMENT_PATH: enrollmentPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-4096); });
  child.stdout.resume();
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  cleanup.push(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000); timeout.unref();
    await exited; clearTimeout(timeout);
  });
  const deadline = Date.now() + 20_000;
  while (runtime.hub.connectedWorkerIds().size !== 1) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error("enrolled_cli_failed: " + diagnostics);
    await new Promise((done) => setTimeout(done, 50));
  }
  expect(runtime.database.getNodeOwnership("device", identityId)).toMatchObject({ accountId: "speech-owner", status: "active", generation: 1 });
  await expect(access(enrollmentPath)).rejects.toMatchObject({ code: "ENOENT" });
  const response = await fetch(address + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-enrollment-network-token" },
    body: JSON.stringify({ model: KOKORO_MODEL, messages: [{ role: "user", content: "Hola" }], max_tokens: 1 }),
  });
  expect(response.status).toBe(200);
  const completion = await response.json();
  expect(verifiedSpeechEnvelope(completion.choices[0].message.content, "Hola").audio.format).toBe("wav");
  expect(completion.usage.completion_tokens).toBe(0);
});
