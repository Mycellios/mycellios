import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { selectConfiguredModel } from "./model-roles.js";
import { pinnedModelCredentialError, validateBotModelChange, validateConnectedModelChoice } from "./model-selection.js";

describe("models on the Mico's own PC", () => {
  // A model served by Desktop has no connection: any database read is a bug.
  const untouched = new Proxy({}, { get: () => { throw new Error("A model on the PC must not read connections"); } }) as unknown as PrismaClient;
  const deps = { prisma: untouched, secretStore: { load: vi.fn() }, refreshExpiredCredential: vi.fn(), defaultModel: async () => ({ provider: null, model: null }) };
  const actor = { userId: "user-1", spaceId: "space-1" };

  it("accepts a device model without a connection and drops the effort", async () => {
    await expect(validateBotModelChange(deps as never, { ...actor, provider: "device", model: "qwen3.5-2b", thinkingLevel: "high" }))
      .resolves.toEqual({ ok: true, provider: "device", model: "qwen3.5-2b", thinkingLevel: null });
    await expect(validateConnectedModelChoice(untouched, { load: vi.fn() }, actor, "device", "qwen3.5-2b")).resolves.toBeUndefined();
    expect(pinnedModelCredentialError({ modelProvider: "device", modelId: "qwen3.5-2b", thinkingLevel: null }, null)).toBeUndefined();
  });

  it("refuses ids that are not a model name", async () => {
    await expect(validateBotModelChange(deps as never, { ...actor, provider: "device", model: "../../x", thinkingLevel: null }))
      .resolves.toMatchObject({ ok: false });
    await expect(validateConnectedModelChoice(untouched, { load: vi.fn() }, actor, "device", "a b")).resolves.toBe("Unknown model for that provider");
  });

  it("runs a device override without a connection", () => {
    expect(selectConfiguredModel({
      override: { modelProvider: "device", modelId: "qwen3.5-2b", thinkingLevel: null },
      overrideCredential: null, main: null, defaults: { settings: null, deployment: null },
    } as unknown as Parameters<typeof selectConfiguredModel>[0])).toMatchObject({ provider: "device", id: "qwen3.5-2b" });
  });
});
