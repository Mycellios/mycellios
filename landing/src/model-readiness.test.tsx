import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RequestedModelCapacity } from "../../src/contracts/dashboard";
import { classifyActivationIncident } from "../../src/contracts/activation-incident";
import { ModelReadiness, modelReadiness } from "./model-readiness";

const model: RequestedModelCapacity = {
  id: "test-model", source: "test/model", revision: null, status: "waiting_capacity",
  autoActivate: true, adapterId: "native", compatible: true,
  requiredVramMiB: 8192, availableVramMiB: 6144, missingVramMiB: 2048,
  requiredNodes: 2, availableNodes: 1, missingNodes: 1, weightBytes: 1,
  contextTokens: 4096, message: "Recorded coordinator decision", activationIncident: null,
  activationProgress: [], activationRequestedAt: null,
  createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z",
};

describe("model readiness presentation", () => {
  it("shows both shortages without converting advertised capacity to readiness", () => {
    expect(modelReadiness(model).title).toBe("Needs 1 more compatible node and 2.0 GB more GPU memory");
    expect(modelReadiness({ ...model, missingNodes: 0, missingVramMiB: 0 }).title).toBe("Waiting for compatible capacity");
  });

  it("keeps the coordinator's bounded CPU activation authoritative despite a VRAM shortfall", () => {
    expect(modelReadiness({ ...model, status: "activating" }).title).toBe("Preparing the model");
    expect(modelReadiness({ ...model, status: "active" }).title).toBe("Available for inference");
    expect(modelReadiness({ ...model, status: "ready", autoActivate: false }).nextStep).toContain("Automatic activation is off");
  });

  it("reuses the classified recovery remedy and does not promise retries after exhaustion", () => {
    const incident = classifyActivationIncident({ message: "automatic_activation_retries_exhausted:5:distributed_activation_requires_two_connected_shard_executors" });
    expect(modelReadiness({ ...model, status: "failed", activationIncident: incident })).toEqual({ title: incident.title, nextStep: incident.remedy });
    expect(modelReadiness({ ...model, status: "active", activationIncident: incident }).title).toBe("Available for inference");
  });

  it("leaves controls in the existing disclosure without exposing raw errors", () => {
    const html = renderToStaticMarkup(<ModelReadiness model={{ ...model, status: "failed", message: "private_runtime_path" }} />);
    expect(html).toContain("Model preparation needs attention");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("private_runtime_path");
  });
});
