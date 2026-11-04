import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { currentMicoVoice } from "./mico.js";

vi.mock("@rakazo/db", () => ({ runAsTenant: (_actor: unknown, work: () => unknown) => work() }));
vi.mock("../thread-target.js", () => ({
  resolveThreadTarget: vi.fn(async () => ({ kind: "bot", threadId: "owned-task" })),
}));
vi.mock("../voice.js", () => ({ synthesizeVoice: vi.fn(), transcribeVoice: vi.fn() }));

describe("WebRTC uses the existing Mico conversation pipeline", () => {
  const actor = { userId: "user-a", spaceId: "space-a" };
  it("uses atomic idle admission and reads only the accepted run in the owned task", async () => {
    const app = new Hono();
    let sent: unknown;
    app.post("/rpc/threads/send", async (c) => {
      sent = await c.req.json();
      return c.json({ json: { runId: "accepted-run" } });
    });
    const findRun = vi.fn(async (_input: unknown) => ({ status: "completed" }));
    const findMessages = vi.fn(async (_input: unknown) => [
      { blocks: [{ kind: "text", text: "The existing Mico replied." }] },
    ]);
    const mico = currentMicoVoice(
      app,
      { prisma: { run: { findFirst: findRun }, message: { findMany: findMessages } } } as never,
      actor as never,
      new Request("https://local.test/api/voice/rtc/sessions", {
        headers: { cookie: "local-session", origin: "https://local.test" },
      }),
      { botId: "existing-mico", taskThreadId: "owned-task" },
      async () => actor as never,
    );
    expect(await mico.reply("Hello", "call:trial:turn-one", new AbortController().signal)).toBe(
      "The existing Mico replied.",
    );
    expect(sent).toEqual({
      json: {
        botId: "existing-mico",
        taskThreadId: "owned-task",
        text: "Hello",
        clientNonce: "call:trial:turn-one",
        queueOnlyWhenIdle: true,
      },
    });
    expect(findRun.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: "accepted-run",
        userId: "user-a",
        spaceId: "space-a",
        botId: "existing-mico",
        threadId: "owned-task",
      },
    });
    expect(findMessages.mock.calls[0]?.[0]).toMatchObject({
      where: { runId: "accepted-run", threadId: "owned-task", botId: "existing-mico", role: "bot" },
    });
  });
  it("does not answer a pending approval/secret card or retry an uncertain send", async () => {
    const app = new Hono();
    let sends = 0;
    app.post("/rpc/threads/send", (c) => {
      sends++;
      return c.json({ error: "Pending approval" }, 409);
    });
    const mico = currentMicoVoice(
      app,
      {} as never,
      actor as never,
      new Request("https://local.test/"),
      { botId: "mico" },
      async () => actor as never,
    );
    await expect(
      mico.reply("Yes", "call:trial:turn-one", new AbortController().signal),
    ).rejects.toThrow("pending request");
    expect(sends).toBe(1);
  });
  it("refuses a changed or revoked session before sending any message", async () => {
    const app = new Hono();
    const send = vi.fn();
    app.post("/rpc/threads/send", send);
    const mico = currentMicoVoice(
      app,
      {} as never,
      actor as never,
      new Request("https://local.test/"),
      { botId: "mico" },
      async () => ({ userId: "another-user", spaceId: "space-a" }) as never,
    );
    await expect(
      mico.reply("Hello", "call:trial:one", new AbortController().signal),
    ).rejects.toThrow("Session ended");
    expect(send).not.toHaveBeenCalled();
  });
});
