import { resolve } from "node:path";
import { loadCoordinatorConfig } from "../core/config.js";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { checkReleaseStandbyDatabase, createReleaseStandby } from "./release-standby.js";

const { revision } = readNativeRuntimeBuildMetadata(resolve(import.meta.dirname, "../.."));
if (!revision) throw new Error("release_standby_revision_required");
const config = loadCoordinatorConfig();
const { databaseUrl, databaseSchema } = config;
if (config.storageBackend !== "postgres" || !databaseUrl) {
  throw new Error("release_standby_postgres_required");
}

// Opening the PostgreSQL adapter checks the schema with SELECT only. The
// standby never constructs the coordinator runtime or starts recovery.
const app = createReleaseStandby(revision, () => checkReleaseStandbyDatabase(databaseUrl, databaseSchema));
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
