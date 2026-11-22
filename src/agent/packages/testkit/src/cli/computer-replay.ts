import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@mycellios/core/node/load-root-env";

/** Offline by default. Only explicit --live --record loads a model key for a manual capture. */
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const imageArg = process.argv.slice(2).find((arg) => arg.startsWith("--image="));
  const subnetArg = process.argv.slice(2).find((arg) => arg.startsWith("--subnet="));
  const recordArg = process.argv.slice(2).find((arg) => arg.startsWith("--record="));
  const live = process.argv.includes("--live");
  const isolated = process.argv.includes("--isolated");
  const outputArg = process.argv.slice(2).find(arg => arg.startsWith("--output="));
  const supervisorImageArg = process.argv.slice(2).find(arg => arg.startsWith("--supervisor-image="));
  if (isolated && (live || recordArg)) throw new Error("--isolated is offline only; --live and --record are forbidden");
  if (outputArg && (!isolated || outputArg === "--output=")) throw new Error("--output=<directory> requires --isolated");
  if (isolated && subnetArg) throw new Error("--isolated creates two private networks; a single --subnet is not supported");
  if (supervisorImageArg && (!isolated || supervisorImageArg === "--supervisor-image=")) throw new Error("--supervisor-image=<image> requires --isolated");
  if (Boolean(recordArg) !== live || recordArg === "--record=") {
    throw new Error("A paid recording requires both --live and --record=<new-fixture.json>");
  }
  const unknown = process.argv
    .slice(2)
    .filter(
      (arg) =>
        !arg.startsWith("--image=") &&
        !arg.startsWith("--subnet=") &&
        !arg.startsWith("--record=") &&
        !arg.startsWith("--output=") &&
        !arg.startsWith("--supervisor-image=") &&
        arg !== "--live" && arg !== "--isolated",
    );
  if (unknown.length)
    throw new Error(
      "Usage: computer-replay.ts [--image=rakazo/computer:local] [--subnet=unused-private-CIDR] [--live --record=new-fixture.json] | --isolated [--image=...] [--supervisor-image=...] [--output=directory]",
    );
  const image = imageArg?.slice("--image=".length) || "rakazo/computer:local";
  let captureKey: string | undefined;
  if (live) {
    loadRootEnv();
    captureKey = process.env.OPENROUTER_API_KEY;
    if (!captureKey) throw new Error("OPENROUTER_API_KEY is required for a live recording");
  }
  execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
  const supervisorImage = supervisorImageArg?.slice("--supervisor-image=".length) ?? "mycellios/supervisor:isolated-test";
  if (isolated) execFileSync("docker", ["image", "inspect", supervisorImage], { stdio: "ignore" });
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-computer-replay-"));
  // Retain only local process/Docker discovery settings. In particular, do not
  // inherit provider, telemetry, proxy credentials, or the maintainer's data dir.
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "XDG_RUNTIME_DIR",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    RUN_COMPUTER_REPLAY_DOCKER: "1",
    DATA_DIR: path.join(directory, "data"),
    RAKAZO_COMPUTER_IMAGE: image,
    SANDBOX_SUPERVISOR_TOKEN: "computer-replay-fixture-token-32chars",
    SANDBOX_SCREEN_NETWORK: "published",
    SANDBOX_SCREEN_HOST: "127.0.0.1",
    SANDBOX_CONTROL_VIA_LOOPBACK: "true",
    LOG_LEVEL: "off",
    ...(isolated ? {
      RUN_ISOLATED_COMPUTERS_DOCKER: "1",
      RAKAZO_PROJECT_LOCAL: "1",
      // The fixture creates owned --internal networks itself. Do not probe or
      // change host firewall policy; Docker's internal network blocks egress.
      SANDBOX_COMPUTER_EGRESS: "open",
      ISOLATED_COMPUTERS_SUPERVISOR_IMAGE: supervisorImage,
      ISOLATED_COMPUTERS_OUTPUT: outputArg ? path.resolve(outputArg.slice("--output=".length)) : path.join(directory, "proof"),
    } : {}),
    ...(subnetArg ? { COMPUTER_REPLAY_SUBNET: subnetArg.slice("--subnet=".length) } : {}),
    ...(recordArg
      ? {
          COMPUTER_RECORD_OUTPUT: path.resolve(recordArg.slice("--record=".length)),
          OPENROUTER_API_KEY: captureKey,
        }
      : {}),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--root",
          root,
          ...(isolated ? ["packages/testkit/src/isolated-computers.docker.test.ts"] : [
            "packages/testkit/src/computer-replay.docker.test.ts",
            "packages/testkit/src/computer-user.docker.test.ts",
          ]),
        ],
        {
          env,
          cwd: directory,
          stdio: "inherit",
        },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Computer replay failed (exit ${code})`)),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
