import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Collect diagnostics from each affected surface before changing code. No full test suite.
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, ".cache", "workspace-types");
mkdirSync(cache, { recursive: true });
let failed = false;
for (const name of ["web", "api", "worker", "desktop"]) {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--incremental",
    "--tsBuildInfoFile", path.join(cache, `${name}.tsbuildinfo`),
    "-p", path.join(root, `apps/${name}/tsconfig.json`),
  ], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  console.log(`${name} incremental types: ${result.status === 0 ? "PASS" : "FAIL"}`);
  failed ||= result.status !== 0;
}
process.exitCode = failed ? 1 : 0;
