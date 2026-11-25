import type { MicoScriptInfo } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { findMicoScriptCredential, runAsSystem, runAsTenant } from "@mycellios/db";
import type { Hono } from "hono";

export async function authenticateMicoScript(
  prisma: PrismaClient, botId: string, authorization: string | undefined,
) {
  if (!authorization || authorization.length > 64 || botId.length > 128) return null;
  const bearer = /^Bearer (mycs_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!bearer) return null;
  return runAsSystem("resolve bearer credential for a Mico Script", () =>
    findMicoScriptCredential(prisma, botId, bearer[1]!),
  );
}

export function mountMicoScriptsHttp(app: Hono, prisma: PrismaClient) {
  app.get("/api/v1/micos/:botId", async (c) => {
    c.header("cache-control", "private, no-store");
    const botId = c.req.param("botId");
    const scope = await authenticateMicoScript(prisma, botId, c.req.header("authorization"));
    const unavailable = () => c.json({ error: "Mico unavailable" }, 404);
    if (!scope) return unavailable();
    return runAsTenant(scope, async () => {
      const owner = { botId, spaceId: scope.spaceId, userId: scope.userId };
      const mico = await prisma.bot.findFirst({
        where: { id: botId, spaceId: owner.spaceId, userId: owner.userId, archivedAt: null },
        select: { id: true, name: true },
      });
      if (!mico) return unavailable();
      const routines = await prisma.routine.findMany({
        where: owner,
        select: { id: true, name: true, active: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return c.json({ mico, routines, requestsPerHour: scope.requestsPerHour } satisfies MicoScriptInfo);
    });
  });
}
