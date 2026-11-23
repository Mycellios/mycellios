import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const [gateway, stateDir, previous, candidate] = process.argv.slice(2);
const revision = /^[a-f0-9]{40}$/;
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(gateway ?? "")
    || !stateDir || !revision.test(previous ?? "") || !revision.test(candidate ?? "") || previous === candidate) {
  throw new Error("usage: switch.mjs GATEWAY STATE_DIRECTORY PREVIOUS_SHA CANDIDATE_SHA");
}
const state = realpathSync(resolve(stateDir));
const active = join(state, "active.conf");
const pending = join(state, "pending.json");
const transition = JSON.stringify({ previous, candidate }) + "\n";
const hostname = (sha) => `coordinator-release-${sha}`;
const configuration = (sha) => `set $coordinator_backend ${hostname(sha)}:4174;\n`;

function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0) throw new Error(`docker ${args[0]} was unsuccessful`);
  return result.stdout;
}

function exists(path) {
  try { return readFileSync(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function replace(path, content) {
  const temp = `${path}.${randomUUID()}`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  syncDir(path);
}

function syncDir(path) {
  const fd = openSync(dirname(path), "r");
  try { fsyncSync(fd); }
  finally { closeSync(fd); }
}

function health(host) {
  const body = JSON.parse(docker("exec", gateway, "wget", "-T", "2", "-qO-", `http://${host}:4174/health`));
  if (body.status !== "ok" || !revision.test(body.revision) || body.releaseState === "standby") {
    throw new Error("coordinator is not ready for traffic");
  }
  return body.revision;
}

async function reloadTo(sha) {
  docker("exec", gateway, "nginx", "-t");
  docker("exec", gateway, "nginx", "-s", "reload");
  for (let i = 0; i < 8; i += 1) {
    try { if (health("127.0.0.1") === sha) return; }
    catch { /* A new worker may not be accepting connections yet. */ }
    await setTimeout(250);
  }
  throw new Error("gateway did not serve expected revision");
}

function finish() {
  unlinkSync(pending);
  syncDir(pending);
}

const mounts = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", gateway));
if (!mounts.some((mount) => mount.Type === "bind" && mount.Source === state
    && mount.Destination === "/etc/mycellios-route" && mount.RW === false)) {
  throw new Error("gateway does not use the expected route directory");
}

const journal = exists(pending);
const onDisk = readFileSync(active, "utf8");
if (journal !== null && journal !== transition) throw new Error("another route transition requires recovery");
if (onDisk !== configuration(previous) && onDisk !== configuration(candidate)) throw new Error("unexpected route configuration");
let live = null;
try { live = health("127.0.0.1"); }
catch (error) { if (journal === null) throw error; }
if (live && live !== previous && live !== candidate) throw new Error("unexpected serving revision");

if (onDisk === configuration(candidate) && live === candidate) {
  if (journal !== null) finish();
} else {
  if (journal === null) {
    if (onDisk !== configuration(previous) || live !== previous || health(hostname(candidate)) !== candidate) {
      throw new Error("candidate or source revision mismatch");
    }
    replace(pending, transition);
  }
  try {
    if (health(hostname(candidate)) !== candidate) throw new Error("candidate revision mismatch");
    replace(active, configuration(candidate));
    await reloadTo(candidate);
  } catch (error) {
    try {
      if (health(hostname(previous)) !== previous) throw new Error("original revision is not ready");
      replace(active, configuration(previous));
      await reloadTo(previous);
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "route transition requires recovery");
    }
    finish();
    throw error;
  }
  finish();
}
console.log(JSON.stringify({ previous, candidate, serving: candidate }));
