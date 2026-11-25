import { ORPCError } from "@orpc/server";
import type { Actor } from "@mycellios/contracts";
import {
  issueMicoScriptToken,
  micoScriptTokenMetadata,
  readMicoScriptsSettings,
  revokeMicoScriptToken,
  setMicoScriptsEnabled,
} from "@mycellios/db";
import type { RouterContext } from "./context.js";

export function micoScriptsRoutes({ authed, deps }: RouterContext) {
  function scope(actor: Actor, botId: string) {
    if (!deps.env.micoScriptsEnabled) throw new ORPCError("NOT_FOUND");
    return { botId, spaceId: actor.spaceId, userId: actor.userId };
  }

  return {
    micoScripts: {
      get: authed.micoScripts.get.handler(async ({ context, input }) => {
        const settings = await readMicoScriptsSettings(deps.prisma, scope(context.actor, input.botId));
        if (!settings) throw new ORPCError("NOT_FOUND");
        return settings;
      }),
      configure: authed.micoScripts.configure.handler(async ({ context, input }) => {
        const settings = await setMicoScriptsEnabled(
          deps.prisma, scope(context.actor, input.botId), input.enabled, input.requestsPerHour,
        );
        if (!settings) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
      issue: authed.micoScripts.issue.handler(async ({ context, input }) => {
        const result = await issueMicoScriptToken(deps.prisma, scope(context.actor, input.botId));
        if (result.status === "unavailable") throw new ORPCError("NOT_FOUND");
        if (result.status === "limit") {
          throw new ORPCError("CONFLICT", { message: "Revoke a token before creating another one." });
        }
        return { token: result.token, metadata: micoScriptTokenMetadata(result.record) };
      }),
      revoke: authed.micoScripts.revoke.handler(async ({ context, input }) => {
        const removed = await revokeMicoScriptToken(deps.prisma, scope(context.actor, input.botId), input.tokenId);
        if (!removed) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
    },
  };
}
