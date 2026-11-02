import { describe, expect, it, vi } from "vitest";
import { nativeComputerFetch } from "./native-computer-execution";

function fixture() {
  const order: string[] = [];
  const computer = {
    requestAccess: vi.fn(async () => {
      order.push("consent");
      return true;
    }),
    revokeAccess: vi.fn(async () => undefined),
    connect: vi.fn(async (_id: string) => {
      order.push("bind");
    }),
    connected: vi.fn(async (_id: string) => true),
    projectAvailable: vi.fn(async () => true),
    onConfigure: vi.fn(() => () => undefined),
  };
  const send = vi.fn<typeof fetch>(async () => {
    order.push("send");
    return Response.json({ ok: true });
  });
  return {
    computer,
    send,
    order,
    fetch: nativeComputerFetch(send, computer, "https://example.test", "/agent"),
  };
}
const url = "https://example.test/agent/rpc/threads/send";
const message = (botId = "owned-bot") => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ json: { botId, text: "fixture" } }),
});

describe("native computer admission", () => {
  it("binds native execution before sending, without selecting a project or changing the message", async () => {
    const f = fixture();
    const init = message();
    await f.fetch(url, init);
    expect(f.order).toEqual(["consent", "bind", "send"]);
    expect(f.computer.connect).toHaveBeenCalledWith("owned-bot");
    expect(f.send).toHaveBeenCalledWith(url, init);
  });
  it("does not start a model turn when native access is declined", async () => {
    const f = fixture();
    f.computer.requestAccess.mockResolvedValue(false);
    await expect(f.fetch(url, message())).rejects.toThrow("not allowed");
    expect(f.computer.connect).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("fails without submitting when the executor is unavailable or disconnected", async () => {
    for (const stage of ["projectAvailable", "connected"] as const) {
      const f = fixture();
      f.computer[stage].mockResolvedValue(false);
      await expect(f.fetch(url, message())).rejects.toThrow(/unavailable|disconnected/);
      expect(f.send).not.toHaveBeenCalled();
    }
  });
  it("does not prompt for read-only RPCs, another origin or another server path", async () => {
    const f = fixture();
    for (const target of [
      "https://example.test/agent/rpc/me",
      "https://other.test/agent/rpc/threads/send",
      "https://example.test/rpc/threads/send",
    ])
      await f.fetch(target, message());
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.computer.requestAccess).not.toHaveBeenCalled();
  });
  it("does not consume an existing Request body", async () => {
    const f = fixture();
    const request = new Request(url, message());
    await f.fetch(request);
    expect(request.bodyUsed).toBe(false);
    expect(await request.json()).toEqual({ json: { botId: "owned-bot", text: "fixture" } });
  });
  it("serializes native prompts while admitting concurrent bot sends separately", async () => {
    const f = fixture();
    let active = 0;
    let maxActive = 0;
    f.computer.requestAccess.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return true;
    });
    await Promise.all([f.fetch(url, message("a")), f.fetch(url, message("b"))]);
    expect(maxActive).toBe(1);
    expect(f.computer.connect.mock.calls).toEqual([["a"], ["b"]]);
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("does not request access or submit an already cancelled turn", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.fetch(url, { ...message(), signal: controller.signal })).rejects.toThrow();
    expect(f.computer.requestAccess).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("reasserts the executor binding on later turns rather than trusting a stale connection flag", async () => {
    const f = fixture();
    await f.fetch(url, message());
    await f.fetch(url, message());
    expect(f.computer.connect).toHaveBeenCalledTimes(2);
  });
});
