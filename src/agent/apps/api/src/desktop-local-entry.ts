import { readFile } from "node:fs/promises";
import type { DesktopLocalConfig } from "./desktop-local-server.js";
import { startDesktopLocalServer } from "./desktop-local-server.js";

const file = process.env.RAKAZO_LOCAL_SERVER_CONFIG;
if (!file) throw new Error("Missing local server configuration");
const config = JSON.parse(await readFile(file, "utf8")) as DesktopLocalConfig;
type ParentPort = {
  postMessage: (message: unknown) => void;
  on: (name: "message", listener: (event: { data: unknown }) => void) => void;
};
const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort;
let stopRequested = false;
parentPort?.on("message", (event) => {
  if (event.data === "stop") stopRequested = true;
});
process.on("message", (message) => {
  if (message === "stop") stopRequested = true;
});
const server = await startDesktopLocalServer(config);
parentPort?.postMessage({ type: "ready", origin: server.origin });
process.send?.({ type: "ready", origin: server.origin });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
parentPort?.on("message", (event) => {
  if (event.data === "stop") void close();
});
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
process.on("message", (message) => {
  if (message === "stop") void close();
});
process.once("disconnect", () => void close());
if (stopRequested) void close();
