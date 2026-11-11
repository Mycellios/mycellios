import { ORPCError } from "@orpc/server";
import { TailnetError, TailnetService } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";

export function tailscaleRoutes({ deps, authed }: RouterContext) {
  const service = deps.tailnets ?? new TailnetService(deps.prisma);
  const guarded = authed.use(async ({ next }) => {
    try { return await next(); }
    catch (error) {
      if (error instanceof ORPCError) throw error;
      if (error instanceof TailnetError) throw new ORPCError("BAD_REQUEST", { message: error.message });
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Tailscale is unavailable. Try again." });
    }
  });
  type Scope = { spaceId: string; userId: string };
  const ownedBots = async (scope: Scope, ids: string[]) => {
    const unique = [...new Set(ids)];
    const count = await deps.prisma.bot.count({ where: {
      id: { in: unique }, spaceId: scope.spaceId, userId: scope.userId, archivedAt: null,
    } });
    if (count !== unique.length) throw new ORPCError("FORBIDDEN", { message: "Choose only your own Micos in this Space" });
    return unique;
  };
  return { tailscale: {
    list: guarded.tailscale.list.handler(async ({ context }) => {
      await service.member(context.actor);
      const [rows, policies, admin] = await Promise.all([
        deps.prisma.tailnetConnection.findMany({ where: {
          spaceId: context.actor.spaceId, userId: context.actor.userId,
        }, orderBy: { createdAt: "asc" }, take: 100 }),
        deps.prisma.tailnetPolicy.findMany({ where: { spaceId: context.actor.spaceId }, take: 100 }),
        service.admin(context.actor),
      ]);
      const connections = await Promise.all(rows.map(async row => {
        try { return await service.status(row.id, context.actor); }
        catch { return { id: row.id, name: row.name, kind: row.kind as "company" | "personal",
          dnsSuffix: row.dnsSuffix, allowedBotIds: row.allowedBotIds as string[], enabled: row.enabled,
          status: "unavailable" as const, authUrl: null, deviceName: null }; }
      }));
      return { available: service.available, admin,
        companyNetworks: policies.map(row => ({ id: row.id, dnsSuffix: row.dnsSuffix, enabled: row.enabled })), connections };
    }),
    create: guarded.tailscale.create.handler(async ({ context, input }) => {
      await service.member(context.actor);
      if (!service.available) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Tailscale is not configured on this server" });
      await service.checkKind(context.actor, input.kind, input.dnsSuffix);
      const ids = await ownedBots(context.actor, input.allowedBotIds);
      const count = await deps.prisma.tailnetConnection.count({ where: {
        spaceId: context.actor.spaceId, userId: context.actor.userId,
      } });
      if (count >= 20) throw new ORPCError("BAD_REQUEST", { message: "At most 20 Tailscale connections are allowed" });
      const row = await deps.prisma.tailnetConnection.create({ data: {
        spaceId: context.actor.spaceId, userId: context.actor.userId,
        name: input.name, kind: input.kind, dnsSuffix: input.dnsSuffix, allowedBotIds: ids,
      } });
      return service.status(row.id, context.actor);
    }),
    connect: guarded.tailscale.connect.handler(async ({ context, input }) => service.status(input.id, context.actor, true)),
    disconnect: guarded.tailscale.disconnect.handler(async ({ context, input }) => {
      await service.disconnect(input.id, context.actor); return { ok: true as const };
    }),
    grant: guarded.tailscale.grant.handler(async ({ context, input }) => {
      await service.row(input.id, context.actor);
      const ids = await ownedBots(context.actor, input.allowedBotIds);
      await deps.prisma.tailnetConnection.update({ where: { id: input.id }, data: { allowedBotIds: ids } });
      return { ok: true as const };
    }),
    company: guarded.tailscale.company.handler(async ({ context, input }) => {
      if (!await service.admin(context.actor)) throw new ORPCError("FORBIDDEN");
      await deps.prisma.tailnetPolicy.upsert({
        where: { spaceId_dnsSuffix: { spaceId: context.actor.spaceId, dnsSuffix: input.dnsSuffix } },
        create: { spaceId: context.actor.spaceId, dnsSuffix: input.dnsSuffix, enabled: input.enabled },
        update: { enabled: input.enabled },
      });
      return { ok: true as const };
    }),
  } };
}
