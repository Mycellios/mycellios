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


it("validates bounded memory-review policy only in owned defaults",()=>{
 for(const dailyLimitMicrounits of [0,1000,10000,50000])expect(MicoSettingsUpdate.safeParse({revision:1,kind:"defaults",patch:{memoryReview:{enabled:true,interval:20,dailyLimitMicrounits}}}).success).toBe(true);
 expect(MicoSettingsUpdate.safeParse({revision:1,kind:"defaults",patch:{memoryReview:{enabled:true,interval:20,dailyLimitMicrounits:100001}}}).success).toBe(false);
 expect(MicoSettingsUpdate.safeParse({revision:1,kind:"defaults",patch:{memoryReview:{enabled:true,interval:1,dailyLimitMicrounits:1000}}}).success).toBe(false);
});
