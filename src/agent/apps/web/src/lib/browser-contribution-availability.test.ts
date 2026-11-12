import { expect, it, vi } from "vitest";
import { browserContributionAvailability } from "./browser-contribution-availability";
it("reads only the same coordinator's public capabilities without account credentials", async () => {
  const request = vi.fn(async () => Response.json({ schema: "mycellios-browser-contribution/1", accountLinking: true, paidInference: true }));
  expect(await browserContributionAvailability(request)).toBe("ready");
  expect(request).toHaveBeenCalledWith("/mobile/v1/contribution-capabilities", expect.objectContaining({credentials:"omit",cache:"no-store",redirect:"error"}));
});
it.each([404,501])("does not offer payouts when the endpoint has not been published (%s)", async status => {
  expect(await browserContributionAvailability(vi.fn(async()=>new Response(null,{status})))).toBe("unavailable");
});
it.each([{}, {schema:"mycellios-browser-contribution/1",accountLinking:true,paidInference:false}])("requires explicit availability of both linking and paid work",async value=>{
  expect(await browserContributionAvailability(vi.fn(async()=>Response.json(value)))).toBe("unavailable");
});
it("bounds capability replies and treats failures as offline, never ready", async()=>{
  for (const request of [vi.fn(async()=>{throw Error("offline");}), vi.fn(async()=>new Response("x".repeat(4097))),vi.fn(async()=>new Response("invalid"))])
    expect(await browserContributionAvailability(request)).toBe("offline");
});
