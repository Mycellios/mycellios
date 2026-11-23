import { RPCHandler } from "@orpc/server/fetch";
import type * as Adapters from "@mycellios/adapters";
import { ComputerBusyError } from "@mycellios/adapters";
import type { Actor } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { Prisma } from "@mycellios/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const lifecycle = vi.hoisted(() => ({
  acquireComputerExecutionLease: vi.fn(),
  provisionComputer: vi.fn(),
  releaseComputerExecutionLease: vi.fn(),
}));

vi.mock("@mycellios/adapters", async (original) => ({
  ...(await original<typeof Adapters>()),
  acquireComputerExecutionLease: lifecycle.acquireComputerExecutionLease,
  provisionComputer: lifecycle.provisionComputer,
  releaseComputerExecutionLease: lifecycle.releaseComputerExecutionLease,
}));

const actor = {
  spaceId: "workspace-1",
  userId: "user-1",
  email: "user@example.test",
  isDeploymentOwner: true,
} satisfies Actor;

function routerDeps(prisma: PrismaClient, sandbox?: RouterDeps["sandbox"]) {
  return {
    prisma,
    sandbox,
    jobs: { enqueue: vi.fn() },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "https://web.example.test",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/rakazo-router-test",
  } as unknown as RouterDeps;
}

async function boot(prisma: PrismaClient) {
  const handler = new RPCHandler(createRouter(routerDeps(prisma)));
  const { response } = await handler.handle(
    new Request("https://api.example.test/rpc/computer/boot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { botId: "bot-1" } }),
    }),
    { prefix: "/rpc", context: { actor } },
  );
  return response;
}

const stoppedBot = {
  id: "bot-1",
  thread: { id: "thread-1" },
  computer: { id: "computer-1", state: "stopped", providerRef: null, scope: "team" },
};

beforeEach(() => {
  lifecycle.acquireComputerExecutionLease.mockReset().mockResolvedValue(null);
  lifecycle.provisionComputer.mockReset();
  lifecycle.releaseComputerExecutionLease.mockReset();
});

describe("computer boot", () => {
  it("waits for a finished run to let go of the computer", async () => {
    lifecycle.acquireComputerExecutionLease
      .mockRejectedValueOnce(new ComputerBusyError())
      .mockResolvedValueOnce(null);
    lifecycle.provisionComputer.mockRejectedValue(new Error("stop after the lease"));
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue(stoppedBot) },
      computerExecutionLease: {
        findUnique: vi.fn().mockResolvedValue({
          runId: "run-1",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      run: { findUnique: vi.fn().mockResolvedValue({ status: "completed" }) },
    } as unknown as PrismaClient;

    await boot(prisma);

    expect(prisma.computerExecutionLease.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { computerId_botId: { computerId: "computer-1", botId: "bot-1" } },
      }),
    );
    expect(lifecycle.acquireComputerExecutionLease).toHaveBeenCalledTimes(2);
    expect(lifecycle.provisionComputer).toHaveBeenCalledOnce();
  });

  it("still refuses a boot while the run is going", async () => {
    lifecycle.acquireComputerExecutionLease.mockRejectedValue(new ComputerBusyError());
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue(stoppedBot) },
      computerExecutionLease: {
        findUnique: vi.fn().mockResolvedValue({
          runId: "run-1",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      run: { findUnique: vi.fn().mockResolvedValue({ status: "running" }) },
    } as unknown as PrismaClient;

    const response = await boot(prisma);

    expect(response?.status).toBe(409);
    expect(lifecycle.acquireComputerExecutionLease).toHaveBeenCalledOnce();
    expect(lifecycle.provisionComputer).not.toHaveBeenCalled();
  });

  it("reports a computer removed while the boot waited as not found", async () => {
    lifecycle.provisionComputer.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("No record was found for a query.", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    const prisma = {
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          ...stoppedBot,
          computer: { ...stoppedBot.computer, state: "booting" },
        }),
      },
    } as unknown as PrismaClient;

    const response = await boot(prisma);

    expect(response?.status).toBe(404);
    expect(lifecycle.provisionComputer).toHaveBeenCalledOnce();
    expect(lifecycle.releaseComputerExecutionLease).toHaveBeenCalledOnce();
  });
});

describe("browser handoff", () => {
  it.each([
    ["side-thread", "run-1", true, "focused"],
    [null, "run-1", true, "unavailable"],
    ["side-thread", "run-2", true, "unavailable"],
    ["side-thread", "run-1", false, "unavailable"],
  ])("requires the owned waiting run, its screen fence and an existing tab", async (threadId, leaseRunId, available, state) => {
    const pageBrowser = vi.fn().mockResolvedValue({ ok: available });
    const findRun = vi.fn().mockResolvedValue(threadId ? { threadId } : null);
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ ...stoppedBot, computer: {
        ...stoppedBot.computer, botId: "bot-1", kind: "docker", state: "running",
        providerRef: "sandbox-1", controlRunId: "run-1",
      } }) },
      run: { findFirst: findRun },
      computerExecutionLease: { findUnique: vi.fn().mockResolvedValue({
        runId: leaseRunId, fence: 9, expiresAt: new Date(Date.now() + 60_000),
      }) },
    } as unknown as PrismaClient;
    const sandbox = { pageBrowser } as unknown as RouterDeps["sandbox"];
    const handler = new RPCHandler(createRouter(routerDeps(prisma, sandbox)));
    const { response } = await handler.handle(new Request("https://api.example.test/rpc/computer/focusBrowserTab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { botId: "bot-1", runId: "run-1" } }),
    }), { prefix: "/rpc", context: { actor } });
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ json: { state } });
    expect(findRun).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "run-1", botId: "bot-1", userId: actor.userId, spaceId: actor.spaceId, status: "waiting_takeover",
    }) }));
    if (!threadId || leaseRunId !== "run-1") {
      expect(pageBrowser).not.toHaveBeenCalled();
    } else {
      expect(pageBrowser).toHaveBeenCalledWith(expect.anything(), { command: "focus" },
        expect.objectContaining({ browserThreadId: threadId, screenLeaseId: expect.stringMatching(/:9$/) }));
    }
  });

  it.each([
    ["run-1", "side-thread", 200, true],
    ["run-2", "side-thread", 403, false],
    ["run-1", null, 200, false],
  ])("streams only the tab of the waiting run whose control the user holds (%s, %s)", async (controlRunId, threadId, status, streamed) => {
    const connectTabView = vi.fn().mockResolvedValue({ url: "http://10.0.0.5:6080/tab.html?path=websockify%3Ftoken%3Dfake-tab-token" });
    const findRun = vi.fn().mockResolvedValue(threadId ? { threadId } : null);
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ ...stoppedBot, screenGeneration: 0, computer: {
        ...stoppedBot.computer, botId: "bot-1", kind: "docker", state: "running", providerRef: "sandbox-1",
        controlHolder: "user", controlBotId: "bot-1", controlLeaseId: "lease-1", screenGeneration: 0,
        controlLeaseExpiresAt: new Date(Date.now() + 60_000), controlRunId,
      } }) },
      run: { findFirst: findRun },
      computer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      computerExecutionLease: { findUnique: vi.fn().mockResolvedValue({
        runId: "run-1", fence: 9, expiresAt: new Date(Date.now() + 60_000),
      }) },
    } as unknown as PrismaClient;
    const sandbox = { connectTabView } as unknown as RouterDeps["sandbox"];
    const handler = new RPCHandler(createRouter(routerDeps(prisma, sandbox)));
    const { response } = await handler.handle(new Request("https://api.example.test/rpc/computer/tabViewUrl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { botId: "bot-1", runId: "run-1" } }),
    }), { prefix: "/rpc", context: { actor } });
    expect(response?.status).toBe(status);
    if (!streamed) {
      expect(connectTabView).not.toHaveBeenCalled();
      if (status === 200) expect(await response?.json()).toMatchObject({ json: { url: null } });
      return;
    }
    expect(connectTabView).toHaveBeenCalledWith(expect.anything(), { controlToken: "lease-1" },
      expect.objectContaining({ browserThreadId: threadId, screenLeaseId: expect.stringMatching(/:9$/) }));
    const { json } = await response!.json() as { json: { url: string } };
    expect(json.url).toMatch(/^https:\/\/web\.example\.test\/novnc\/session\/control\/.+\/tab\.html\?/);
    expect(json.url).not.toContain("fake-tab-token");
  });
});
