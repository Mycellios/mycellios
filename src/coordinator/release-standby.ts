import Fastify from "fastify";
import { MeshDatabase } from "../storage/database.js";

export async function checkReleaseStandbyDatabase(url: string, schema?: string): Promise<void> {
  // The PostgreSQL adapter opens using SELECT only. There is no SQLite fallback.
  const database = await MeshDatabase.openPostgres(url, schema);
  await database.close();
}

export function createReleaseStandby(revision: string, checkDatabase: () => Promise<void>) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("release_standby_revision_required");

  const app = Fastify({ exposeHeadRoutes: false });
  let checking: Promise<void> | undefined;
  app.get("/internal/release/standby/ready", async (_request, reply) => {
    try {
      // A burst of probes must not open more PostgreSQL connections.
      checking ??= Promise.resolve().then(checkDatabase).finally(() => { checking = undefined; });
      await checking;
      return { status: "ok", revision, releaseState: "standby" };
    } catch {
      return reply.code(503).send({ status: "unavailable", revision, releaseState: "standby" });
    }
  });
  app.setNotFoundHandler((_request, reply) => reply.code(503).send({
    error: { code: "release_standby" },
  }));
  app.server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return app;
}
