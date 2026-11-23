import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Content-Security-Policy for every coordinator response.
 *
 * Scripts may only come from this origin or be one of the inline scripts that
 * ship inside the served HTML files (allowed by hash). Injected inline scripts,
 * inline event handlers, javascript: URLs and third-party script hosts (except
 * the edge analytics beacon below) are
 * refused. `unsafe-eval`/`wasm-unsafe-eval` stay allowed because the browser
 * contribution runtime (ONNX Runtime WebGPU/WASM, Emscripten embind) compiles
 * WebAssembly and generates small method wrappers at runtime.
 */
const BASE_DIRECTIVES = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
// The Cloudflare edge in front of www.mycellios.com injects its Web Analytics beacon
// into every page; it is the only third-party script host allowed. The beacon reports
// to cloudflareinsights.com, which needs no rule while this policy sets no connect-src.
const EDGE_ANALYTICS_SCRIPT = "https://static.cloudflareinsights.com";
const SCRIPT_SOURCES = `'self' 'unsafe-eval' 'wasm-unsafe-eval' ${EDGE_ANALYTICS_SCRIPT}`;
const WORKER_SOURCES = "'self' blob:";
const MAX_HTML_FILES = 5_000;
const RECHECK_INTERVAL_MS = 30_000;
const EXECUTABLE_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);

/** sha256 sources for each executable inline script in an HTML document. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes) || body.length === 0) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase() ?? "";
    if (!EXECUTABLE_TYPES.has(type)) continue; // data blocks such as JSON-LD never execute
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function contentSecurityPolicy(scriptHashes: Iterable<string> = []): string {
  const scripts = [SCRIPT_SOURCES, ...new Set(scriptHashes)].join(" ");
  return `${BASE_DIRECTIVES}; script-src ${scripts}; worker-src ${WORKER_SOURCES}`;
}

function collectHtmlHashes(root: string, into: Set<string>, budget: { files: number }): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.files <= 0) return;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectHtmlHashes(path, into, budget);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      budget.files -= 1;
      try {
        for (const hash of inlineScriptHashes(readFileSync(path, "utf8"))) into.add(hash);
      } catch {
        // An unreadable page cannot be served either.
      }
    }
  }
}

function rootFingerprint(root: string): string {
  try {
    return String(statSync(join(root, "index.html")).mtimeMs);
  } catch {
    return "missing";
  }
}

/**
 * Builds the header from the HTML in the served asset roots. Releases replace
 * the asset directory, so the scan is redone when a root's index.html changes.
 */
export class ContentSecurityPolicyHeader {
  private readonly roots: string[] = [];
  private fingerprint = "";
  private value = contentSecurityPolicy();
  private checkedAt = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  addRoot(root: string | null | undefined): void {
    if (!root) return;
    this.roots.push(resolve(root));
    this.checkedAt = 0;
  }

  header(): string {
    const now = this.now();
    if (this.roots.length === 0 || now - this.checkedAt < RECHECK_INTERVAL_MS) return this.value;
    this.checkedAt = now;
    const fingerprint = this.roots.map((root) => `${root}:${rootFingerprint(root)}`).join("|");
    if (fingerprint !== this.fingerprint) {
      const hashes = new Set<string>();
      const budget = { files: MAX_HTML_FILES };
      for (const root of this.roots) collectHtmlHashes(root, hashes, budget);
      this.value = contentSecurityPolicy(hashes);
      this.fingerprint = fingerprint;
    }
    return this.value;
  }
}
