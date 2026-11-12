import { expect, it } from "vitest";
import { effectiveMicoSettings, MicoSettingsUpdate } from "./mico-settings.js";

it("defaults to denied automation and preserves explicit overrides", () => {
  expect(effectiveMicoSettings({}, {})).toEqual({ localScripts: false, agentNewChat: false, showPlan: false, gitCoauthor: true });
  expect(effectiveMicoSettings({ localScripts: true }, { localScripts: false }).localScripts).toBe(false);
  expect(effectiveMicoSettings({ showPlan: true }, {}).showPlan).toBe(true);
});
it("a partial save does not reset unrelated defaults or accept model-supplied policies", () => {
  expect(MicoSettingsUpdate.parse({ revision: 2, kind: "defaults", patch: { gitCoauthor: false } })).toEqual({ revision: 2, kind: "defaults", patch: { gitCoauthor: false } });
  expect(MicoSettingsUpdate.safeParse({ revision: 0, kind: "bot", botId: "b", key: "gitCoauthor", value: true }).success).toBe(false);
});
