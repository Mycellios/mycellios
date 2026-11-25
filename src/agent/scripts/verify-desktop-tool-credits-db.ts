import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { provisionRuntimeRole } from "@mycellios/db";

const root = fileURLToPath(new URL("../", import.meta.url));
const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", resolve);
});
const address = listener.address();
if (!address || typeof address === "string") throw new Error("Unable to allocate a local PostgreSQL port");
const { port } = address;
await new Promise(resolve => listener.close(resolve));

const directory = await mkdtemp(join(tmpdir(), "mycellios-desktop-credits-"));
const ownerPassword = randomBytes(24).toString("hex");
const runtimePassword = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({
  databaseDir: join(directory, "pg"), port, user: "postgres", password: ownerPassword,
  persistent: true, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {},
});
const databaseUrl = `postgresql://postgres:${ownerPassword}@127.0.0.1:${port}/postgres`;
const runtimeUrl = `postgresql://desktop_tool_app:${runtimePassword}@127.0.0.1:${port}/postgres`;
const env = {
  ...process.env, MYCELLIOS_ISOLATED_DATABASE: "1", NODE_ENV: "test", CONTENT_ENCRYPTION: "off",
  DATABASE_URL: runtimeUrl, DATABASE_MIGRATION_URL: databaseUrl, VERIFY_DATABASE: "1",
};
function execute(args: string[]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Isolated desktop model credit check failed (${result.status ?? result.signal})`);
}

let started = false;
try {
  await postgres.initialise();
  await postgres.start();
  started = true;
  execute(["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "packages/db/prisma.config.ts"]);
  const { warning } = await provisionRuntimeRole(databaseUrl, runtimeUrl);
  if (warning) throw new Error(warning);
  execute(["node_modules/vitest/vitest.mjs", "run", "--maxWorkers", "1",
    "packages/db/src/model-credits.postgres.test.ts"]);
} finally {
  if (started) await postgres.stop();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
