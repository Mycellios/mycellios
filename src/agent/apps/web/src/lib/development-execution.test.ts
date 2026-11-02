// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { beforeDevelopmentExecution } from "./development-execution";

afterEach(() => {
  delete window.rakazoDesktop;
});
it("connects development before submitting work and refuses the request when setup fails", async () => {
  const connect = vi.fn(async () => {}),
    dedicated = vi.fn(async () => {});
  window.rakazoDesktop = { development: { isDevelopment: true, connect } } as any;
  await beforeDevelopmentExecution(["threads", "send"], { botId: "bot" }, dedicated);
  expect(dedicated).toHaveBeenCalledWith("bot");
  expect(connect).toHaveBeenCalledWith("bot");
  expect(dedicated.mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[0]!);
  connect.mockRejectedValueOnce(new Error("offline"));
  await expect(
    beforeDevelopmentExecution(["threads", "retry"], { botId: "bot" }, dedicated),
  ).rejects.toThrow("offline");
});
it("does not change stable-window execution or read-only requests", async () => {
  const dedicated = vi.fn(),
    connect = vi.fn();
  window.rakazoDesktop = { development: { isDevelopment: false, connect } } as any;
  await beforeDevelopmentExecution(["threads", "send"], { botId: "bot" }, dedicated);
  window.rakazoDesktop!.development!.isDevelopment = true;
  await beforeDevelopmentExecution(["bots", "list"], {}, dedicated);
  expect(dedicated).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});
