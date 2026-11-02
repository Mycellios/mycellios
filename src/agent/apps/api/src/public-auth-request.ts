/** Reconstruct the configured public auth path after the application proxy strips its namespace. */
export function publicAuthRequest(request: Request, authUrl: string): Request {
  const configured = new URL(authUrl);
  const base = configured.pathname.replace(/\/$/, "");
  if (!base || base === "/api/auth") return request;
  if (!base.endsWith("/api/auth")) throw new Error("Auth URL path must end with /api/auth");
  const incoming = new URL(request.url);
  incoming.pathname = `${base}${incoming.pathname.slice("/api/auth".length)}`;
  return new Request(incoming, request);
}
