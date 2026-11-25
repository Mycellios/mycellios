import { logSinkHealth } from "@mycellios/logging";
import { Hono } from "hono";

/**
 * `/health` is public liveness, so it stays a constant body. Deployment details are for
 * operators on the API port; a reverse proxy adds forwarding headers, so a request that
 * carries them came through the public edge and gets no details. `/ready` adds only the
 * deployed revision, as the coordinator's public health does: Nucleus deploys check that the
 * new commit is the one being served. `/api/v1/status` is the public status page's read: the
 * same database probe and degraded flag as `/ready`, answered only as `ok` or `degraded`.
 */
export function healthRoutes(
  details: () => Record<string, unknown>,
  database?: () => Promise<unknown>,
) {
  const app = new Hono();
  // One probe at a time: polls during a hung check wait on it instead of taking more connections.
  let inFlight: Promise<boolean> | null = null;
  const probe = (check: () => Promise<unknown>) => {
    inFlight ??= Promise.resolve()
      .then(check)
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  app.get("/ready", async (c) => {
    const current = details();
    const degraded = current.degraded === true;
    const revision = typeof current.revision === "string" ? current.revision : null;
    const databaseUp = database ? await withinDeadline(probe(database)) : true;
    const ok = !degraded && databaseUp;
    return c.json(
      {
        ok,
        degraded,
        ...(revision ? { revision } : {}),
        ...(databaseUp ? {} : { database: "unreachable" }),
      },
      ok ? 200 : 503,
    );
  });
  // Anyone can call it, so callers share one database answer for a short while.
  let lastPublic: { at: number; up: boolean } | null = null;
  app.get("/api/v1/status", async (c) => {
    let up =
      lastPublic && Date.now() - lastPublic.at < PUBLIC_STATUS_REUSE_MS ? lastPublic.up : null;
    if (up === null) {
      up = database ? await withinDeadline(probe(database)) : true;
      lastPublic = { at: Date.now(), up };
    }
    const ok = up && details().degraded !== true;
    return c.json({ status: ok ? "ok" : "degraded" }, ok ? 200 : 503, {
      "cache-control": "no-store",
    });
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/internal/health", (c) => {
    if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return c.notFound();
    return c.json({ ok: true, ...details(), telemetry: logSinkHealth() });
  });
  return app;
}

export const DATABASE_CHECK_TIMEOUT_MS = 1500;
/** How long `/api/v1/status` reuses a database answer, so public reads cannot drive the probe rate. */
export const PUBLIC_STATUS_REUSE_MS = 10_000;

/** Readiness callers poll with short timeouts, so a hung database counts as unreachable. */
async function withinDeadline(check: Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
