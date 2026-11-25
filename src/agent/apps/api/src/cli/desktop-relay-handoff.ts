// `node dist/cli/desktop-relay-handoff.js status|start|cancel`, run inside an API container:
// the deployment's handoff of the Desktop relay to a new API version. It asks this
// container's own API (see /internal/desktop-relay/handoff in desktop-relay.ts), signed with
// the relay key the worker uses, and prints that instance's state as one JSON line. Exits 0
// only when the API answered the request.
import { loadRootEnv } from "@mycellios/core/node/load-root-env";
import { resolveScreenProxySecret } from "@mycellios/core";
import { desktopRelayKey, signDesktopRelay } from "../../../../packages/adapters/src/desktop-relay.js";

loadRootEnv();
const action = process.argv[2];
if (action !== "status" && action !== "start" && action !== "cancel") {
  process.stderr.write("Usage: desktop-relay-handoff.js status|start|cancel\n");
  process.exit(2);
}
const configuredHost = process.env.API_HOST?.trim();
// A wildcard listener answers on loopback; a specific address is asked directly.
const host = !configuredHost || configuredHost === "0.0.0.0" || configuredHost === "::" ? "127.0.0.1" : configuredHost;
const url = new URL("/internal/desktop-relay/handoff", `http://${host.includes(":") ? `[${host}]` : host}:${Number(process.env.API_PORT ?? 3100)}`);
const body = JSON.stringify({ action });
const timestamp = String(Date.now());
const key = desktopRelayKey(resolveScreenProxySecret(process.env));
try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-desktop-time": timestamp,
      "x-desktop-signature": signDesktopRelay(key, timestamp, body),
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  process.stdout.write(`${text.trim()}\n`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`The API did not answer: ${error instanceof Error ? error.name : "unknown error"}\n`);
  process.exit(1);
}
