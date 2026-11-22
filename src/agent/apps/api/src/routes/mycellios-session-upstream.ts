import { ORPCError } from "@orpc/server";
import { productBrand } from "@mycellios/contracts";
import { readBoundedJsonResponse } from "@mycellios/core";
import type * as z from "zod";
import type { RouterContext } from "./context.js";

const REQUEST_TIMEOUT_MS = 15_000;

export function upstreamError(status: number): ORPCError<string, unknown> {
  if (status === 401) return new ORPCError("UNAUTHORIZED");
  if (status === 403) return new ORPCError("FORBIDDEN");
  if (status === 404 || status === 501) return new ORPCError("PRECONDITION_FAILED");
  if (status === 409) return new ORPCError("CONFLICT");
  if (status === 429) return new ORPCError("TOO_MANY_REQUESTS");
  return new ORPCError("SERVICE_UNAVAILABLE");
}

type UpstreamInit = {
  method: "GET" | "POST" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
};

/**
 * Account calls to the Mycellios API made with the signed-in user's own Mycellios
 * session. The session token is read on the server for each call and never leaves it;
 * upstream bodies are bounded and their diagnostics are never forwarded.
 */
export function mycelliosSessionUpstream(deps: RouterContext["deps"]) {
  async function sessionToken(headers: Headers | undefined, userId: string) {
    if (!deps.env.mycelliosSso || !headers) throw new ORPCError("PRECONDITION_FAILED");
    const token = await deps.auth.oidcAccessToken(headers, userId);
    if (!token) throw new ORPCError("UNAUTHORIZED");
    return token;
  }

  async function call(token: string, path: string, init: UpstreamInit, signal?: AbortSignal) {
    const deadline = AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
    let response: Response;
    try {
      response = await (deps.modelConnectionFetch ?? fetch)(`${productBrand.apiBaseUrl}${path}`, {
        method: init.method,
        redirect: "error",
        cache: "no-store",
        signal: deadline,
        headers: {
          ...init.headers,
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw upstreamError(response.status);
    }
    return { response, deadline };
  }

  /** One bounded GET or POST whose JSON must match `schema`; anything else is unavailable. */
  async function json<T>(
    token: string,
    path: string,
    init: UpstreamInit,
    schema: z.ZodType<T>,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const { response, deadline } = await call(token, path, init, signal);
    try {
      return schema.parse(await readBoundedJsonResponse<unknown>(response, maxBytes, deadline));
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
  }

  function ownedBy(expectedUserId: string, userId: string) {
    if (expectedUserId !== userId) throw new ORPCError("FORBIDDEN");
  }

  return { sessionToken, call, json, ownedBy };
}
