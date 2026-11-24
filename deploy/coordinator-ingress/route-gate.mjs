import { createServer } from "node:http";
import { chmod, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseGate, hostname } from "./route-state.mjs";

const [directory] = process.argv.slice(2);
if (!directory || !isAbsolute(directory)) throw new Error("absolute route directory required");
const socket = join(directory, "gate.sock");
let statusRead;
let waiting = 0;

async function state() {
  statusRead ??= readState().finally(() => { statusRead = undefined; });
  return statusRead;
}

async function readState() {
  return parseGate(await readFile(join(directory, "gate.json"), "utf8"));
}

const server = createServer(async (request, response) => {
  if (request.url === "/state" && request.method === "GET") {
    try {
      const current = await state();
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(current));
    } catch { response.destroy(); }
    return;
  }
  if (request.url !== "/route" || request.method !== "GET") {
    response.writeHead(404).end();
    return;
  }
  if (waiting >= 256) {
    response.writeHead(503).end();
    return;
  }
  waiting += 1;
  try {
    const expires = performance.now() + 10_000;
    while (!response.destroyed && performance.now() < expires) {
      const { revision, hold } = await state();
      if (hold === null) {
        response.writeHead(204, { "X-Mycellios-Backend": hostname(revision) + ":4174", "Cache-Control": "no-store" }).end();
        return;
      }
      await setTimeout(40);
    }
    if (!response.destroyed) response.writeHead(503).end();
  } catch {
    if (!response.destroyed) response.writeHead(503).end();
  } finally {
    waiting -= 1;
  }
});

// One registered gate owns this directory. Fail rather than unlinking another
// server's socket or turning a missing socket into admission.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socket, resolve);
});
await chmod(socket, 0o666);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => { void unlink(socket).catch(() => {}); });
  });
}
