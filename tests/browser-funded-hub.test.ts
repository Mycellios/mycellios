import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { describe, it, expect } from "vitest";
import { MobileComputeHub } from "../src/coordinator/mobile-compute-hub.js";
import { WorkerAdmissionAuthority } from "../src/coordinator/worker-admission.js";
import { MeshDatabase } from "../src/storage/database.js";
import { sha256CanonicalEvidence } from "../src/core/json.js";
import { generateWorkerAdmissionCredential, workerAdmissionSigner } from "../src/worker/admission-credential.js";

describe("paid browser inference independent verification", () => {
  it.each([false, true])("binds signed ownership and rejects a forged dynamic output: tampered=%s", async tampered => {
    const dir = mkdtempSync(join(tmpdir(), "browser-paid-hub-test-")), db = await MeshDatabase.open(":memory:");
    const app = Fastify(); await app.register(websocket);
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_r, b, cb) => cb(null, b));
    const hub = new MobileComputeHub({ expertArtifactsPath: dir, admissionAuthority: new WorkerAdmissionAuthority(db) }); hub.attach(app);
    const tensor = (n: number) => Buffer.from(new Float32Array([n]).buffer).toString("base64");
    const forward = (n: number) => n * 0.75 / (1 + Math.exp(-n * 0.75)) * n * 0.5 * 1.25;
    let socket: WebSocket | undefined;
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const weights = Buffer.from(new Float32Array([0.75, 0.5, 1.25]).buffer), hash = createHash("sha256").update(weights).digest("hex");
      await app.inject({ method: "PUT", url: "/internal/v1/mobile/experts/weights/" + hash,
        headers: { "content-type": "application/octet-stream" }, payload: weights });
      const registered = await app.inject({ method: "POST", url: "/internal/v1/mobile/experts/register", payload: {
        modelId: "test-only-expert", modelDigest: "sha256:test-only", layer: 0, expert: 0, contentId: "sha256:test-only",
        weightsHash: hash, hiddenSize: 1, intermediateSize: 1, dtype: "float32", activation: "silu",
        canaryInputBase64: tensor(0.5), canaryOutputBase64: tensor(forward(0.5)),
      } });
      const artifactId = registered.json().artifactId;
      const registration = { clientId: "signed-browser-hub-test", name: "Test browser", region: "auto", platform: "test",
        backend: "webgpu", performanceLevel: "balanced", capabilities: { webgpu: true, wasm: true, hardwareConcurrency: 4 },
        benchmark: { durationMs: 1, estimatedGflops: 1, matrixSize: 128 }, protocol: { min: 1, max: 1 } };
      const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
      const digest = sha256CanonicalEvidence({ schema: "mycellios-mobile-registration/1",
        identity: { kind: "browser", id: registration.clientId }, registration });
      const challenge = (await app.inject({ method: "POST", url: "/mobile/v1/admission-challenge", payload: {
        identity: { kind: "browser", id: registration.clientId }, publicKey: signer.publicKey,
        protocol: registration.protocol, registrationDigest: digest,
      } })).json();
      const credentialsResponse = await app.inject({ method: "POST", url: "/mobile/v1/register", payload: {
        ...registration, admission: { challengeId: challenge.challengeId, publicKey: signer.publicKey,
          protocol: registration.protocol, registrationDigest: digest, signature: signer.sign(challenge.signingPayload) },
      } });
      expect(credentialsResponse.statusCode).toBe(201);
      const credentials = credentialsResponse.json();
      socket = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/mobile/v1/connect?workerId=${credentials.workerId}&token=${credentials.token}`);
      const verified = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("validation timed out")), 5000);
        socket!.on("message", raw => {
          const { type, payload } = JSON.parse(raw.toString());
          const send = (type: string, payload: unknown) => socket!.send(JSON.stringify({ v: 1, type, payload }));
          if (type === "server.ready") send("work.request", {});
          if (type === "compute.offer") {
            send("compute.accept", { taskId: payload.taskId, leaseId: payload.leaseId });
            const size = payload.size, seed = payload.seed;
            const points = [[0,0],[Math.floor(size/2),Math.floor(size/3)],[size-1,size-1],[Math.floor(size/3),Math.max(0,size-2)]];
            const samples = points.map(([r,c]) => { let sum=0;for(let k=0;k<size;k++)sum+=((r!*3+k*5+seed)%31-15)/16*((k*7+c!*11+seed*3)%29-14)/16;return sum; });
            send("compute.result", { taskId: payload.taskId, leaseId: payload.leaseId, backend: "webgpu", durationMs: 1, estimatedGflops: 1, samples });
          }
          if (type === "compute.verified") { clearTimeout(timer); resolve(); }
          if (type === "expert.load") send("expert.ready", { taskId: payload.taskId, leaseId: payload.leaseId,
            artifactId, canaryOutputBase64: tensor(forward(0.5)), backend: "webgpu", durationMs: 1 });
          if (type === "expert.execute") send("expert.result", { taskId: payload.taskId, leaseId: payload.leaseId,
            artifactId, rows: 1, hiddenSize: 1, outputBase64: tensor(tampered ? 999 : forward(1.5)), backend: "webgpu", durationMs: 1 });
        });
      });
      await verified;
      expect(hub.contributorIdentity(credentials.workerId, "wrong-token")).toBeNull();
      expect(hub.contributorIdentity(credentials.workerId, credentials.token)).toMatchObject({ browserId: registration.clientId });
      const result = hub.executeFundedExpert(credentials.workerId, { artifactId, rows: 1, hiddenSize: 1, activationsBase64: tensor(1.5) });
      if (tampered) { await expect(result).rejects.toThrow("reference_mismatch"); expect(hub.availableContributors()).toEqual([]); }
      else expect(await result).toMatchObject({ outputBase64: tensor(forward(1.5)), evidenceDigest: expect.stringMatching(/^sha256:/) });
    } finally { socket?.terminate(); hub.close(); await app.close(); await db.close();
      if (dirname(dir) !== tmpdir() || !dir.startsWith(join(tmpdir(), "browser-paid-hub-test-"))) throw new Error("Unexpected test path");
      rmSync(dir, { recursive: true, force: true }); }
  });
});
