// `npm run db:migrate`: schema migrations, the job queue schema, then the runtime
// login. Everything here runs as the migration (owner) role; the API and worker
// then connect with DATABASE_URL and only get the runtime grants.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { migrateJobQueue } from "@rakazo/adapters";
import { loadRootEnv } from "@rakazo/core/node/load-root-env";
import {
  databaseUrls,
  provisionRuntimeRole,
  RUNTIME_ROLE,
  SINGLE_DATABASE_URL_WARNING,
} from "@rakazo/db";

loadRootEnv();
const urls = databaseUrls(process.env);
const require = createRequire(import.meta.url);
const prismaCli = path.join(path.dirname(require.resolve("prisma/package.json")), "build", "index.js");
const dbPackage = path.resolve(import.meta.dirname, "../../../../packages/db");
execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--config", path.join(dbPackage, "prisma.config.ts")], {
  cwd: dbPackage,
  stdio: "inherit",
  env: { ...process.env, DATABASE_MIGRATION_URL: urls.migrationUrl },
});
await migrateJobQueue(urls.migrationUrl);

if (!urls.separate) {
  process.stderr.write(`WARNING: ${SINGLE_DATABASE_URL_WARNING}\n`);
} else {
  const { warning } = await provisionRuntimeRole(urls.migrationUrl, urls.url);
  if (warning) process.stderr.write(`WARNING: ${warning}\n`);
  else process.stdout.write(`Runtime login is ready (member of ${RUNTIME_ROLE}).\n`);
}
