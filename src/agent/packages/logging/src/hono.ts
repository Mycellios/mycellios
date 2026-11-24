import type { MiddlewareHandler } from "hono";
import { getLogContext } from "./context.js";
import { correlationBindings, establishRequestCorrelation } from "./correlation.js";
import { formatTraceparent } from "./ids.js";
import { getLogger } from "./logger.js";
import type { Logger } from "./types.js";

export function requestLogging(logger?: Logger): MiddlewareHandler {
  return async (c, next) => {
    const log = logger ?? getLogger();
    const correlation = establishRequestCorrelation({
      requestId: c.req.header("x-request-id"),
      traceparent: c.req.header("traceparent"),
    });
    c.header("x-request-id", correlation.requestId);
    c.header("traceparent", formatTraceparent(correlation.traceId, correlation.spanId));
    const started = performance.now();
    return log.withContext(correlationBindings(correlation), async () => {
      let thrown: unknown;
      try {
        await next();
      } catch (error) {
        thrown = error;
        if (!c.error) throw error;
      } finally {
        const failure = c.error ?? thrown;
        if (failure) log.error("http.request.failed", failure);
        const status = failure && c.res.status < 400 ? 500 : c.res.status;
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        const route = matchedRoute(c.req.path, c.req.routePath);
        const procedure = rpcProcedure(c.req.path, route);
        log[level]("http.request.completed", {
          // Completion records stay searchable without creating a second collector issue.
          "error.report": !failure && !getLogContext()["error.reported"],
          "http.method": c.req.method,
          "http.route": route,
          ...(procedure ? { "rpc.procedure": procedure } : {}),
          "http.status": status,
          "http.duration_ms": Math.round(performance.now() - started),
        });
      }
    });
  };
}

function matchedRoute(path: string, routePath: string): string {
  if (routePath && routePath !== "/*") return routePath;
  return path;
}

const RPC_PROCEDURE_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The procedure behind an `/rpc/*` route, such as `threads/snapshot`, so slow or costly
 * calls can be told apart. Only procedure-shaped names are kept; anything else (ids,
 * encoded values, unexpected paths) is left out rather than logged.
 */
function rpcProcedure(path: string, route: string): string | undefined {
  if (!route.endsWith("/rpc/*")) return undefined;
  const prefix = route.slice(0, -1);
  const at = path.indexOf(prefix);
  if (at === -1) return undefined;
  const segments = path.slice(at + prefix.length).split("/").filter(Boolean);
  if (!segments.length || segments.length > 3) return undefined;
  return segments.every((segment) => RPC_PROCEDURE_SEGMENT.test(segment))
    ? segments.join("/")
    : undefined;
}
