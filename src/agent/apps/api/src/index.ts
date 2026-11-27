import type { Socket } from "node:net";
import { loadRootEnv } from "@mycellios/core/node/load-root-env";

loadRootEnv();

import { serve } from "@hono/node-server";
import { SERVICE_NAMES } from "@mycellios/logging";
import { createRootLogger } from "@mycellios/logging/axiom";
import { startEventLoopDelayReport } from "@mycellios/logging/event-loop";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const logger = createRootLogger(SERVICE_NAMES.api);

try {
  const env = loadEnv();
  const { app, stop, closeRelays } = await createApp({ ...env, logger });
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.apiHost }, () => {
    logger.info("api listening", { "http.host": env.apiHost, "http.port": env.port });
  });
  const stopEventLoopReport = startEventLoopDelayReport(logger);

  // Long-lived connections (threads.subscribe SSE streams) never end on their
  // own, so server.close() alone waits forever for them. Track sockets and
  // force-close any still open after a short grace period for in-flight
  // requests, or every restart/shutdown hangs until something force-kills it.
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    stopEventLoopReport();
    // Tell every open PC stream that the relay is restarting while its socket is still
    // up. Destroying the sockets first left workers with a bare transport error, so a
    // turn interrupted by a deploy read as a problem on the person's PC.
    closeRelays();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const grace = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, 2_000);
    await closed;
    clearTimeout(grace);
    await stop();
    await logger.flush({ timeoutMs: 2_000 });
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
} catch (error) {
  logger.error("api startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
}
