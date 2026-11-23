import { resolve } from "node:path";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { resolveNodeSourceRevision } from "./build-identity.js";

// Staged `node-app` canary. The updater runs this file from the candidate root
// before the active pointer changes. It must not start a worker, open sockets or
// read request data: it proves the candidate loads with its own dependencies
// and carries release provenance bound to the signed manifest revision.
// Keep in sync with NODE_APP_CANARY_MARKER in component-lifecycle.ts.
const NODE_APP_CANARY_MARKER = "MYCELLIOS_NODE_APP_CANARY_OK";

const root = resolve(import.meta.dirname, "../..");
const expectedRevision = process.argv[2];
const metadata = readNativeRuntimeBuildMetadata(root);
if (!metadata.buildIdentity) throw new Error("node_app_canary_provenance_missing");
const revision = await resolveNodeSourceRevision({}, (() => {
  throw new Error("node_app_canary_manifest_missing");
}) as never);
if (expectedRevision && expectedRevision !== "-" && revision !== expectedRevision) {
  throw new Error("node_app_canary_revision_mismatch");
}
await import("../worker/agent.js");
await import("../worker/headless-runtime.js");
await import("./command-applicator.js");
await import("./component-lifecycle.js");
await import("./memory-embedding-replica.js");
await import("./service-host.js");
process.stdout.write(`${NODE_APP_CANARY_MARKER}\n`);
