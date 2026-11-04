import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import { connectionAccountDetails } from "./connection-account-details.js";

const owner = { userId: "owner", spaceId: "forest-space" };
const input = { connectorId: "composio", provider: "twitter" };
const context = owner as AdapterContext;
const row = (id = "linked") => ({
  ...owner,
  ...input,
  id,
  providerRef: `remote-${id}`,
  displayName: "Twitter",
  status: "connected",
  createdAt: new Date("2026-11-04T10:00:00Z"),
  metadata: { accessToken: "fixture-secret" },
});

function fixture(first = [row()], current = first) {
  const findMany = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(current);
  const prisma = { connection: { findMany } } as unknown as PrismaClient;
  const describeConnection = vi.fn().mockResolvedValue({ label: "@forest_fixture" });
  const provider = { describeConnection } as unknown as ManagedConnectorProvider;
  return { prisma, findMany, describeConnection, provider };
}

it("scopes both reads to the owner and selected app and projects no secrets or remote refs", async () => {
  const { prisma, provider, findMany, describeConnection } = fixture();
  const rows = await connectionAccountDetails(prisma, owner, input, provider, context);
  for (const [query] of findMany.mock.calls)
    expect(query.where).toMatchObject({ ...owner, ...input });
  expect(describeConnection).toHaveBeenCalledWith(
    { provider: "twitter", connectionRef: "remote-linked" },
    context,
  );
  expect(rows[0]?.identity).toEqual({ label: "@forest_fixture" });
  expect(JSON.stringify(rows)).not.toContain("fixture-secret");
  expect(JSON.stringify(rows)).not.toContain("remote-linked");
});

it("keeps pending attempts separate from confirmed account identities", async () => {
  const pending = { ...row("pending"), status: "pending" };
  const { prisma, provider, describeConnection } = fixture([row(), pending]);
  const result = await connectionAccountDetails(prisma, owner, input, provider, context);
  expect(describeConnection).toHaveBeenCalledTimes(1);
  expect(result.find((entry) => entry.id === "pending")?.identity).toBeNull();
});

it("does not resurrect a revoked connection or reuse a profile after reconnection", async () => {
  const revoked = fixture([row()], []);
  expect(
    await connectionAccountDetails(revoked.prisma, owner, input, revoked.provider, context),
  ).toEqual([]);
  const reconnected = fixture([row()], [{ ...row(), providerRef: "different-authorization" }]);
  const result = await connectionAccountDetails(
    reconnected.prisma,
    owner,
    input,
    reconnected.provider,
    context,
  );
  expect(result[0]?.identity).toBeNull();
});

it("retains the account list when its identity is unavailable and never guesses for a legacy slug", async () => {
  const { prisma, provider, describeConnection } = fixture([
    row(),
    { ...row("legacy"), providerRef: "twitter" },
  ]);
  describeConnection.mockRejectedValue(new Error("provider unavailable"));
  const result = await connectionAccountDetails(prisma, owner, input, provider, context);
  expect(result).toHaveLength(2);
  expect(result.every((entry) => entry.identity === null)).toBe(true);
  expect(describeConnection).toHaveBeenCalledTimes(1);
});
