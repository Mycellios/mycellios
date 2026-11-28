import type { FastifyInstance, FastifyRequest } from "fastify";

export function registerReleaseWorkStatus<T extends object>(
  app: FastifyInstance,
  revision: string,
  trusted: (request: FastifyRequest) => boolean,
  snapshot: () => T,
): void {
  app.get("/internal/release/work", { exposeHeadRoute: false }, async (request, reply) => {
    if (!trusted(request)) return reply.code(404).send();
    reply.header("Cache-Control", "no-store");
    return { ...snapshot(), revision };
  });
}
