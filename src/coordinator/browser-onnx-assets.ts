import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
/** Serve only runtime-owned assets from the installed, lockfile-pinned ORT package. */
export function browserOnnxAssets(app: FastifyInstance) {
  const allowed = new Set(["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]);
  const root = new URL("./", import.meta.resolve("onnxruntime-web"));
  app.get("/browser/ort/:file", async (request, reply) => {
    const file = (request.params as { file: string }).file;
    if (!allowed.has(file)) return reply.code(404).send();
    return reply.header("cache-control", "public, max-age=3600").type(file.endsWith(".wasm") ? "application/wasm" : "text/javascript")
      .send(await readFile(new URL(file, root)));
  });
}
