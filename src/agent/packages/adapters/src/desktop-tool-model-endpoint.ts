import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const LOOPBACK = "127.0.0.1";
export const MAX_TOOL_MODEL_INPUT_BYTES = 64 * 1024;
export const MAX_TOOL_MODEL_OUTPUT_TOKENS = 4096;

import type { DesktopToolModelInput } from "@mycellios/adapter-kit";

export type DesktopToolModelResult = {
  text: string;
  stop: "stop" | "length";
  inputTokens: number;
  outputTokens: number;
};

type ModelEndpoint = {
  modelId: string;
  signal: AbortSignal;
  complete(
    input: DesktopToolModelInput,
    signal: AbortSignal,
    onText?: (text: string) => Promise<void>,
  ): Promise<DesktopToolModelResult>;
};

type Dialect = "openai" | "anthropic";
const routes = new Map<string, Dialect>([
  ["/v1/chat/completions", "openai"],
  ["/v1/messages", "anthropic"],
]);

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Object required");
  }
  return value as Record<string, unknown>;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || !value.length) throw new Error("Text blocks required");
  return value.map((item: unknown) => {
    const block = record(item);
    if (block.type !== "text" || typeof block.text !== "string" || Object.keys(block).length !== 2) {
      throw new Error("Only plain text blocks are supported");
    }
    return block.text;
  }).join("");
}

function parseInput(value: unknown, dialect: Dialect, modelId: string) {
  const body = record(value);
  const allowed = ["model", "messages", "max_tokens", "stream",
    dialect === "openai" ? "max_completion_tokens" : "system"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) ||
      body.model !== modelId || (body.stream !== undefined && typeof body.stream !== "boolean") ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 128 ||
      (body.max_tokens !== undefined && body.max_completion_tokens !== undefined)) {
    throw new Error("Unsupported model request");
  }
  const maxTokens = body.max_completion_tokens !== undefined ? body.max_completion_tokens :
    body.max_tokens !== undefined ? body.max_tokens : dialect === "openai" ? 1024 : undefined;
  if (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) ||
      maxTokens < 1 || maxTokens > MAX_TOOL_MODEL_OUTPUT_TOKENS) throw new Error("Invalid output limit");

  let system = body.system === undefined ? undefined : textContent(body.system);
  const messages: DesktopToolModelInput["messages"] = [];
  for (const item of body.messages as unknown[]) {
    const message = record(item);
    if (Object.keys(message).some((key) => key !== "role" && key !== "content")) {
      throw new Error("Unsupported message field");
    }
    const content = textContent(message.content);
    if (dialect === "openai" && message.role === "system" && messages.length === 0) {
      system = system === undefined ? content : [system, content].join("\n");
    } else if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, text: content });
    } else {
      throw new Error("Unsupported message role");
    }
  }
  if (messages[0]?.role !== "user" || messages.at(-1)?.role !== "user") {
    throw new Error("A user message is required at each end of the conversation");
  }
  return { input: { system, messages, maxTokens }, stream: body.stream === true };
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
  res.end(JSON.stringify(body));
}

function reject(res: ServerResponse, dialect: Dialect, status: number, message: string) {
  const type = status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" :
    status >= 500 ? "api_error" : "invalid_request_error";
  send(res, status, { ...(dialect === "anthropic" ? { type: "error" } : {}), error: { type, message } });
}

function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  return new Promise((resolve, rejectBody) => {
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= MAX_TOOL_MODEL_INPUT_BYTES) chunks.push(chunk);
      else resolve(undefined);
    });
    req.once("end", () => resolve(bytes <= MAX_TOOL_MODEL_INPUT_BYTES ? Buffer.concat(chunks) : undefined));
    req.once("error", rejectBody);
  });
}

function responseBody(dialect: Dialect, model: string, result: DesktopToolModelResult) {
  const { text, stop, inputTokens, outputTokens } = result;
  if (dialect === "anthropic") {
    return {
      id: `msg_${randomUUID()}`, type: "message", role: "assistant", model,
      content: [{ type: "text", text }], stop_reason: stop === "stop" ? "end_turn" : "max_tokens",
      stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
  }
  return {
    id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: stop }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
}

function eventStream(res: ServerResponse, dialect: Dialect, model: string, signal: AbortSignal) {
  const id = (dialect === "openai" ? "chatcmpl-" : "msg_") + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let started = false;

  async function sendEvent(type: string | undefined, data: unknown) {
    signal.throwIfAborted();
    const event = type ? `event: ${type}\n` : "";
    const encoded = data === "[DONE]" ? data : JSON.stringify(data);
    if (!res.write(`${event}data: ${encoded}\n\n`)) await once(res, "drain", { signal });
  }
  const openai = (delta: object, reason: string | null) => sendEvent(undefined, {
    id, model, created, object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: reason }],
  });
  const anthropic = (type: string, payload: object = {}) => sendEvent(type, { type, ...payload });

  async function start() {
    if (started) return;
    started = true;
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-store", connection: "close",
    });
    if (dialect === "openai") {
      await openai({ role: "assistant" }, null);
      return;
    }
    await anthropic("message_start", {
      message: { id, type: "message", role: "assistant", model, content: [],
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    });
    await anthropic("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  }

  return {
    async text(text: string) {
      await start();
      if (dialect === "openai") await openai({ content: text }, null);
      else await anthropic("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
    },
    async finish(result: DesktopToolModelResult) {
      await start();
      if (dialect === "openai") {
        await openai({}, result.stop);
        await sendEvent(undefined, "[DONE]");
      } else {
        await anthropic("content_block_stop", { index: 0 });
        await anthropic("message_delta", {
          delta: { stop_reason: result.stop === "stop" ? "end_turn" : "max_tokens", stop_sequence: null },
          usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
        });
        await anthropic("message_stop");
      }
      res.end();
    },
    async fail() {
      const message = "The account model call was refused or interrupted";
      if (!started) return reject(res, dialect, 502, message);
      await sendEvent(dialect === "anthropic" ? "error" : undefined, {
        ...(dialect === "anthropic" ? { type: "error" } : {}), error: { type: "api_error", message },
      });
      res.end();
    },
  };
}

/** One ephemeral listener for one owned run. Only the command environment receives its token. */
export async function startDesktopToolModelEndpoint(endpoint: ModelEndpoint) {
  endpoint.signal.throwIfAborted();
  const lifetime = new AbortController();
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  let authority = "";
  let active = 0;

  const server = createServer({
    headersTimeout: 10_000, requestTimeout: 10_000, connectionsCheckingInterval: 1000,
  }, (req, res) => {
    const dialect = routes.get(req.url ?? "");
    // Browser POSTs carry Origin or Fetch Metadata site. Node SDKs can set only the mode.
    if (!dialect || req.method !== "POST" || req.headers.host !== authority ||
        req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined ||
        req.socket.remoteAddress !== LOOPBACK) {
      req.resume();
      return reject(res, dialect ?? "openai", 403, "Local model request refused");
    }
    const credential = dialect === "anthropic" && !req.headers.authorization
      ? req.headers["x-api-key"] : req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (lifetime.signal.aborted || typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential) ||
        !timingSafeEqual(Buffer.from(credential), expected)) {
      req.resume();
      return reject(res, dialect, 401, "Local model token is invalid");
    }
    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      req.resume();
      return reject(res, dialect, 415, "Content-Type must be application/json");
    }
    if (req.headers["x-stainless-retry-count"] !== undefined && req.headers["x-stainless-retry-count"] !== "0") {
      req.resume();
      return reject(res, dialect, 409, "A model call with an uncertain outcome cannot be retried");
    }
    if (active >= 2) {
      req.resume();
      return reject(res, dialect, 429, "Too many simultaneous local model calls");
    }

    active += 1;
    const client = new AbortController();
    res.once("close", () => client.abort());
    const signal = AbortSignal.any([lifetime.signal, client.signal]);
    let streaming: ReturnType<typeof eventStream> | undefined;
    void (async () => {
      const bytes = await readBody(req);
      if (!bytes) return reject(res, dialect, 413, "Local model request is too large");
      let parsed: ReturnType<typeof parseInput>;
      try {
        parsed = parseInput(JSON.parse(bytes.toString("utf8")), dialect, endpoint.modelId);
      } catch {
        return reject(res, dialect, 400, "Unsupported local model request");
      }
      signal.throwIfAborted();
      if (parsed.stream) streaming = eventStream(res, dialect, endpoint.modelId, signal);
      const result = await endpoint.complete(parsed.input, signal, streaming?.text);
      signal.throwIfAborted();
      if (streaming) await streaming.finish(result);
      else send(res, 200, responseBody(dialect, endpoint.modelId, result));
    })().catch(async () => {
      if (signal.aborted) return;
      if (streaming) await streaming.fail().catch(() => res.destroy());
      else reject(res, dialect, 502, "The account model call was refused or interrupted");
    }).finally(() => { active -= 1; });
  });
  server.maxConnections = 8;
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, LOOPBACK, () => {
      server.removeListener("error", rejectListen);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local model listener has no address");
  authority = `${LOOPBACK}:${address.port}`;

  let closing: Promise<void> | undefined;
  const close = () => closing ??= new Promise<void>((resolve) => {
    lifetime.abort();
    endpoint.signal.removeEventListener("abort", abort);
    server.close(() => resolve());
    server.closeAllConnections();
  });
  const abort = () => { void close(); };
  endpoint.signal.addEventListener("abort", abort, { once: true });
  if (endpoint.signal.aborted) {
    await close();
    endpoint.signal.throwIfAborted();
  }
  const base = `http://${authority}`;
  return {
    close,
    environment: {
      OPENAI_BASE_URL: `${base}/v1`, OPENAI_API_KEY: token,
      ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: token,
      MYCELLIOS_MODEL: endpoint.modelId,
    },
  };
}
