import { describe, expect, it } from "vitest";
import { agentEngineForProviderSelection } from "./agent-provider-selection.js";

describe("provider selection owns the Mico executor", () => {
  it.each(["opencode-go", "openrouter", "openai-codex", "openai-compatible"])(
    "uses the saved connection for %s instead of retaining an unrelated CLI",
    modelProvider => expect(agentEngineForProviderSelection({ modelProvider, modelId: "model" })).toBe("pi"),
  );
  it("uses the general connection when an override is cleared", () => {
    expect(agentEngineForProviderSelection({ modelProvider: null, modelId: null })).toBe("pi");
  });
  it.each(["codex", "claude", "opencode", "acp"] as const)("preserves an explicit installed %s provider", agentEngine => {
    expect(agentEngineForProviderSelection({ agentEngine, modelProvider: null, modelId: null })).toBe(agentEngine);
  });
  it("does not alter execution for an unrelated profile update", () => {
    expect(agentEngineForProviderSelection({})).toBeUndefined();
  });
});
