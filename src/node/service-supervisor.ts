import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  bundledNodeAppLaunch,
  NODE_APP_HEALTH_DEADLINE_MS,
  NODE_BOOTSTRAP_ROOT_ENV,
  nodeAppActivationPending,
  planNodeAppLaunch,
  rollbackUnhealthyNodeApp,
  type NodeAppLaunch,
} from "./node-app-launch.js";

// WinSW 2.12 cannot mark a cleanly exited child as stopped under LocalService.
// Keep its managed process alive and restart the node child after a planned
// configuration reload or an unexpected exit.
//
// This bundled supervisor is also the update bootstrap: it launches the
// verified active `node-app` component when one exists, and restores the last
// verified app (or the bundled one) when a new app fails boot health. Logs carry
// only content-free codes.
const supervisorDirectory = import.meta.dirname;
const bootstrapRoot = bundledNodeAppLaunch(supervisorDirectory).cwd;
const configPath = argument("--config");
const waitAbort = new AbortController();
let stopping = false;
let child: ChildProcess | null = null;
let stopTimer: NodeJS.Timeout | null = null;
let forceBundled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    waitAbort.abort();
    if (child?.connected) child.send({ type: "mycellios-node-stop" });
    else child?.kill(signal);
    stopTimer = setTimeout(() => child?.kill("SIGTERM"), 8_000);
    stopTimer.unref();
  });
}

let consecutiveShortRuns = 0;
while (!stopping) {
  const launch: NodeAppLaunch = await planNodeAppLaunch({ supervisorDirectory, configPath, forceBundled })
    .catch(() => bundledNodeAppLaunch(supervisorDirectory));
  if (launch.source === "component") process.stderr.write(`node_service_app_source:component:pending=${launch.pendingActivation}\n`);
  const startedAt = Date.now();
  const running = spawn(process.execPath, [launch.entrypoint, ...process.argv.slice(2)], {
    cwd: launch.cwd,
    env: { ...process.env, [NODE_BOOTSTRAP_ROOT_ENV]: bootstrapRoot },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  child = running;
  let healthTimer: NodeJS.Timeout | null = null;
  if (launch.pendingActivation && configPath) {
    healthTimer = setTimeout(() => {
      void nodeAppActivationPending(configPath, bootstrapRoot).then((pending) => {
        if (!pending || child !== running) return;
        process.stderr.write("node_service_app_health_deadline_exceeded\n");
        if (running.connected) running.send({ type: "mycellios-node-stop" });
        setTimeout(() => running.kill("SIGTERM"), 8_000).unref();
      }).catch(() => undefined);
    }, NODE_APP_HEALTH_DEADLINE_MS);
    healthTimer.unref();
  }
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    running.once("error", () => undefined);
    running.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (healthTimer) clearTimeout(healthTimer);
  child = null;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  if (launch.pendingActivation && configPath && !stopping) {
    // A service stop leaves the candidate pending for the next start.
    // Only the launch that started the candidate may judge it. The process that
    // staged the update exits while the marker is fresh and is not a failure.
    try {
      if (await rollbackUnhealthyNodeApp(configPath, bootstrapRoot)) process.stderr.write("node_service_app_rolled_back\n");
    } catch {
      forceBundled = true;
      process.stderr.write("node_service_app_rollback_failed:using_bundled\n");
    }
  }
  if (stopping) break;
  consecutiveShortRuns = Date.now() - startedAt > 60_000 ? 0 : consecutiveShortRuns + 1;
  process.stderr.write(`node_service_child_exited:code=${exit.code ?? "null"}:signal=${exit.signal ?? "null"}\n`);
  const waitMs = Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveShortRuns - 1, 5));
  await delay(waitMs, undefined, { signal: waitAbort.signal }).catch(() => undefined);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
