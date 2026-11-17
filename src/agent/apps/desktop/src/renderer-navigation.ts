import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage, Session } from "electron";

/** A top-level or frame document load, as opposed to a script's fetch or an asset. */
export function isDocumentRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination) return destination === "document" || destination === "iframe";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

type NetRequest = (options: ClientRequestConstructorOptions) => ClientRequest;

/**
 * Load a forwarded document without following its redirects here. A redirect
 * followed by `session.fetch` returns the final page under the original URL, so
 * the OAuth authorize navigation rendered the consent page without its
 * `authorization_id` ("This sign-in request has expired"). Electron's fetch
 * rejects `redirect: "manual"`, so documents use `net.request`, whose redirect
 * event gives the target, and the window receives a real redirect.
 */
export function forwardDocument(request: Request, session: Session, headers: Headers, netRequest: NetRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = netRequest({
      method: request.method, url: request.url, session, redirect: "manual",
      useSessionCookies: true, bypassCustomProtocolHandlers: true,
    } as ClientRequestConstructorOptions);
    headers.forEach((value, key) => {
      // Chromium owns connection-level headers; skip what net refuses to set.
      try { client.setHeader(key, value); } catch { /* forbidden header */ }
    });
    client.on("redirect", (status, _method, location) => {
      client.abort();
      resolve(new Response(null, { status, headers: { location } }));
    });
    client.on("response", (response: IncomingMessage) => {
      const out = new Headers();
      for (const [key, value] of Object.entries(response.headers))
        for (const item of ([] as string[]).concat(value)) out.append(key, item);
      const empty = response.statusCode === 204 || response.statusCode === 304;
      const body = empty ? null : new ReadableStream<Uint8Array>({
        start(controller) {
          response.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          response.on("end", () => controller.close());
          response.on("error", (error: Error) => controller.error(error));
        },
      });
      resolve(new Response(body, { status: response.statusCode, statusText: response.statusMessage, headers: out }));
    });
    client.on("error", reject);
    client.end();
  });
}
