import { describe, expect, it } from "vitest";
import { defaultLocalEngine, signedInEngines } from "./native-agent-runtime.js";

describe("the engine a new This PC Mico starts with", () => {
  it("follows the owner's order among confirmed sign-ins", () => {
    expect(defaultLocalEngine(["codex", "claude"])).toBe("claude");
    expect(defaultLocalEngine(["codex"])).toBe("codex");
  });
  it("keeps Pi with no confirmed sign-in, or only OpenCode, which cannot report one", () => {
    expect(defaultLocalEngine([])).toBeUndefined();
    expect(defaultLocalEngine(undefined)).toBeUndefined();
    expect(defaultLocalEngine(["opencode"])).toBeUndefined();
  });
  it("counts only installed CLIs that answered signed in, never an unknown answer", () => {
    expect(signedInEngines([
      { id: "pi", name: "Pi", available: true },
      { id: "codex", name: "Codex", available: true },
      { id: "claude", name: "Claude Code", available: true, signedIn: true },
      { id: "acp", name: "ACP", available: false },
      { id: "opencode", name: "OpenCode", available: true, canInstall: false },
    ])).toEqual(["claude"]);
    expect(signedInEngines([
      { id: "pi", name: "Pi", available: true },
      { id: "codex", name: "Codex", available: false, signedIn: true },
      { id: "claude", name: "Claude Code", available: true, signedIn: false },
      { id: "acp", name: "ACP", available: false },
      { id: "opencode", name: "OpenCode", available: true, canInstall: false },
    ])).toEqual([]);
  });
});
