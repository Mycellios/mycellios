import { describe, expect, it } from "vitest";
import { eventDemoConfigSchema, readEventDemoConfig } from "../src/core/event-demo-config.js";
describe("event demo opt-in and hard limits", () => {
  const config = { id: "test-only-event", title: "Test only", startsAt: 1_000_000, endsAt: 2_000_000,
    maxGuests: 50, grantMicrounits: 200000, model: "mycellios/managed/antseed/deepseek-v4-flash",
    cookieSecret: "a".repeat(43), presenterSecret: "b".repeat(43), publicOrigin: "https://demo.invalid" };
  it("is disabled by default, even when configuration exists", () => {
    expect(readEventDemoConfig({ MYCELLIOS_EVENT_DEMO_CONFIG_JSON: JSON.stringify(config) })).toBeUndefined();
    expect(readEventDemoConfig({ MYCELLIOS_EVENT_DEMO_ENABLED: "true", MYCELLIOS_EVENT_DEMO_CONFIG_JSON: JSON.stringify(config) })).toEqual(config);
  });
  it.each([{ maxGuests: 51 }, { grantMicrounits: 200001 }, { model: "unpriced-model" },
    { endsAt: 1_000_000 + 48 * 3600000 + 1 }, { endsAt: 1_000_000 }, { cookieSecret: "weak" },
    { presenterSecret: "a".repeat(43) }, { publicOrigin: "http://external.invalid" }, { publicOrigin: "https://demo.invalid/path" }])
    ("refuses a widened, ambiguous or insecure event: %o", change => expect(() => eventDemoConfigSchema.parse({ ...config, ...change })).toThrow());
});
