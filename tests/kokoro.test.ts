import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { KokoroAdapter } from "../src/adapters/kokoro.js";
import { createAdapter } from "../src/adapters/factory.js";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST } from "../src/contracts/speech.js";

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } });
async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return "http://127.0.0.1:" + address.port + "/";
}
import { speechReply, health } from "./kokoro-fixture.js";
const request = { jobId: "speech-test", request: { model: KOKORO_MODEL, messages: [{ role: "user" as const, content: "Hola" }] } };
describe("native Kokoro replica", () => {
  it("preserves audio across bounded chunks and never bills its base64 as output tokens", async () => {
    const expected = speechReply();
    const url = await listen((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.url === "/health" ? health : expected)); });
    const adapter = new KokoroAdapter({ baseUrl: url, model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST });
    await adapter.probe();
    const chunks = [];
    for await (const chunk of adapter.generate(request, new AbortController().signal)) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => Buffer.byteLength(c.text) <= 65536)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe(expected.content);
    expect(chunks.at(-1)?.metrics).toMatchObject({ inputTokens: 2, outputTokens: 0 });
  });
  it("rejects a different checkpoint and remote endpoints before inference", async () => {
    expect(() => new KokoroAdapter({ baseUrl: "https://example.com/", model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST })).toThrow();
    const url = await listen((_req, res) => { res.end(JSON.stringify({ ...health, artifact_identity: "wrong" })); });
    const adapter = new KokoroAdapter({ baseUrl: url, model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST });
    await expect(adapter.probe()).rejects.toThrow();
    await expect(adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("not_ready");
  });
  it("rejects corrupt audio before forwarding any chunk", async () => {
    const bad = speechReply();
    const envelope = JSON.parse(bad.content); envelope.audio.sha256 = "0".repeat(64);
    bad.content = JSON.stringify(envelope);
    const url = await listen((req, res) => { res.end(JSON.stringify(req.url === "/health" ? health : bad)); });
    const adapter = new KokoroAdapter({ baseUrl: url, model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST });
    await adapter.probe();
    await expect(adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("integrity");
  });
  it("aborts an in-flight runtime request and releases local tracking", async () => {
    let received!: () => void;
    const pending = new Promise<void>((resolve) => { received = resolve; });
    const url = await listen((req, res) => {
      if (req.url === "/health") res.end(JSON.stringify(health));
      else received();
    });
    const adapter = new KokoroAdapter({ baseUrl: url, model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST });
    await adapter.probe();
    const result = adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next();
    const checked = expect(result).rejects.toThrow();
    await pending; await adapter.cancel(request.jobId); await checked;
    expect((await adapter.metrics()).activeJobs).toBe(0);
  });
  it("requires an exact local artifact and one slot in the worker configuration", () => {
    const config = { region: "test", offeredVramMb: 2048, limits: { maxConcurrency: 1 },
      adapter: { kind: "kokoro", model: KOKORO_MODEL, baseUrl: "http://127.0.0.1:8890/" },
      deployment: { modelDigest: KOKORO_WEIGHT_DIGEST } };
    expect(createAdapter(workerConfigSchema.parse(config)).kind).toBe("kokoro");
    expect(workerConfigSchema.safeParse({ ...config, limits: { maxConcurrency: 2 } }).success).toBe(false);
    expect(workerConfigSchema.safeParse({ ...config, deployment: {} }).success).toBe(false);
  });
});
