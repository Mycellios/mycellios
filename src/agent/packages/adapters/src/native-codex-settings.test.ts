import { describe, expect, it } from "vitest";
import { codexTurnSettings, nativeCodexModels } from "./native-codex-settings.js";
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
