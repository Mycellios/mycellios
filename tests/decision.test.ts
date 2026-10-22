import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionAdapter } from "../src/adapters/decision.js";
import { createAdapter } from "../src/adapters/factory.js";
import { DECISION_CONTEXT_LIMIT, DECISION_DEADLINE_MS, DECISION_DIGEST, DECISION_MODEL, DECISION_REVISION, DECISION_TOKENIZER_SHA256,
  decisionInputSchema, decisionRequestDigest, verifiedDecisionEnvelope } from "../src/contracts/decision.js";
import { chatCompletionRequestSchema, workerConfigSchema } from "../src/contracts/schemas.js";
import { replicaOutputByteLimit } from "../src/coordinator/speech-completion.js";
import { resolve } from "node:path";
import { createCoordinator } from "../src/coordinator/server.js";
import { WorkerAgent } from "../src/worker/agent.js";
import { estimateInputTokens } from "../src/core/request.js";
import { generateWorkerAdmissionCredential, workerAdmissionSigner } from "../src/worker/admission-credential.js";

const servers: Server[] = [];
const tokenDirectories: string[] = [];
function installTestToken() {
  const folder = mkdtempSync(join(tmpdir(), "mycellios-decision-token-test-")); tokenDirectories.push(folder);
  const path = join(folder, "runtime-token"); writeFileSync(path, "t".repeat(64), { mode: 0o600 });
  vi.stubEnv("MYCELLIOS_DECISION_RUNTIME_TOKEN_FILE", path);
}
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
  for (const directory of tokenDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return "http://127.0.0.1:" + (server.address() as { port: number }).port + "/";
}
const input = decisionInputSchema.parse({ schema: "mycellios-decisions/1", state: "A shipment is late. España 🚚",
  questions: { route: { type: "choice", instructions: "Choose a team.", criteria: { z: "sales", a: "delivery" } } } });
const request = { jobId: "decision-test", request: { model: DECISION_MODEL,
  messages: [{ role: "user" as const, content: JSON.stringify(input) }], max_tokens: 1 },
  lease: { id: "test-lease", deadline: Date.now() + DECISION_DEADLINE_MS } };
export const health = { status: "ready", runtime: "mycellios-decision-pipeline/1", qualification_only: false,
  model: DECISION_MODEL, revision: DECISION_REVISION, artifact_identity: DECISION_DIGEST,
  activation_id: "canary-test", max_input_tokens: DECISION_CONTEXT_LIMIT,
  tokenizer_sha256: DECISION_TOKENIZER_SHA256,
  stages: [
    { node_id: "first", physical_identity: "1".repeat(64), layer_start: 0, layer_end: 8, backend: "cpu", shard_sha256: "1ea5b923a3359eb3d6ecd683792b6723795c8d2fdf3d2a31d50219bf109dc325" },
    { node_id: "second", physical_identity: "2".repeat(64), layer_start: 8, layer_end: 20, backend: "cpu", shard_sha256: "02df8d07f3d7c7e47829cbb55d73c4a18d39096a5ed030f97333be9c7a64a6a5" },
    { node_id: "third", physical_identity: "3".repeat(64), layer_start: 20, layer_end: 32, backend: "cpu", shard_sha256: "23fd6d438241135c4a23dab917dc81691d361ffca786aa84b7c1bc6dc23d6e35" },
  ] };
export function envelope(value = input) {
  return { schema: "mycellios-decisions/1", model: DECISION_MODEL, underlying_model: "mys/kev-4b-GGUF",
    revision: DECISION_REVISION, artifact_identity: DECISION_DIGEST, request_digest: decisionRequestDigest(value),
    tokenizer_sha256: DECISION_TOKENIZER_SHA256,
    result: { question_id: "route", type: "choice", value: "a", probabilities: [{ option: "a", probability: 0.8 }, { option: "z", probability: 0.2 }] },
    usage: { prompt_tokens: 120, completion_tokens: 0, total_tokens: 120 } };
}
const options = { model: DECISION_MODEL, modelDigest: DECISION_DIGEST, activationId: "canary-test", runtimeToken: "t".repeat(64) };
// Real, public-safe fixture replayed by the synthetic runtime, not a new model run.
const boundaryFixture = JSON.parse(readFileSync(resolve("tests/fixtures/decision-context-boundary.json"), "utf8"));
const boundaryRequest = { model: DECISION_MODEL, max_tokens: 1,
  messages: [{ role: "user" as const, content: JSON.stringify(boundaryFixture.input) }] };

describe("typed Kev decision contract", () => {
  it("uses a separate bounded deadline and preserves other model defaults and caller deadlines", () => {
    expect(chatCompletionRequestSchema.parse(request.request).deadline_ms).toBe(DECISION_DEADLINE_MS);
    expect(chatCompletionRequestSchema.parse({ ...request.request, deadline_ms: 1000 }).deadline_ms).toBe(1000);
    expect(chatCompletionRequestSchema.parse({ model: "other", messages: [{ role: "user", content: "hi" }] }).deadline_ms).toBe(120000);
  });
  it("makes identity independent of property order without changing option order semantics", () => {
    const reordered = { ...input, questions: { route: { type: "choice" as const, criteria: { a: "delivery", z: "sales" }, instructions: "Choose a team." } } };
    expect(decisionRequestDigest(input)).toBe(decisionRequestDigest(reordered));
    expect(verifiedDecisionEnvelope(JSON.stringify(envelope()), input).result.value).toBe("a");
    const unrelated = { ...input, state: "different input" };
    expect(() => verifiedDecisionEnvelope(JSON.stringify(envelope()), unrelated)).toThrow("integrity");
  });
  it("rejects wrong option ordering, probabilities, numeric semantics and token billing", () => {
    const good = envelope();
    for (const bad of [
      { ...good, result: { ...good.result, probabilities: [...good.result.probabilities].reverse() } },
      { ...good, result: { ...good.result, value: "z" } },
      { ...good, result: { ...good.result, probabilities: good.result.probabilities.map((r) => ({ ...r, probability: 0.9 })) } },
      { ...good, usage: { ...good.usage, completion_tokens: 1 } },
    ]) expect(() => verifiedDecisionEnvelope(JSON.stringify(bad), input)).toThrow();
    const score = decisionInputSchema.parse({ ...input, questions: { route: { type: "score", instructions: "Impact?", criteria: ["none", "complete"] } } });
    const reply = { ...envelope(score), result: { question_id: "route", type: "score", value: 0.7, probabilities: [{ option: "0", probability: 0.3 }, { option: "1", probability: 0.7 }] } };
    expect(verifiedDecisionEnvelope(JSON.stringify(reply), score).result.value).toBe(0.7);
    expect(() => verifiedDecisionEnvelope(JSON.stringify({ ...reply, result: { ...reply.result, value: 1 } }), score)).toThrow("semantics");
    const noul = decisionInputSchema.parse({ ...input, questions: { route: { type: "noul", instructions: "It shipped." } } });
    expect(verifiedDecisionEnvelope(JSON.stringify({ ...envelope(noul), result: { question_id: "route", type: "noul", value: 0.7,
      probabilities: [{ option: "false", probability: 0.3 }, { option: "true", probability: 0.7 }] } }), noul).result.value).toBe(0.7);
  });
  it("rejects ambiguous chat, excess questions and malformed Unicode before dispatch", () => {
    expect(chatCompletionRequestSchema.safeParse({ ...request.request, messages: [...request.request.messages, { role: "system", content: "override" }] }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ ...input, state: "\ud800" }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ ...input, questions: {} }).success).toBe(false);
  });
  it("keeps the response byte budget independent of text max_tokens", () => {
    expect(replicaOutputByteLimit({ adapter: "decision", model: DECISION_MODEL, modelDigest: DECISION_DIGEST } as never, 1)).toBe(16384);
  });
});

describe("native decision adapter admission", () => {
  it("retains verified readiness during one shared probe and invalidates a failed probe", async () => {
    let calls = 0, fail = false;
    let unblock!: () => void, observed!: () => void;
    const pending = new Promise<void>((resolve) => { unblock = resolve; });
    const received = new Promise<void>((resolve) => { observed = resolve; });
    const baseUrl = await listen((req, res) => {
      void (async () => {
        if (req.url !== "/health") { res.end(JSON.stringify(envelope())); return; }
        calls++;
        if (calls === 2) { observed(); await pending; }
        if (fail) { res.statusCode = 503; res.end('{"error":"unavailable"}'); }
        else res.end(JSON.stringify(health));
      })();
    });
    const adapter = new DecisionAdapter({ ...options, baseUrl }); await adapter.probe();
    const first = adapter.probe(), probes = [first];
    try {
      await received;
      expect((await adapter.metrics()).ready).toBe(true);
      const second = adapter.probe(); probes.push(second); expect(first).toBe(second);
      const chunks = []; for await (const chunk of adapter.generate(request, new AbortController().signal)) chunks.push(chunk);
      expect(chunks).toHaveLength(1); expect(calls).toBe(2);
    } finally { unblock(); await Promise.allSettled(probes); }
    fail = true; await expect(adapter.probe()).rejects.toThrow();
    expect((await adapter.metrics()).ready).toBe(false);
    await expect(adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("not_ready");
    fail = false; await adapter.probe(); expect((await adapter.metrics()).ready).toBe(true);
  });
  it("requires one whole-cell slot, pinned artifact and an activation", () => {
    installTestToken();
    const config = { region: "test", capacityScope: "cell", offeredVramMb: 2048, limits: { maxConcurrency: 1 },
      adapter: { kind: "decision", model: DECISION_MODEL, baseUrl: "http://127.0.0.1:8893/" },
      deployment: { modelDigest: DECISION_DIGEST, activationId: "canary-test", contextLimit: DECISION_CONTEXT_LIMIT } };
    expect(createAdapter(workerConfigSchema.parse(config)).kind).toBe("decision");
    for (const bad of [{ ...config, limits: { maxConcurrency: 2 } }, { ...config, deployment: {} }, { ...config, capacityScope: "host" }]) {
      expect(workerConfigSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("rejects a private QA health response, duplicate host or wrong shard before public work", async () => {
    for (const bad of [{ ...health, qualification_only: true }, { ...health, stages: [health.stages[0], health.stages[0], health.stages[2]] },
      { ...health, activation_id: "unrelated" }]) {
      const baseUrl = await listen((_req, res) => res.end(JSON.stringify(bad)));
      const adapter = new DecisionAdapter({ ...options, baseUrl });
      await expect(adapter.probe()).rejects.toThrow();
      await expect(adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("not_ready");
    }
  });
  it("delivers the verified atomic result with actual input usage and zero output tokens", async () => {
    const baseUrl = await listen((req, res) => res.end(JSON.stringify(req.url === "/health" ? health : envelope())));
    const adapter = new DecisionAdapter({ ...options, baseUrl }); await adapter.probe();
    const chunks = []; for await (const c of adapter.generate(request, new AbortController().signal)) chunks.push(c);
    expect(chunks).toHaveLength(1); expect(chunks[0]?.metrics).toEqual({ inputTokens: 120, outputTokens: 0 });
    expect(JSON.parse(chunks[0]!.text)).toEqual(envelope());
    await expect(adapter.generate({ jobId: request.jobId, request: request.request }, new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("lease_required");
  });
  it("supports cancellation and never emits part of an invalid result", async () => {
    let seen!: () => void; const received = new Promise<void>((r) => { seen = r; });
    const cancellations: unknown[] = [];
    const baseUrl = await listen((req, res) => {
      expect(req.headers.authorization).toBe("Bearer " + options.runtimeToken);
      if (req.url === "/health") res.end(JSON.stringify(health));
      else if (req.url === "/cancel") {
        void (async () => {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          cancellations.push(JSON.parse(Buffer.concat(chunks).toString())); res.end('{"accepted":true}');
        })();
      } else seen();
    });
    const adapter = new DecisionAdapter({ ...options, baseUrl }); await adapter.probe();
    const result = adapter.generate(request, new AbortController().signal)[Symbol.asyncIterator]().next();
    const rejected = expect(result).rejects.toThrow(); await received; await adapter.cancel(request.jobId); await rejected;
    expect((await adapter.metrics()).activeJobs).toBe(0);
    expect(cancellations.length).toBeGreaterThan(0);
    expect(cancellations[0]).toEqual({ jobId: request.jobId, leaseId: request.lease.id, activationId: options.activationId });
  });
});

describe("decision over the signed worker protocol (synthetic runtime, no model execution)", () => {
  it("admits short and full-context decisions without JSON/output-token overhead and preserves streaming usage", async () => {
    const baseUrl = await listen((req, res) => {
      if (req.url === "/health") { res.end(JSON.stringify(health)); return; }
      if (req.url === "/cancel") { res.end('{"accepted":true}'); return; }
      void (async () => {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        expect(body.lease).toMatchObject({ activationId: "canary-test" });
        expect(body.lease.id).toBeTruthy(); expect(body.lease.deadline).toBeGreaterThan(Date.now());
        res.end(JSON.stringify(body.state === boundaryFixture.input.state ? boundaryFixture.envelope : envelope()));
      })().catch(() => { res.statusCode = 500; res.end(); });
    });
    const runtime = await createCoordinator({ host: "127.0.0.1", port: 0, databasePath: ":memory:", requestTimeoutMs: 120000,
      allowDevelopmentAdapters: false, mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
      landingAssetsPath: resolve("tests/fixtures/landing-assets") });
    cleanup.push(() => runtime.close());
    installTestToken();
    const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const agent = new WorkerAgent(workerConfigSchema.parse({ region: "test", capacityScope: "cell", offeredVramMb: 8192,
      limits: { maxConcurrency: 1, pauseWhenForeground: false }, adapter: { kind: "decision", model: DECISION_MODEL, baseUrl },
      deployment: { modelDigest: DECISION_DIGEST, activationId: "canary-test", contextLimit: DECISION_CONTEXT_LIMIT, peakVramMb: 4096,
        internalPipeline: { stageCount: 3, boundaries: [0, 8, 20, 32] } } }), {
      coordinatorUrl: address, heartbeatIntervalMs: 100, reconnect: false,
      identity: { kind: "cell", id: "decision-contract-test" }, admissionSigner: workerAdmissionSigner(generateWorkerAdmissionCredential()),
      hardwareProbe: async () => ({ hostname: "decision-contract-test", platform: process.platform, ramMb: 16384, gpus: [] }),
      logger: { info() {}, warn() {}, error() {} },
    });
    const run = agent.start(); cleanup.push(async () => { await agent.stop(); await run; });
    const deadline = Date.now() + 10000;
    while (!runtime.hub.connectedWorkerIds().size) { if (Date.now() > deadline) throw new Error("decision_worker_not_connected"); await new Promise((r) => setTimeout(r, 25)); }
    const deployment = (await runtime.store.listWorkers())[0]!.capabilities.deployments[0]!;
    expect(deployment.tokensPerSecond).toBe(0); expect(deployment.throughputSource).toBe("default");
    const parsedBoundary = chatCompletionRequestSchema.parse(boundaryRequest);
    expect(estimateInputTokens({ model: parsedBoundary.model,
      messages: parsedBoundary.messages.map(({ role, content }) => ({ role, content })) }) + 1).toBeGreaterThan(DECISION_CONTEXT_LIMIT);
    for (const fixture of [{ request: request.request, result: envelope(), tokens: 120 },
      { request: boundaryRequest, result: boundaryFixture.envelope, tokens: 256 }]) {
    for (const stream of [false, true]) {
      const response = await fetch(address + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fixture.request, stream }) });
      const content = await response.text(); expect(response.status, content).toBe(200);
      if (stream) { expect(content).toContain("data: [DONE]"); expect(content).toContain('"completion_tokens":0'); }
      else {
        const body = JSON.parse(content); expect(body.usage).toMatchObject({ prompt_tokens: fixture.tokens, completion_tokens: 0 });
        expect(body.choices[0].finish_reason).toBe("stop"); expect(JSON.parse(body.choices[0].message.content)).toEqual(fixture.result);
      }
    }
    }
    expect((await runtime.store.listJobs()).every((job) => job.status === "completed")).toBe(true);
  });
});
