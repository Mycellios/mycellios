import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import type { CoordinatorRuntime } from "../src/coordinator/server.js";
import { createCoordinator } from "../src/coordinator/server.js";
import { WorkerAgent } from "../src/worker/agent.js";
import {
  generateWorkerAdmissionCredential,
  workerAdmissionSigner,
} from "../src/worker/admission-credential.js";
import { verifyExecutionReceipt } from "../src/contracts/execution-receipt.js";
import { MockAdapter } from "../src/adapters/mock.js";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { readNativeRuntimeBuildMetadata } from "../src/core/native-build-identity.js";
import { NativeReleaseAdmission } from "../src/coordinator/release-admission.js";
import { createCoordinatorPostgresFixture } from "./fixtures/coordinator-postgres-schema.js";

describe("inference-only coordinator and worker", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const operation of cleanup.splice(0).reverse()) await operation();
  });

  it("executes an OpenAI-compatible chat end to end", async () => {
    const { runtime, address, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });

    const response = await fetch(new URL("v1/chat/completions", `${address}/`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "e2e-request-1",
      },
      body: JSON.stringify({
        model: "distributed-small",
        messages: [{ role: "user", content: "prueba completa" }],
        max_tokens: 80,
        session_id: "session-e2e",
      }),
    });
    const body = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      x_network: {
        ttft_ms: number;
        active_ms: number;
        execution_trace: {
          schema: string;
          jobId: string;
          stages: unknown[];
          physicalBoundaryCount: number | null;
        };
        recovery_mode: string;
        recovery_attempts: number;
        replayed_token_events: number;
        execution_receipt_id: string;
      };
    };
    expect(response.status).toBe(200);
    expect(body.choices[0]?.message.content).toContain("prueba completa");
    // The worker announced a per-connection key, so the request travelled sealed.
    const [workerId] = [...runtime.hub.connectedWorkerIds()];
    expect(runtime.hub.workerSealingKey(workerId!)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.completion_tokens).toBeGreaterThan(0);
    expect(body.x_network.active_ms).toBeGreaterThan(0);
    expect(body.x_network).toMatchObject({ recovery_mode: "none", recovery_attempts: 1, replayed_token_events: 0 });
    expect(body.x_network.execution_receipt_id).toMatch(/^sha256:[a-f0-9]{64}$/);
    const [receiptResponse, receiptKeyResponse] = await Promise.all([
      fetch(new URL(`v1/requests/${encodeURIComponent(body.id)}/receipt`, `${address}/`)),
      fetch(new URL("v1/execution-receipt-key", `${address}/`)),
    ]);
    expect(receiptResponse.status).toBe(200);
    expect(receiptKeyResponse.status).toBe(200);
    const receipt = await receiptResponse.json();
    const receiptKey = await receiptKeyResponse.json() as { keyId: string; spki: string };
    expect(verifyExecutionReceipt(receipt, receiptKey)).toMatchObject({
      receiptId: body.x_network.execution_receipt_id,
      jobId: body.id,
      recovery: { mode: "none", attempts: 1, replayedTokenEvents: 0 },
    });
    expect(body.x_network.execution_trace).toMatchObject({
      schema: "mycellios-network-execution-trace/1",
      jobId: body.id,
      stages: [],
      physicalBoundaryCount: null,
    });
    expect((await runtime.store.listJobs())).toHaveLength(1);
    expect((await runtime.store.listJobs())[0]?.status).toBe("completed");
    await waitUntil(
      async () => (await runtime.store.listWorkers())[0]?.capabilities.deployments[0]?.throughputSource === "measured",
      2_000,
    );
    expect((await runtime.store.listWorkers())[0]?.capabilities.deployments[0]).toMatchObject({
      throughputSource: "measured",
    });
    expect(
      (await runtime.store.listWorkers())[0]?.capabilities.deployments[0]?.tokensPerSecond,
    ).toBeGreaterThan(0);

    const replay = await fetch(new URL("v1/chat/completions", `${address}/`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "e2e-request-1",
      },
      body: JSON.stringify({
        model: "distributed-small",
        messages: [{ role: "user", content: "prueba completa" }],
        max_tokens: 80,
        session_id: "session-e2e",
      }),
    });
    expect(replay.status).toBe(409);
    expect((await runtime.store.listJobs())).toHaveLength(1);
  });

  it("serves a public request whatever privacy pin it carries (specs/node-owner-privacy D7)", async () => {
    const { runtime, address, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });
    const response = await fetch(new URL("v1/chat/completions", `${address}/`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "distributed-small",
        messages: [{ role: "user", content: "pinned elsewhere" }],
        max_tokens: 80,
        privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: ["a-node-that-does-not-exist"] },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { x_network: { boundary_policy: string; pinned_identity_count: number } };
    expect(body.x_network).toMatchObject({ boundary_policy: "trusted-edges", pinned_identity_count: 0 });
  });

  it("returns OpenAI SSE chunks and a DONE marker", async () => {
    const { runtime, address, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });
    const response = await fetch(new URL("v1/chat/completions", `${address}/`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "distributed-small",
        messages: [{ role: "user", content: "stream" }],
        stream: true,
        max_tokens: 40,
      }),
    });
    const stream = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream).toContain("chat.completion.chunk");
    expect(stream).toContain('"token_index":0');
    expect(stream).toContain('"execution_trace":{"schema":"mycellios-network-execution-trace/1"');
    expect(stream).toContain("data: [DONE]");
  });

  const postgresUrl = process.env.MYCELLIOS_RELEASE_TEST_POSTGRES_URL;
  const storageCases = postgresUrl ? ["SQLite", "PostgreSQL"] : ["SQLite"];
  it.each(storageCases)("keeps the incumbent worker and deadline during handoff (%s)", async (storage) => {
    const generate = MockAdapter.prototype.generate;
    const incumbentPause = Promise.withResolvers<void>();
    const candidatePause = Promise.withResolvers<void>();
    const started = new Set<string>();
    const mock = vi.spyOn(MockAdapter.prototype, "generate").mockImplementation(async function* (
      this: MockAdapter, request, signal,
    ) {
      const content = request.request.messages.at(-1)?.content;
      if (content === "incumbent inference" || (content === "candidate inference" && storage === "PostgreSQL")) {
        started.add(content);
        await (content === "incumbent inference" ? incumbentPause.promise : candidatePause.promise);
      }
      yield* generate.call(this, request, signal);
    });
    const originalRevision = "a".repeat(40);
    const candidateRevision = "b".repeat(40);
    const schema = `handoff_${randomBytes(8).toString("hex")}`;
    const sql = storage === "PostgreSQL" ? postgres(postgresUrl!, { onnotice: () => {} }) : null;
    const gate = sql ? new NativeReleaseAdmission(sql, schema) : null;
    if (sql) cleanup.push(async () => {
      try { await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await sql.end(); }
    });
    const start = async (revision: string) => {
      const network = await startNetwork({
        workerIdentity: `handoff-cell-${revision[0]}`,
        ...(sql ? { handoffDatabase: { url: postgresUrl!, schema, revision } } : {}),
      });
      cleanup.push(async () => {
        await network.agent.stop();
        await network.run;
        await network.runtime.close();
      });
      return network;
    };
    const submit = (address: string, content: string) => fetch(new URL("/v1/chat/completions", address), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "distributed-small", messages: [{ role: "user", content }],
        stream: true, max_tokens: 40, deadline_ms: 20_000,
      }),
      signal: AbortSignal.timeout(22_000),
    });
    try {
      if (sql) {
        await createCoordinatorPostgresFixture(sql, schema);
        await gate!.close(originalRevision);
      }
      const incumbent = await start(originalRevision);
      const oldResponse = submit(incumbent.address, "incumbent inference");
      void oldResponse.catch(() => {});
      await waitUntil(() => started.has("incumbent inference"), 5_000);
      const [original] = await incumbent.runtime.store.listJobs();
      expect(original?.deadlineAt).toBeGreaterThan(Date.now());
      expect(incumbent.runtime.service.releaseWorkStatus().jobs).toBe(1);
      const candidate = await start(candidateRevision);
      if (gate) {
        expect((await candidate.runtime.store.getJob(original!.id))?.status).toBe(original?.status);
        await gate.transfer(originalRevision, candidateRevision);
        expect(await gate.currentRevision()).toBe(candidateRevision);
      }
      const nextRequest = submit(candidate.address, "candidate inference");
      void nextRequest.catch(() => {});
      if (gate) {
        await waitUntil(() => started.has("candidate inference"), 5_000);
        const [newJob] = await candidate.runtime.store.listJobs();
        expect(newJob?.id).not.toBe(original?.id);
        expect(candidate.runtime.service.releaseWorkStatus().jobs).toBe(1);
        await gate.transfer(candidateRevision, originalRevision);
        expect(await gate.currentRevision()).toBe(originalRevision);
        const restored = await submit(incumbent.address, "inference after rollback");
        expect(restored.status).toBe(200);
        expect(await restored.text()).toContain("data: [DONE]");
        candidatePause.resolve();
        expect(await (await nextRequest).text()).toContain("data: [DONE]");
        expect(await candidate.runtime.store.getJob(newJob!.id)).toMatchObject({
          deadlineAt: newJob?.deadlineAt, status: "completed",
        });
      } else {
        const nextResponse = await nextRequest;
        expect(nextResponse.status).toBe(200);
        expect(await nextResponse.text()).toContain("data: [DONE]");
        expect((await candidate.runtime.store.listJobs())[0]?.status).toBe("completed");
      }
      expect(incumbent.runtime.service.releaseWorkStatus().jobs).toBe(1);
      incumbentPause.resolve();
      const oldResult = await oldResponse;
      expect(oldResult.status).toBe(200);
      expect(await oldResult.text()).toContain("data: [DONE]");
      expect(await incumbent.runtime.store.getJob(original!.id)).toMatchObject({
        id: original?.id, deadlineAt: original?.deadlineAt, status: "completed",
      });
    } finally {
      incumbentPause.resolve();
      candidatePause.resolve();
      mock.mockRestore();
    }
  }, 30_000);

  it("removes a worker from the visible inventory after a voluntary stop", async () => {
    const { runtime, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });
    expect((await runtime.store.listWorkers())).toHaveLength(1);

    await agent.stop();
    await run;
    await waitUntil(async () => (await runtime.store.listWorkers()).length === 0, 2_000);

    expect((await runtime.store.listWorkers())).toHaveLength(0);
    expect(runtime.hub.connectedWorkerIds().size).toBe(0);
    const retained = (await runtime.database.raw
      .prepare("SELECT status, deregistered FROM workers")
      .get()) as { status: string; deregistered: number };
    expect(retained).toEqual({ status: "offline", deregistered: 1 });
  });

  it("protects network and worker routes when a network token is configured", async () => {
    const networkToken = "test-network-token";
    const { runtime, address, agent, run } = await startNetwork({ networkToken });
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });

    expect((await fetch(new URL("health", `${address}/`))).status).toBe(200);
    expect((await fetch(new URL("public/v1/snapshot", `${address}/`))).status).toBe(200);
    expect((await fetch(new URL("network", `${address}/`))).status).toBe(200);
    expect((await fetch(new URL("v1/models", `${address}/`))).status).toBe(401);
    expect(
      (
        await fetch(new URL("v1/models", `${address}/`), {
          headers: { authorization: `Bearer ${networkToken}` },
        })
    ).status,
    ).toBe(200);
  });

  it("serves the downloads page with a trailing slash", async () => {
    const { runtime, address, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });

    const response = await fetch(new URL("downloads/", `${address}/`));
    expect(response.status).toBe(200);
    expect(response.url).toBe(`${address}/downloads`);
    expect(await response.text()).toContain("mycellios test network");
  });

  it("serves public landing routes and repairs navigation aliases", async () => {
    const { runtime, address, agent, run } = await startNetwork();
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });

    const response = await fetch(new URL("earn", `${address}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("mycellios test landing");

    for (const path of ["spore", "spore/treasury", "spore/data"]) {
      const response = await fetch(new URL(path, `${address}/`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("mycellios test landing");
    }
    const dashboard = await fetch(new URL("dashboard", `${address}/`));
    expect(dashboard.status).toBe(200);
    const html = await dashboard.text();
    expect(html).toContain("mycellios test dashboard");
    expect(html).toContain('content="noindex, nofollow"');
    // Account management moved to Mycellios Agent; the old page only redirects there.
    const account = await fetch(new URL("account", `${address}/`), { redirect: "manual" });
    expect(account.status).toBe(302);
    expect(account.headers.get("location")).toBe("https://www.mycellios.com/agent/app?settings=api-plan");
    for (const [path, destination] of [
      ["dashboard/", "/dashboard"],
      ["account/", "/account"],
      ["spore/", "/spore"],
      ["join", "/earn"],
      ["join/", "/earn"],
      ["downloads/linux-deb", "/downloads/linux"],
      ["docs", "https://github.com/Mycellios/mycellios/blob/main/docs/README.md"],
      ["docs/", "https://github.com/Mycellios/mycellios/blob/main/docs/README.md"],
      ["docs/protocol", "https://github.com/Mycellios/mycellios/blob/main/docs/ARCHITECTURE.md"],
      ["docs/protocol/", "https://github.com/Mycellios/mycellios/blob/main/docs/ARCHITECTURE.md"],
      ["docs/downloads", "/downloads"],
      ["docs/network", "/network"],
      ["docs/blog", "/blog"],
    ] as const) {
      const response = await fetch(new URL(path, `${address}/`), { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(destination);
    }
    for (const [path, destination] of [["create", "/"], ["spore/treasury/", "/spore/rewards"], ["spore/data/", "/stats"]] as const) {
      const response = await fetch(new URL(path, `${address}/`), { redirect: "manual" });
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(destination);
    }
  });

  it("reports published downloads and serves archive files when available", async () => {
    const downloadsRoot = mkdtempSync(join(tmpdir(), "mycellios-downloads-"));
    const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
    const archiveName = `mycellios-node-${version}-windows-x64.msi`;
    writeFileSync(join(downloadsRoot, archiveName), "fixture archive");
    const { runtime, address, agent, run } = await startNetwork({ releaseDownloadsPath: downloadsRoot });
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
      rmSync(downloadsRoot, { recursive: true, force: true });
    });

    const response = await fetch(new URL("public/v1/downloads", `${address}/`));
    expect(response.status).toBe(200);
    const availability = await response.json();
    expect(availability).toMatchObject({
      schema: "mycellios-public-downloads/1",
      packages: [
        { id: "windows-x64", format: "MSI", path: "/downloads/windows", available: true, fileName: archiveName },
        { id: "macos-arm64", format: "PKG", path: "/downloads/macos-arm64" },
        { id: "linux-x64", format: "DEB", path: "/downloads/linux" },
      ],
    });

    const downloadRedirect = await fetch(new URL("downloads/windows", `${address}/`), { redirect: "manual" });
    expect(downloadRedirect.status).toBe(302);
    expect(downloadRedirect.headers.get("location")).toBe(`/downloads/${archiveName}?v=${availability.version}`);
    const download = await fetch(new URL(downloadRedirect.headers.get("location")!, `${address}/`));
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("fixture archive");

    const missing = await fetch(new URL("downloads/macos-arm64", `${address}/`), { redirect: "manual" });
    expect(missing.status).toBe(302);
    expect(missing.headers.get("location")).toBe("/downloads?availability=unavailable&platform=macos-arm64");
    const unsupported = await fetch(new URL("downloads/linux-rpm", `${address}/`), { redirect: "manual" });
    expect(unsupported.status).toBe(302);
    expect(unsupported.headers.get("location")).toBe("/downloads?availability=unsupported&platform=linux-rpm");
  });

  it("connects a signed public cell worker without exposing the global network token", async () => {
    const { runtime, agent, run } = await startNetwork({
      networkToken: "server-only-network-token",
      signedPublic: true,
    });
    cleanup.push(async () => {
      await agent.stop();
      await run;
      await runtime.close();
    });

    expect(runtime.hub.connectedWorkerIds().size).toBe(1);
    expect((await runtime.database.listWorkerAdmissionCredentials())).toHaveLength(1);
  });
});

async function startNetwork(options: {
  networkToken?: string;
  signedPublic?: boolean;
  releaseDownloadsPath?: string;
  workerIdentity?: string;
  handoffDatabase?: { url: string; schema: string; revision: string };
} = {}): Promise<{
  runtime: CoordinatorRuntime;
  address: string;
  agent: WorkerAgent;
  run: Promise<void>;
}> {
  const handoff = options.handoffDatabase;
  const runtime = await createCoordinator({
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    requestTimeoutMs: handoff ? 20_000 : 10_000,
    allowDevelopmentAdapters: true,
    mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
    landingAssetsPath: resolve("tests/fixtures/landing-assets"),
    ...(options.releaseDownloadsPath ? { releaseDownloadsPath: options.releaseDownloadsPath } : {}),
    ...(options.networkToken
      ? { networkToken: options.networkToken, mobileJoinToken: options.networkToken }
      : {}),
    ...(handoff ? { storageBackend: "postgres", databaseUrl: handoff.url, databaseSchema: handoff.schema } : {}),
  }, handoff ? {
    releaseAdmissionRevision: handoff.revision,
    runtimeMetadata: { ...readNativeRuntimeBuildMetadata(resolve(".")), revision: handoff.revision },
  } : {});
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const agent = new WorkerAgent(
    workerConfigSchema.parse({
      region: "es-mad",
      offeredVramMb: 4_096,
      limits: { maxConcurrency: 2, pauseWhenForeground: true },
      adapter: {
        kind: "mock",
        developmentOnly: true,
        model: "distributed-small",
        tokensPerSecond: 500,
        ttftMs: 1,
        failureRate: 0,
      },
      deployment: {
        modelDigest: "sha256:distributed-small-test",
        peakVramMb: 3_000,
        contextLimit: 8_192,
        tokensPerSecond: 500,
        ttftMs: 1,
      },
    }),
    {
      coordinatorUrl: address,
      heartbeatIntervalMs: 100,
      reconnect: false,
      hardwareProbe: async () => ({
        hostname: "e2e-worker",
        platform: process.platform,
        ramMb: 16_384,
        gpus: [{
          id: "gpu-0",
          vendor: "test",
          model: "Deterministic test accelerator",
          physicalVramMb: 8_192,
        }],
      }),
      logger: { info() {}, warn() {}, error() {} },
      ...(options.networkToken && !options.signedPublic
        ? { networkToken: options.networkToken }
        : {}),
      // Every execution fixture uses the same signed cell identity required
      // for sensitive input/output boundaries; loopback is not a trust root.
      identity: { kind: "cell" as const, id: options.workerIdentity ?? "signed-e2e-worker" },
      admissionSigner: workerAdmissionSigner(generateWorkerAdmissionCredential()),
    },
  );
  const run = agent.start();
  await waitUntil(() => runtime.hub.connectedWorkerIds().size === 1, 5_000);
  return { runtime, address, agent, run };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test worker");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
