import { expect, it, vi } from "vitest";
import { prepareDevelopmentAgent } from "./development-agent.js";

it("uses the owned agent's existing dedicated-computer RPC before connecting development", async () => {
  const request = vi.fn(async () => ({ json: { id: "bot", status: "idle" } }));
  await prepareDevelopmentAgent("bot", request);
  expect(request.mock.calls).toEqual([
    ["bots/get", { botId: "bot" }],
    ["bots/setComputer", { botId: "bot", mode: "dedicated" }],
  ]);
});
it("refuses to redirect an unavailable or busy agent", async () => {
  for (const value of [
    { id: "other", status: "idle" },
    { id: "bot", status: "running" },
    { id: "bot", status: "waiting_input" },
  ]) {
    const request = vi.fn(async () => ({ json: value }));
    await expect(prepareDevelopmentAgent("bot", request)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  }
});
