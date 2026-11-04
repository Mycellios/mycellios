import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { Actor, Connection, ConnectionIdentity } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

export async function connectionAccountDetails(
  prisma: PrismaClient,
  owner: Pick<Actor, "userId" | "spaceId">,
  input: { connectorId: string; provider: string },
  provider: ManagedConnectorProvider | undefined,
  context: AdapterContext,
): Promise<Connection[]> {
  const query = {
    where: {
      userId: owner.userId,
      spaceId: owner.spaceId,
      connectorId: input.connectorId,
      provider: input.provider,
      status: { in: ["connected", "pending"] },
    },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  };
  const rows = await prisma.connection.findMany(query);
  const identities = new Map<string, { ref: string; identity: ConnectionIdentity | null }>();
  let cursor = 0;
  if (provider?.describeConnection) {
    await Promise.all(
      Array.from({ length: Math.min(rows.length, 4) }, async () => {
        while (cursor < rows.length) {
          const row = rows[cursor++]!;
          if (context.signal?.aborted) return;
          if (row.status !== "connected" || !row.providerRef || row.providerRef === row.provider)
            continue;
          const identity = await Promise.resolve()
            .then(() =>
              provider.describeConnection!(
                { provider: row.provider, connectionRef: row.providerRef! },
                context,
              ),
            )
            .catch(() => null);
          identities.set(row.id, { ref: row.providerRef, identity });
        }
      }),
    );
  }
  // A revoke or reconnect during profile lookup must not resurrect or relabel the old grant.
  const current = await prisma.connection.findMany(query);
  return current.map((row) => {
    const found = identities.get(row.id);
    return {
      id: row.id,
      connectorId: row.connectorId,
      provider: row.provider,
      displayName: row.displayName,
      status: row.status as Connection["status"],
      capabilities: [],
      createdAt: row.createdAt.toISOString(),
      identity:
        found && row.status === "connected" && row.providerRef === found.ref
          ? found.identity
          : null,
    };
  });
}
