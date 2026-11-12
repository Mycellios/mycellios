import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { isBuildId } from "@rakazo/contracts/client-build";
import { productBrand } from "@rakazo/contracts/product-brand";
import { webDarkTokens } from "@rakazo/ui-tokens";
import type { Plugin, Rolldown } from "vite";
import { build } from "esbuild";
import { CACHE_PREFIX } from "./service-worker.js";

const SERVICE_WORKER_FILE = "sw.js";
const MANIFEST_FILE = "site.webmanifest";
const PRECACHE_PLACEHOLDER = "__RAKAZO_SW_PRECACHE__";
const CACHE_PLACEHOLDER = "__RAKAZO_SW_CACHE__";

/** Keep shared browser helpers bundled into the classic worker, never split out. */
export async function buildClassicServiceWorker() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./sw.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    metafile: true,
  });
  if (result.outputFiles.length !== 1 ||
    Object.values(result.metafile.outputs).some(output => output.imports.length)) {
    throw new Error("The classic service worker must be one self-contained script.");
  }
  const code = result.outputFiles[0]!.text;
  // Parsing as a classic script rejects accidentally emitted module syntax.
  new Script(code, { filename: SERVICE_WORKER_FILE });
  return { code, inputs: Object.keys(result.metafile.inputs).map(input => resolve(input)) };
}

export function webManifest(base = "/") {
  const icons = [192, 512].map((size) => ({
    src: `${base}mycellios/app-icon-v2-${size}.png?brand=3`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any",
  }));
  return {
    id: base,
    name: productBrand.name,
    short_name: productBrand.shortName,
    description: "Think, create, and get things done with Mycellios Agent.",
    start_url: `${base}app`,
    shortcuts: [{
      name: "Voice message",
      short_name: "Voice",
      description: "Dictate a message to your Mico, then choose Send.",
      url: `${base}app?dictate=1`,
      icons,
    }],
    scope: base,
    display: "standalone",
    background_color: webDarkTokens.background,
    theme_color: webDarkTokens.background,
    icons: [
      ...icons,
      {
        src: `${base}mycellios/app-icon-v2-maskable.png?brand=3`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/**
 * Everything the first screen needs offline: the HTML shell, the entry's static
 * import graph, stylesheets and fonts. Lazy chunks are cached as they load.
 */
export function shellFiles(bundle: Rolldown.OutputBundle): string[] {
  const files = new Set(["/"]);
  const visit = (fileName: string) => {
    const chunk = bundle[fileName];
    if (chunk?.type !== "chunk" || files.has(`/${fileName}`)) return;
    files.add(`/${fileName}`);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(`/${css}`);
    chunk.imports.forEach(visit);
  };
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk" && output.isEntry && output.fileName !== SERVICE_WORKER_FILE) {
      visit(output.fileName);
    }
    if (output.type === "asset" && /\.(css|woff2)$/.test(output.fileName)) {
      files.add(`/${output.fileName}`);
    }
  }
  return [...files].sort();
}

/** The cache is named after the build, the same id `/build-id` and every API request carry. */
export function injectShell(code: string, precache: readonly string[], buildId: string): string {
  if (!isBuildId(buildId)) throw new Error(`Expected a build id, got "${buildId}".`);
  const cacheName = `${CACHE_PREFIX}${buildId}`;
  let injected = code;
  for (const [placeholder, value] of [
    [PRECACHE_PLACEHOLDER, precache],
    [CACHE_PLACEHOLDER, cacheName],
  ] as const) {
    const parts = injected.split(placeholder);
    if (parts.length !== 2) throw new Error(`Expected one ${placeholder} in the service worker.`);
    injected = parts.join(JSON.stringify(value));
  }
  return injected;
}

/** Installable PWA shell: the web manifest and the service worker. */
export function rakazoPwa(buildId: string, base = "/"): Plugin[] {
  const manifest = () => JSON.stringify(webManifest(base), null, 2);
  let workerCode: string | undefined;
  return [
    {
      name: "rakazo-pwa-manifest",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?", 1)[0] !== `/${MANIFEST_FILE}`) {
            next();
            return;
          }
          res.setHeader("content-type", "application/manifest+json; charset=utf-8");
          res.end(manifest());
        });
      },
    },
    {
      name: "rakazo-pwa-service-worker",
      apply: "build",
      enforce: "post",
      async buildStart() {
        const worker = await buildClassicServiceWorker();
        workerCode = worker.code;
        worker.inputs.forEach(input => this.addWatchFile(input));
      },
      generateBundle(_options, bundle) {
        this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: manifest() });
        const html = bundle["index.html"];
        if (html?.type !== "asset") this.error("The index.html shell was not emitted.");
        if (workerCode === undefined) this.error("The classic service worker was not built.");
        let code = injectShell(
          workerCode,
          shellFiles(bundle).map((path) => `${base}${path.slice(1)}`),
          buildId,
        );
        if (base !== "/")
          code = code.replace(
            `${CACHE_PREFIX}${buildId}`,
            `${CACHE_PREFIX}${base.slice(1, -1)}-${buildId}`,
          );
        this.emitFile({ type: "asset", fileName: SERVICE_WORKER_FILE, source: code });
      },
    },
  ];
}
