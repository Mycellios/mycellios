import { createHash } from "node:crypto";
import { HOSTED_WEB_LIMITS, HostedWebBundle, HOSTED_WEB_COVER_FILES } from "@rakazo/contracts";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
};
export function staticFileType(path: string): string | undefined {
  return TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
}
export function staticFilePath(path: string): boolean {
  return (
    path.length <= 240 &&
    !path.startsWith("_versions/") &&
    path
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) &&
          part !== "." &&
          part !== ".." &&
          !["node_modules", "private", "secrets"].includes(part.toLowerCase()),
      ) &&
    Boolean(staticFileType(path))
  );
}
/** Validate at every admission, never trust a browser filename or a saved JSON cast. */
export function admitStaticBundle(raw: unknown) {
  const parsed = HostedWebBundle.parse(raw);
  const paths = new Set<string>();
  let bytes = 0;
  let covers = 0;
  const files = parsed.files
    .map((file) => {
      if (!staticFilePath(file.path) || paths.has(file.path.toLowerCase()))
        throw new Error("Invalid or duplicate static file path.");
      paths.add(file.path.toLowerCase());
      if (
        file.base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)
      )
        throw new Error("Invalid file encoding.");
      const body = Buffer.from(file.base64, "base64");
      if (body.toString("base64") !== file.base64) throw new Error("Invalid file encoding.");
      if(Object.values(HOSTED_WEB_COVER_FILES).some(path=>path===file.path)) {
        covers++;
        const valid=file.path.endsWith(".png")?body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
          file.path.endsWith(".jpg")?body[0]===255&&body[1]===216&&body[2]===255:
          body.toString("ascii",0,4)==="RIFF"&&body.toString("ascii",8,12)==="WEBP";
        if(covers>1||!valid)throw new Error("La app admite una sola carátula PNG, JPG o WebP válida.");
      }
      bytes += body.byteLength;
      if (body.byteLength > HOSTED_WEB_LIMITS.fileBytes || bytes > HOSTED_WEB_LIMITS.totalBytes)
        throw new Error("Static website exceeds its size limit.");
      // Secrets and build configuration have no place in a public static bundle.
      if (
        /\.(?:json|txt|html|css|m?js)$/i.test(file.path) &&
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-proj-|sk-ant-api03-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/.test(
          body.toString("utf8"),
        )
      )
        throw new Error("Remove credentials before uploading this website.");
      return { path: file.path, base64: file.base64 };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (!files.some((file) => file.path === "index.html"))
    throw new Error("The website needs an index.html at its root.");
  const bundle = { files };
  const digest = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return { bundle, digest, bytes };
}

/** Response header is mandatory even for top-level navigation, SVG and JS assets. */
export const STATIC_WEB_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src https:",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors *",
].join("; ");

export function staticResponse(body: BodyInit | null, type: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": type,
      "Content-Security-Policy": STATIC_WEB_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
