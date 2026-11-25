import { describe, expect, it } from "vitest";
import { claudeTurnArgs, codexTurnSettings, nativeClaudeModels, nativeCodexModels } from "./native-codex-settings.js";
const models = nativeCodexModels({ data: [
 { id: "model-fast", displayName: "Fast capable", isDefault: true, serviceTiers: [{ id: "priority" }], supportedReasoningEfforts: [{ reasoningEffort: "medium" }] },
 { id: "model-standard", displayName: "Standard", supportedReasoningEfforts: [] },
] });
describe("Codex speed and effort are separate real protocol settings", () => {
 it("sends priority while retaining the selected effort and model", () => expect(codexTurnSettings({ modelId: "model-fast", thinkingLevel: "medium", fastMode: true }, models)).toEqual({ model: "model-fast", effort: "medium", serviceTier: "priority" }));
 it("turns Fast off explicitly instead of inheriting an earlier priority thread", () => expect(codexTurnSettings({ fastMode: false }, models)).toEqual({ serviceTier: "default" }));
 it("refuses Fast on an unsupported model", () => expect(() => codexTurnSettings({ modelId: "model-standard", fastMode: true }, models)).toThrow("Fast mode is unavailable"));
 it("refuses a stale unavailable model instead of silently substituting another", () => expect(() => codexTurnSettings({ modelId: "gone" }, models)).toThrow("model is unavailable"));
 it("refuses an effort the selected model cannot use", () => expect(() => codexTurnSettings({ thinkingLevel: "high" }, models)).toThrow("reasoning effort is unavailable"));
});

const claudeModels = nativeClaudeModels({ models: [
 { value: "default", displayName: "Default (recommended)", supportsEffort: true, supportedEffortLevels: ["low", "max"] },
 { value: "opus", displayName: "Opus", supportsEffort: true, supportedEffortLevels: ["high"] },
 { value: "haiku-legacy", displayName: "Haiku", supportedEffortLevels: ["high"] },
 { value: "", displayName: "Empty" }, null, "text",
] });
describe("Claude Code model and effort come from the CLI's own catalog", () => {
 it("keeps only well-formed models and the efforts each one supports", () => expect(claudeModels).toEqual([
  { id: "default", label: "Default (recommended)", isDefault: true, thinkingLevels: ["low", "max"], fast: false },
  { id: "opus", label: "Opus", isDefault: false, thinkingLevels: ["high"], fast: false },
  { id: "haiku-legacy", label: "Haiku", isDefault: false, thinkingLevels: [], fast: false },
 ]));
 it("passes the selected model and effort as CLI flags", () => expect(claudeTurnArgs({ modelId: "opus", thinkingLevel: "high" }, claudeModels)).toEqual(["--model", "opus", "--effort", "high"]));
 it("leaves the account default to the CLI", () => expect(claudeTurnArgs({ modelId: null, thinkingLevel: "max" }, claudeModels)).toEqual(["--effort", "max"]));
 it("refuses a model the account cannot use", () => expect(() => claudeTurnArgs({ modelId: "gone" }, claudeModels)).toThrow("model is unavailable"));
 it("refuses an effort the selected model cannot use", () => expect(() => claudeTurnArgs({ modelId: "haiku-legacy", thinkingLevel: "high" }, claudeModels)).toThrow("effort is unavailable"));
 it("refuses Fast, which Claude Code does not offer", () => expect(() => claudeTurnArgs({ fastMode: true }, claudeModels)).toThrow("Fast mode is unavailable"));
 it("leaves an unreadable catalog's check to the CLI itself", () => expect(claudeTurnArgs({ modelId: "opus" }, undefined)).toEqual(["--model", "opus"]));
 it("rejects a reply without a catalog", () => expect(() => nativeClaudeModels({ account: {} })).toThrow("catalog unavailable"));
});
