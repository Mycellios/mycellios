import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_RUNTIME_ACTIVATION_PLAN_SCHEMA } from "../src/contracts/engine-runtime-activation.js";
import { MeshStore } from "../src/storage/store.js";
import { MeshDatabase } from "../src/storage/database.js";

const databases: MeshDatabase[] = [];
const digest = (value: string) => `sha256:${value.repeat(64)}` as const;

function plan(workerId = "worker-1", activationId = "activation-1") {
  return {
    schema: ENGINE_RUNTIME_ACTIVATION_PLAN_SCHEMA,
    modelId: "qwen-test",
    activationId,
    routeReservationId: "reservation-1",
    workerId,
    createdAt: "2026-08-10T12:00:00.000Z",
    evidence: { routeManifestDigest: digest("d"), canaryEvidenceId: digest("e") },
    request: {
      probeKind: "qwen3-dense-v1" as const,
      descriptorDigest: digest("a"), certificationId: digest("b"),
      artifactManifestDigest: digest("c"), modelId: "qwen-test",
      modelRevision: "1".repeat(40), backend: "cuda" as const,
      runtimeAbi: "cuda-12", quantization: "bf16", contextTokens: 8_192,
      expectedLayerStart: 0, expectedLayerEnd: 16,
      expectedKvBytesPerToken: 32_768, expectedLayerWeightBytes: 1_024,
      referenceDecodeMsPerToken: 8, referencePrefillMsPerToken: 0.4,
      hiddenSize: 4_096, attentionHeads: 32, kvHeads: 4, headDim: 128,
      requiredRoles: ["head", "tail"] as ("head" | "tail")[], minimumSamples: 7,
    },
  };
}

afterEach(async () => {
  for (const database of databases.splice(0)) (await database.close());
});

async function openStore(): Promise<MeshStore> {
  const database = (await MeshDatabase.open(":memory:"));
  databases.push(database);
  return new MeshStore(database);
}

describe("durable engine runtime activation plans", () => {
  it("atomically replaces one model generation and restores strict plans", async () => {
    const store = (await openStore());
    (await store.replaceEngineRuntimeActivationPlans("qwen-test", "activation-1", [
      plan("worker-1"), plan("worker-2"),
    ]));
    expect((await store.listEngineRuntimeActivationPlans()).map((value) => value.workerId))
      .toEqual(["worker-1", "worker-2"]);

    (await store.replaceEngineRuntimeActivationPlans("qwen-test", "activation-2", [
      plan("worker-2", "activation-2"),
    ]));
    expect((await store.listEngineRuntimeActivationPlans())).toEqual([
      expect.objectContaining({ activationId: "activation-2", workerId: "worker-2" }),
    ]);
  });

  it("rejects cross-model, cross-generation, duplicate, and unknown-field plans", async () => {
    const store = (await openStore());
    await expect((async () => (await store.replaceEngineRuntimeActivationPlans("other", "activation-1", [plan()])))()).rejects
      .toThrow("engine_runtime_activation_plan_set_is_invalid");
    await expect((async () => (await store.replaceEngineRuntimeActivationPlans("qwen-test", "other", [plan()])))()).rejects
      .toThrow("engine_runtime_activation_plan_set_is_invalid");
    await expect((async () => (await store.replaceEngineRuntimeActivationPlans("qwen-test", "activation-1", [plan(), plan()])))()).rejects
      .toThrow("engine_runtime_activation_plan_set_is_invalid");
    await expect((async () => (await store.replaceEngineRuntimeActivationPlans("qwen-test", "activation-1", [
      { ...plan(), workerClaim: true },
    ])))()).rejects.toThrow();
  });

  it("removes retired activation authority", async () => {
    const store = (await openStore());
    (await store.replaceEngineRuntimeActivationPlans("qwen-test", "activation-1", [plan()]));
    expect((await store.removeEngineRuntimeActivationPlans("qwen-test"))).toBe(1);
    expect((await store.listEngineRuntimeActivationPlans())).toEqual([]);
  });
});
