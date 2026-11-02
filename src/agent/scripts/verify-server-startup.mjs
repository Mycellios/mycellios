#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Evaluate every static production import without credentials, listeners or DB access.
const root = fileURLToPath(new URL("../", import.meta.url));
for (const surface of ["api", "worker"]) {
  const result = spawnSync(process.execPath, [`apps/${surface}/dist/index.js`], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      NODE_ENV: "test",
      RAKAZO_PROJECT_LOCAL: "1",
      AUTH_SECRET: "server-startup-verification-secret-without-account-access",
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.error, undefined, `${surface}: ${result.error?.message}`);
  assert.equal(result.status, 1, `${surface}: expected the missing-database guard, got ${result.status}\n${output}`);
  assert.match(output, /(?:Missing DATABASE_URL|DATABASE_URL is required)/, `${surface}: module evaluation failed before the configuration guard\n${output}`);
  console.log(`${surface}: compiled modules evaluated; missing database rejected before startup`);
}
