import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCoordinator } from "../src/coordinator/server.js";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, verifiedSpeechEnvelope } from "../src/contracts/speech.js";
import { WorkerAgent } from "../src/worker/agent.js";
import { generateWorkerAdmissionCredential, workerAdmissionSigner } from "../src/worker/admission-credential.js";

const sdkRoot = resolve(process.env.ANTSEED_PROOF_MODULES ?? "runtime/antseed-proof/node_modules");
const { AntseedNode } = await import(pathToFileURL(resolve(sdkRoot, "@antseed/node/dist/index.js")).href);
const { default: plugin } = await import(pathToFileURL(resolve(sdkRoot, "@antseed/provider-openai/dist/index.js")).href);
const output = resolve("runtime/kokoro-proof-" + Date.now());
await mkdir(output, { recursive: true, mode: 0o700 });
const runtime = await createCoordinator({
  host: "127.0.0.1", port: 0, databasePath: ":memory:", requestTimeoutMs: 120_000,
  allowDevelopmentAdapters: false,
  mobileAssetsPath: resolve("tests/fixtures/mobile-assets"), landingAssetsPath: resolve("tests/fixtures/landing-assets"),
});
const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
const agent = new WorkerAgent(workerConfigSchema.parse({
  region: "local-proof", offeredVramMb: 2048, limits: { maxConcurrency: 1, pauseWhenForeground: false },
  adapter: { kind: "kokoro", model: KOKORO_MODEL, baseUrl: process.env.MYCELLIOS_KOKORO_REAL_URL ?? "http://127.0.0.1:8890/" },
  deployment: { modelDigest: KOKORO_WEIGHT_DIGEST, peakVramMb: 1536, contextLimit: 8192 },
}), {
  coordinatorUrl: address, heartbeatIntervalMs: 100, reconnect: false,
  identity: { kind: "device", id: "kokoro-isolated-proof" },
  admissionSigner: workerAdmissionSigner(generateWorkerAdmissionCredential()),
  logger: { info() {}, warn() {}, error() {} },
});
const run = agent.start();
const deadline = Date.now() + 15_000;
while (runtime.hub.connectedWorkerIds().size !== 1) {
  if (Date.now() > deadline) throw new Error("speech_worker_not_ready");
  await new Promise((r) => setTimeout(r, 50));
}
const provider = await plugin.createProvider({
  OPENAI_BASE_URL: address, OPENAI_API_KEY: "isolated-proof-no-live-credential",
  ANTSEED_ALLOWED_SERVICES: KOKORO_MODEL,
  ANTSEED_INPUT_USD_PER_MILLION: "0", ANTSEED_OUTPUT_USD_PER_MILLION: "0",
  ANTSEED_MAX_CONCURRENCY: "1",
  ANTSEED_SERVICE_CAPABILITIES_JSON: JSON.stringify({ [KOKORO_MODEL]: { inputs: ["text"], outputs: ["text", "audio"] } }),
});
const isolated = {
  bootstrapNodes: [], noOfficialBootstrap: true, allowPrivateIPs: true,
  dhtOperationTimeoutMs: 500, dhtPort: 0, signalingPort: 0, requireSecureTransport: true,
  requestTimeoutMs: 120_000, payments: { enabled: false },
  acceptInboundAddress: (ip: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip),
};
const seller = new AntseedNode({ ...isolated, role: "seller", dataDir: resolve(output, "seller") });
const buyer = new AntseedNode({ ...isolated, role: "buyer", dataDir: resolve(output, "buyer") });
seller.registerProvider(provider);
try {
  await seller.start();
  await buyer.start();
  const peer = {
    peerId: seller.peerId, publicAddress: "127.0.0.1:" + seller.signalingPort,
    lastSeen: Date.now(), providers: ["openai"],
    providerPricing: { openai: { defaults: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } } },
    providerServiceApiProtocols: { openai: { services: { [KOKORO_MODEL]: ["openai-chat-completions"] } } },
  };
  const text = "Hola Daniel. Esta voz viaja por AntSeed y la genera Mycellios.";
  const started = performance.now();
  const result = await buyer.sendRequest(peer, {
    requestId: randomUUID(), method: "POST", path: "/v1/chat/completions",
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({
      model: KOKORO_MODEL, messages: [{ role: "user", content: text }], stream: false, max_tokens: 1,
    })),
  });
  assert.equal(result.statusCode, 200, new TextDecoder().decode(result.body).slice(0, 1000));
  const response = JSON.parse(new TextDecoder().decode(result.body));
  const speech = verifiedSpeechEnvelope(response.choices[0].message.content, text);
  assert(response.usage.prompt_tokens > 0);
  assert.equal(response.usage.completion_tokens, 0);
  await writeFile(resolve(output, "response.json"), JSON.stringify(response));
  await writeFile(resolve(output, "sample.wav"), Buffer.from(speech.audio.data, "base64"));
  const receipt = {
    scope: "single-host-real-kokoro-antseed-secure-p2p", model: KOKORO_MODEL,
    at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
    audioSeconds: speech.audio.duration_seconds, audioSha256: speech.audio.sha256,
    usage: response.usage, transportState: buyer.getPeerConnectionState(seller.peerId),
    sellerSessions: seller.getActiveSellerSessions().map((s: Record<string, unknown>) => ({
      totalTokens: s.totalTokens, totalRequests: s.totalRequests,
    })),
    paymentsEnabled: false, publicDiscovery: false, paidSettlementVerified: false,
  };
  assert(receipt.sellerSessions.some((s: { totalTokens: number; totalRequests: number }) => s.totalTokens === response.usage.total_tokens && s.totalRequests === 1));
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ output, ...receipt }));
} finally {
  await buyer.stop(); await seller.stop(); await agent.stop(); await run; await runtime.close();
}
