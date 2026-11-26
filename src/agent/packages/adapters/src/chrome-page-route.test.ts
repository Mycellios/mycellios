import { describe, expect, it } from "vitest";
import { chromePageRoute } from "./chrome-page-route.js";

const mycellios = "https://www.mycellios.com/v1";

describe("chromePageRoute", () => {
  it("trusts the person's own providers and sign-ins", () => {
    expect(chromePageRoute({ agentEngine: "codex" })).toBe("own");
    expect(chromePageRoute({ agentEngine: "claude" })).toBe("own");
    expect(chromePageRoute({ agentEngine: "pi", provider: "anthropic", modelId: "claude", ownCredential: true })).toBe("own");
    expect(chromePageRoute({ agentEngine: "pi", provider: "openai-compatible", modelId: "m", ownCredential: true, baseUrl: "https://llm.example/v1" })).toBe("own");
  });

  it("trusts contracted managed routes and the deployment's operator key", () => {
    expect(chromePageRoute({ agentEngine: "pi", provider: "openai-compatible", modelId: "mycellios/managed/openai/gpt-5", ownCredential: true, baseUrl: mycellios })).toBe("managed");
    expect(chromePageRoute({ agentEngine: "pi", provider: "openrouter", modelId: "x", deploymentProvider: "openrouter" })).toBe("managed");
  });

  it("refuses unidentified sellers and the contributor network", () => {
    expect(chromePageRoute({ agentEngine: "pi", provider: "openai-compatible", modelId: "mycellios/managed/free", ownCredential: true, baseUrl: mycellios })).toBe("third_party");
    expect(chromePageRoute({ agentEngine: "pi", provider: "openai-compatible", modelId: "mycellios/managed/antseed/deepseek", ownCredential: true, baseUrl: mycellios })).toBe("third_party");
    expect(chromePageRoute({ agentEngine: "pi", provider: "openai-compatible", modelId: "qwen3-8b", ownCredential: true, baseUrl: mycellios })).toBe("third_party");
    expect(chromePageRoute({ agentEngine: "pi", provider: "antseed", modelId: "any", ownCredential: true })).toBe("third_party");
    expect(chromePageRoute({ agentEngine: "opencode" })).toBe("third_party");
    expect(chromePageRoute({ agentEngine: "pi", provider: "openrouter", modelId: "x", deploymentProvider: "anthropic" })).toBe("third_party");
  });
});
