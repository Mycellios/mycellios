import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  CSP_REPORTING_ENDPOINTS,
  appContentSecurityPolicy,
  contentSecurityPolicyFor,
} from "@rakazo/contracts/content-security-policy";
import { firstPartyRendererTarget, servesBundledRenderer } from "./setup-config.js";

const PASSTHROUGH_PATHS = ["/api", "/rpc", "/novnc", "/auth"];

/** Choose the UI shipped by this version after an older private override expires. */
export async function resolvePackagedRenderer(input: {
  userData: string; resources: string; targetUrl: string; nativeVersion: string; managedLocalStack: boolean;
}) {
  const localRoot = await localRendererOverride(input.userData, input.targetUrl, input.nativeVersion);
  if (!localRoot && !servesBundledRenderer(input.targetUrl, input.managedLocalStack)) return null;
  const firstParty = firstPartyRendererTarget(input.targetUrl);
  return {
    root: localRoot ?? path.join(input.resources,"web",...(firstParty?["first-party"]:[])),
    basePath: localRoot || firstParty ? "/agent" : "",
    local: Boolean(localRoot), firstParty,
  };
}

/** Owner-configured local UI, with the real first-party origin/session left intact. */
export async function localRendererOverride(userData: string, targetUrl: string, nativeVersion: string) {
  const target = new URL(targetUrl);
  if (target.origin !== "https://www.mycellios.com" || target.username || target.password || !matchesPrefix(target.pathname, "/agent")) return null;
  const preference = path.join(userData, "local-renderer.json");
  let value: { schema?: unknown; directory?: unknown; nativeVersion?: unknown };
  try {
    const info = await lstat(preference);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("Invalid local frontend preference");
    value = JSON.parse(await readFile(preference, "utf8"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (value.nativeVersion !== nativeVersion) return null;
  if (value.schema !== "mycellios-local-renderer/1" || typeof value.directory !== "string" || !/^local-web\/[a-f0-9]{64}$/.test(value.directory)) throw new Error("Invalid local frontend preference");
  // Windows package filesystem virtualization can canonicalize this child
  // differently from its existing profile parent. Anchor to the fixed private
  // asset directory itself, while rejecting a user-created symlink/junction.
  const localAssets = path.join(userData, "local-web");
  const baseInfo = await lstat(localAssets);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error("Invalid local frontend directory");
  const profile = await realpath(localAssets);
  const root = await realpath(path.join(userData, value.directory));
  if (!root.startsWith(profile + path.sep)) throw new Error("Local frontend must stay inside the application profile");
  const index = await realpath(path.join(root, "index.html"));
  if (!index.startsWith(root + path.sep)) throw new Error("Local frontend index escaped its profile");
  const html = await readFile(index, "utf8");
  if (!html.includes('/agent/assets/')) throw new Error("Local frontend must use the Mycellios Agent namespace");
  return root;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function bundledRendererCandidates(
  root: string,
  requestUrl: string,
  webOrigin: string,
  acceptsHtml: boolean,
  basePath = "",
) {
  const url = new URL(requestUrl);
  if (
    url.origin !== webOrigin
  ) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  if (basePath) {
    if (!matchesPrefix(pathname, basePath)) return null;
    pathname = pathname.slice(basePath.length) || "/";
  }
  if (PASSTHROUGH_PATHS.some((prefix) => matchesPrefix(pathname, prefix))) return null;

  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = safeChild(root, requested);
  if (!candidate) return null;
  return acceptsHtml ? [candidate, path.join(root, "index.html")] : [candidate];
}

export function contentType(file: string) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export function immutableRendererAsset(file: string) {
  return path.basename(path.dirname(file)) === "assets";
}

/** The headers the web server would send, including its CSP, since this replaces that server. */
export function bundledRendererHeaders(file: string, requestUrl: string, managedLocalStack = false): Headers {
  const headers = new Headers({
    "cache-control": immutableRendererAsset(file)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "content-type": contentType(file),
    "x-content-type-options": "nosniff",
  });
  const policy = contentSecurityPolicyFor(new URL(requestUrl).pathname,
    appContentSecurityPolicy({ localProjectPreview: managedLocalStack }));
  if (policy) {
    headers.set("content-security-policy", policy);
    // Reports go to /api on this origin, which is forwarded to the API like every other call.
    headers.set("reporting-endpoints", CSP_REPORTING_ENDPOINTS);
  }
  return headers;
}

export function isRendererAssetMiss(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR";
}

export function forwardedRendererRequestInit(request: Request, webOrigin: string) {
  const init: RequestInit & { bypassCustomProtocolHandlers: boolean } = {
    bypassCustomProtocolHandlers: true,
    credentials: "include",
  };
  if (new URL(request.url).origin !== webOrigin) return init;
  const headers = new Headers(request.headers);
  // The native relay deliberately has no browser Origin. Preserve browser
  // origins so a renderer cannot turn itself into a native caller.
  if (new URL(request.url).pathname.startsWith("/agent/api/desktop-relay/") &&
      headers.get("x-mycellios-desktop") === "1" && !headers.has("origin"))
    return { ...init, headers };
  headers.set("origin", webOrigin);
  return { ...init, headers };
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function safeChild(root: string, requested: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}
