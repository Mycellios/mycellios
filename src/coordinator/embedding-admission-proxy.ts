import { createServer, request as upstreamRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type Envelope = { model?: unknown; deadline_ms?: unknown };
type Contract = { EMBEDDING_MODEL: string; parseEmbeddingRequest(request: never): unknown };
const JSON_LIMIT = 2 * 1024 * 1024;
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

function headersFor(headers: IncomingMessage["headers"]): IncomingMessage["headers"] {
  const result = { ...headers };
  for (const name of [...HOP_HEADERS, ...(headers.connection ?? "").split(",").map(value => value.trim().toLowerCase())]) delete result[name];
  return result;
}

/** A transport-only ingress; authentication, quotas and execution stay upstream. */
export function createEmbeddingAdmissionProxy(options: {
  upstream: string;
  contract: Contract;
  sourceId: string;
}) {
  const upstream = new URL(options.upstream);
  if (upstream.protocol !== "http:" || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw new Error("admission_upstream_must_be_a_fixed_credential_free_http_origin");
  }
  const counters = { active: 0, accepted: 0, rejected: 0, authRejected: 0, upstreamFailed: 0 };
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: "ok", sourceId: options.sourceId, ...counters }));
      return;
    }
    if (!/^\/v1\/chat\/completions(?:\?|$)/.test(request.url ?? "")) {
      response.writeHead(404); response.end(); return;
    }
    counters.active++;
    const started = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outgoing: ReturnType<typeof upstreamRequest> | undefined;
    let upstreamResponse: IncomingMessage | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; counters.active--;
      if (timer) clearTimeout(timer);
    };
    const cancel = () => {
      controller.abort(); outgoing?.destroy(); upstreamResponse?.destroy(); release();
    };
    request.once("aborted", cancel);
    response.once("close", () => { if (!response.writableFinished) cancel(); else release(); });
    response.once("finish", release);
    const reject = (status: number, code: string) => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: { code } }));
    };
    const forward = (body?: Buffer) => {
      if (controller.signal.aborted || response.destroyed) return;
      const headers = headersFor(request.headers);
      if (body) headers["content-length"] = String(body.length);
      outgoing = upstreamRequest({ hostname: upstream.hostname, port: upstream.port,
        method: request.method, path: request.url, headers, signal: controller.signal }, incoming => {
        upstreamResponse = incoming;
        if (response.destroyed) { incoming.destroy(); return; }
        response.writeHead(incoming.statusCode ?? 502, headersFor(incoming.headers));
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      outgoing.on("error", () => {
        if (controller.signal.aborted) return;
        counters.upstreamFailed++; reject(502, "admission_upstream_unavailable");
      });
      if (body) outgoing.end(body); else request.pipe(outgoing);
    };
    const process = async () => {
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (request.method !== "POST" || !/^application\/(?:[\w.+-]+\+)?json$/.test(contentType ?? "") || request.headers["content-encoding"]) {
        forward(); return; // Keep non-JSON parsers and their own size limits upstream.
      }
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > JSON_LIMIT) { request.resume(); reject(413, "FST_ERR_CTP_BODY_TOO_LARGE"); return; }
        chunks.push(chunk);
      }
      if (controller.signal.aborted || response.destroyed) return;
      const body = Buffer.concat(chunks);
      let parsed: Envelope;
      try { parsed = JSON.parse(body.toString("utf8")) as Envelope; }
      catch { forward(body); return; } // Preserve upstream JSON-parser errors.
      if (!parsed || typeof parsed !== "object") { forward(body); return; }
      if (typeof parsed.deadline_ms === "number" && Number.isSafeInteger(parsed.deadline_ms) && parsed.deadline_ms >= 1_000 && parsed.deadline_ms <= 3_600_000) {
        const remaining = parsed.deadline_ms - (Date.now() - started);
        if (remaining <= 0) { reject(504, "deadline_exceeded"); return; }
        timer = setTimeout(() => { reject(504, "deadline_exceeded"); cancel(); }, remaining);
        timer.unref();
      }
      if (parsed.model !== options.contract.EMBEDDING_MODEL) { forward(body); return; }
      try { options.contract.parseEmbeddingRequest(parsed as never); }
      catch {
        // This protected, read-only endpoint shares the real API authentication
        // hook, supports account AND operator keys and never admits a model job.
        const authHeaders = headersFor(request.headers);
        delete authHeaders["content-length"]; delete authHeaders["content-type"];
        const auth = await new Promise<IncomingMessage>((resolve, rejectAuth) => {
          const check = upstreamRequest({ hostname: upstream.hostname, port: upstream.port,
            path: "/v1/execution-receipt-key", method: "GET", headers: authHeaders,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) }, resolve);
          check.on("error", rejectAuth); check.end();
        });
        upstreamResponse = auth;
        if (auth.statusCode !== 200) {
          counters.authRejected++;
          response.writeHead(auth.statusCode ?? 503, headersFor(auth.headers));
          auth.on("error", () => response.destroy()); auth.pipe(response); return;
        }
        auth.resume();
        counters.rejected++; reject(400, "invalid_embedding_request"); return;
      }
      counters.accepted++; forward(body);
    };
    void process().catch(() => {
      if (!controller.signal.aborted) reject(503, "admission_validation_unavailable");
    });
  });
  server.requestTimeout = 0;
  return {
    server,
    counters,
    async listen(host = "127.0.0.1", port = 0) {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
      return `http://${host}:${(server.address() as AddressInfo).port}`;
    },
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
