import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { createEmbeddingAdmissionProxy } from "../src/coordinator/embedding-admission-proxy.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const contract = { EMBEDDING_MODEL: "embedding-fixture", parseEmbeddingRequest(input: unknown) {
  const value = input as { messages: Array<{ content: string }> };
  if (!Array.isArray(JSON.parse(value.messages[0]!.content).input)) throw new Error("private-submitted-content");
} };
const body = (model = "embedding-fixture", content = '{"input":["Madrid"]}', deadline_ms?: number) =>
  JSON.stringify({ model, messages: [{ role: "user", content }], ...(deadline_ms ? { deadline_ms } : {}) });
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const upstream = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const proxy = createEmbeddingAdmissionProxy({ upstream, contract, sourceId: "fixture" });
  const url = await proxy.listen(); cleanup.push(async () => { proxy.server.closeAllConnections(); await proxy.close(); });
  return { url, proxy, server };
}
const post = (url: string, payload: string, headers: Record<string, string> = {}) => fetch(url + "/v1/chat/completions", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: payload,
});

it("preserves valid body bytes, credentials, status and response bytes without retries", async () => {
  let received = Buffer.alloc(0); let calls = 0;
  const { url } = await fixture(async (req, res) => {
    calls++; expect(req.headers.authorization).toBe("Bearer fixture"); expect(req.headers["idempotency-key"]).toBe("fixture-id");
    for await (const chunk of req) received = Buffer.concat([received, chunk]);
    res.writeHead(429, { "x-preserved": "yes" }); res.end(Buffer.from([0, 255, 65]));
  });
  const exact = " \n" + body() + "\n ";
  const r = await post(url, exact, { authorization: "Bearer fixture", "idempotency-key": "fixture-id" });
  expect(r.status).toBe(429); expect(r.headers.get("x-preserved")).toBe("yes");
  expect(Buffer.from(await r.arrayBuffer())).toEqual(Buffer.from([0, 255, 65]));
  expect(received).toEqual(Buffer.from(exact)); expect(calls).toBe(1);
});

it("authenticates an invalid envelope upstream without posting an inference", async () => {
  const seen: string[] = [];
  const { url } = await fixture((req, res) => {
    seen.push(req.method + " " + req.url); expect(req.headers.authorization).toBe("Bearer fixture");
    res.writeHead(200); res.end('{"object":"execution_receipt_key"}');
  });
  const r = await post(url, body("embedding-fixture", "hi"), { authorization: "Bearer fixture" });
  expect(r.status).toBe(400); expect(await r.text()).toBe('{"error":{"code":"invalid_embedding_request"}}');
  expect(seen).toEqual(["GET /v1/execution-receipt-key"]);
});

it("preserves failed authentication and never posts invalid input", async () => {
  let posts = 0;
  const { url } = await fixture((req, res) => {
    if (req.method === "POST") posts++;
    res.writeHead(401, { "content-type": "application/json", "x-auth": "preserved" }); res.end('{"error":{"code":"invalid_api_key"}}');
  });
  const r = await post(url, body("embedding-fixture", "hi"));
  expect(r.status).toBe(401); expect(r.headers.get("x-auth")).toBe("preserved");
  expect((await r.json()).error.code).toBe("invalid_api_key"); expect(posts).toBe(0);
});

it("streams SSE chunks before upstream completion and propagates cancellation", async () => {
  let stopped!: () => void; const cancelled = new Promise<void>(resolve => { stopped = resolve; });
  const { url } = await fixture((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n");
    res.once("close", stopped);
  });
  const controller = new AbortController();
  const r = await fetch(url + "/v1/chat/completions", { method: "POST", body: body("kokoro", "text"), headers: { "content-type": "application/json" }, signal: controller.signal });
  const chunk = await r.body!.getReader().read(); expect(Buffer.from(chunk.value!).toString()).toBe("data: first\n\n");
  controller.abort(); await cancelled;
});

it("cancels an upstream request at the original supplied deadline", async () => {
  let stopped!: () => void; const cancelled = new Promise<void>(resolve => { stopped = resolve; });
  const { url } = await fixture((_req, res) => { res.once("close", stopped); });
  const started = Date.now(); const r = await post(url, body("other-chat", "hello", 1000));
  expect(r.status).toBe(504); expect((await r.json()).error.code).toBe("deadline_exceeded");
  await cancelled; expect(Date.now() - started).toBeLessThan(2500);
});

it("rejects JSON above 2 MiB without forwarding or resetting the response socket", async () => {
  let calls = 0; const { url } = await fixture((_req, res) => { calls++; res.end(); });
  const r = await post(url, JSON.stringify({ model: "other", text: "x".repeat(2 * 1024 * 1024) }));
  expect(r.status).toBe(413); await r.text(); expect(calls).toBe(0);
});

it("preserves the non-JSON parser exception rather than imposing the JSON limit", async () => {
  let bytes = 0; const { url } = await fixture(async (req, res) => {
    for await (const chunk of req) bytes += chunk.length;
    res.writeHead(415); res.end("upstream-parser");
  });
  const r = await post(url, "x".repeat(2 * 1024 * 1024 + 1), { "content-type": "application/octet-stream" });
  expect(r.status).toBe(415); expect(await r.text()).toBe("upstream-parser"); expect(bytes).toBe(2 * 1024 * 1024 + 1);
});

it("forwards OPTIONS and malformed outer JSON to preserve upstream behavior", async () => {
  const seen: string[] = []; const { url } = await fixture((req, res) => { seen.push(req.method!); res.writeHead(req.method === "OPTIONS" ? 204 : 400); res.end(); });
  expect((await fetch(url + "/v1/chat/completions", { method: "OPTIONS" })).status).toBe(204);
  expect((await post(url, "{")).status).toBe(400); expect(seen).toEqual(["OPTIONS", "POST"]);
});

it("has a local non-generative health endpoint and no arbitrary forwarding paths", async () => {
  let calls = 0; const { url } = await fixture((_req, res) => { calls++; res.end(); });
  const health = await fetch(url + "/health"); expect((await health.json()).sourceId).toBe("fixture");
  expect((await fetch(url + "/other")).status).toBe(404); expect(calls).toBe(0);
});
