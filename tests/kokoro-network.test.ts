import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinator, type CoordinatorRuntime } from "../src/coordinator/server.js";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST } from "../src/contracts/speech.js";
import { WorkerAgent } from "../src/worker/agent.js";
import { generateWorkerAdmissionCredential, workerAdmissionSigner } from "../src/worker/admission-credential.js";
import { speechReply, health } from "./kokoro-fixture.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function runtimeUrl() {
  const server = createServer((req, res) => {
    if (req.url === "/health") { res.end(JSON.stringify(health)); return; }
    const chunks: Buffer[] = [];
    void (async () => {
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString());
      // A large response exercises the real worker byte and token boundaries.
      await new Promise((r) => setTimeout(r, 60));
      res.end(JSON.stringify(speechReply(input.text, 180_000)));
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); });
  return "http://127.0.0.1:" + (server.address() as { port: number }).port + "/";
}
async function network(baseUrls: string[]) {
  const runtime = await createCoordinator({
    host: "127.0.0.1", port: 0, databasePath: ":memory:", requestTimeoutMs: 120_000,
    allowDevelopmentAdapters: false, mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
    landingAssetsPath: resolve("tests/fixtures/landing-assets"),
  });
  cleanup.push(() => runtime.close());
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  for (const [index, baseUrl] of baseUrls.entries()) {
    const agent = new WorkerAgent(workerConfigSchema.parse({
      region: "test", offeredVramMb: 4096, limits: { maxConcurrency: 1, pauseWhenForeground: false },
      adapter: { kind: "kokoro", model: KOKORO_MODEL, baseUrl },
      deployment: { modelDigest: KOKORO_WEIGHT_DIGEST, peakVramMb: 1024, contextLimit: 8192 },
    }), {
      coordinatorUrl: address, heartbeatIntervalMs: 100, reconnect: false,
      identity: { kind: "device", id: "speech-test-" + index },
      admissionSigner: workerAdmissionSigner(generateWorkerAdmissionCredential()),
      hardwareProbe: async () => ({ hostname: "speech-test-" + index, platform: process.platform, ramMb: 8192, gpus: [] }),
      logger: { info() {}, warn() {}, error() {} },
    });
    const run = agent.start();
    cleanup.push(async () => { await agent.stop(); await run; });
  }
  const deadline = Date.now() + 10_000;
  while (runtime.hub.connectedWorkerIds().size !== baseUrls.length) {
    if (Date.now() > deadline) throw new Error("speech_workers_not_connected");
    await new Promise((r) => setTimeout(r, 25));
  }
  return { runtime, address };
}
async function speak(address: string, text: string, stream = false) {
  return fetch(address + "/v1/chat/completions", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: KOKORO_MODEL, messages: [{ role: "user", content: text }], stream }),
  });
}
describe("Kokoro over the real Mycellios worker protocol", () => {
  it("lists two replicas and delivers bounded audio with honest usage through a production-mode coordinator", async () => {
    const { address, runtime } = await network([await runtimeUrl(), await runtimeUrl()]);
    const models = await (await fetch(address + "/v1/models")).json() as { data: Array<{ id: string; x_replicas: number }> };
    expect(models.data).toContainEqual(expect.objectContaining({ id: KOKORO_MODEL, x_replicas: 2 }));
    const responses = await Promise.all([speak(address, "Hola uno"), speak(address, "Hola dos")]);
    for (const response of responses) {
      const body = await response.json() as { choices: Array<{ message: { content: string }; finish_reason: string }>; usage: { prompt_tokens: number; completion_tokens: number } };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(JSON.parse(body.choices[0]!.message.content).audio.data.length).toBeGreaterThan(65536);
      expect(body.choices[0]!.finish_reason).toBe("stop");
      expect(body.usage).toMatchObject({ prompt_tokens: 2, completion_tokens: 0 });
    }
    expect(runtime.store.listJobs().every((j) => j.status === "completed")).toBe(true);
    const streamed = await speak(address, "Hola stream", true);
    const sse = await streamed.text();
    expect(sse).toContain("data: [DONE]");
    expect(sse).toContain('"completion_tokens":0');
  });
  it.skipIf(!process.env.MYCELLIOS_KOKORO_REAL_URL)("delivers actual Kokoro WAV through an authenticated worker session", async () => {
    const { address } = await network([process.env.MYCELLIOS_KOKORO_REAL_URL!]);
    const response = await speak(address, "Hola Daniel. Esta voz se genera en Mycellios.");
    const body = await response.json() as { choices: Array<{ message: { content: string } }>; usage: { prompt_tokens: number; completion_tokens: number } };
    expect(response.status, JSON.stringify(body)).toBe(200);
    const speech = JSON.parse(body.choices[0]!.message.content);
    expect(speech.audio.duration_seconds).toBeGreaterThan(1);
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.completion_tokens).toBe(0);
  });
});
