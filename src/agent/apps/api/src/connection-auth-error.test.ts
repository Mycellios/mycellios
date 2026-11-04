import { RPCHandler } from "@orpc/server/fetch";
import { ComposioConnector } from "@rakazo/adapters";
import { INTEGRATION_AUTH_SETUP_REQUIRED } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

it("returns a safe setup error over RPC and leaves the failed connection unconnected", async () => {
  const authorize = vi
    .fn()
    .mockRejectedValue(
      new Error(
        '400 {"error":{"slug":"ToolRouterV2_NoManagedAuth","code":4308,"request_id":"private-request"}}',
      ),
    );
  const connector = new ComposioConnector({
    client: {
      create: async () => ({ sessionId: "fixture-session", authorize }),
    } as never,
  });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    $executeRaw: vi.fn(),
    connection: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "connection-1", status: "pending" }),
    },
  };
  const prisma = {
    connection: { updateMany },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(transaction)),
  } as unknown as PrismaClient;
  const handler = new RPCHandler(
    createRouter({
      prisma,
      connectors: { managed: () => connector },
      env: { webOrigin: "https://app.example.test" },
    } as unknown as RouterDeps),
  );
  const { response } = await handler.handle(
    new Request("https://app.example.test/rpc/connections/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: { connectorId: "composio", provider: "twitter", displayName: "X" },
      }),
    }),
    {
      prefix: "/rpc",
      context: {
        actor: {
          userId: "user-1",
          spaceId: "space-1",
          email: "account@example.test",
          isDeploymentOwner: false,
        },
      },
    },
  );
  expect(response?.status).toBe(400);
  const body = await response!.json();
  expect(body.json.message).toBe(INTEGRATION_AUTH_SETUP_REQUIRED);
  expect(JSON.stringify(body)).not.toContain("private-request");
  expect(JSON.stringify(body)).not.toContain("ToolRouter");
  expect(updateMany).toHaveBeenCalledExactlyOnceWith({
    where: { id: "connection-1", userId: "user-1", spaceId: "space-1", status: "pending" },
    data: { status: "error" },
  });
  expect(authorize).toHaveBeenCalledTimes(1);
});
