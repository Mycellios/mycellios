import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const state = mkdtempSync(join(tmpdir(), "mycellios-route-"));
const network = `mycellios-route-${process.pid}`;
const gateway = `${network}-gateway`;
const old = "a".repeat(40);
const candidate = "b".repeat(40);
const notReady = "c".repeat(40);
const containers = [];
const readers = new AbortController();
let socket;
let stopTraffic = false;
let traffic;

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
const alias = (sha) => `coordinator-release-${sha}`;
const config = (sha) => `set $coordinator_backend ${alias(sha)}:4174;\n`;
const launch = (suffix, args) => {
  const name = `${network}-${suffix}`;
  docker("run", "-d", "--network", network, "--name", name, ...args);
  containers.push(name);
  return name;
};
async function until(probe) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if (await probe()) return; } catch {}
    await setTimeout(100);
  }
  throw new Error("rehearsal condition did not converge");
}

try {
  docker("network", "create", network);
  for (const sha of [old, candidate, notReady]) {
    launch(sha[0], ["--network-alias", alias(sha),
      "--env", `REVISION=${sha}`, "--env", `READY=${sha !== notReady}`,
      "--mount", `type=bind,src=${join(directory, "rehearse-backend.mjs")},dst=/fixture.mjs,readonly`,
      "node:24-alpine", "node", "/fixture.mjs"]);
  }
  writeFileSync(join(state, "active.conf"), config(old));
  launch("gateway", ["--network-alias", "mycellios-coordinator", "-p", "127.0.0.1::4174",
    "--mount", `type=bind,src=${state},dst=/etc/mycellios-route,readonly`,
    "--mount", `type=bind,src=${join(directory, "nginx.conf")},dst=/etc/nginx/nginx.conf,readonly`,
    "nginx:1.29.8-alpine"]);
  const url = `http://${docker("port", gateway, "4174/tcp")}`;
  const health = async () => {
    const result = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) });
    assert.equal(result.status, 200);
    return (await result.json()).revision;
  };
  await until(async () => await health() === old);
  const originalAddress = docker("exec", `${network}-a`, "node", "-e",
    "require('node:dns').lookup('mycellios-coordinator',(e,a)=>{if(e)throw e;console.log(a)})");

  const stream = await fetch(`${url}/stream`, { signal: readers.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), new RegExp(old));
  socket = new WebSocket(url.replace("http:", "ws:") + "/socket");
  const frames = [];
  socket.addEventListener("message", (message) => frames.push(message.data));
  await until(() => frames.includes(old));
  const revisions = [];
  const errors = [];
  traffic = (async () => {
    while (!stopTraffic) {
      try { revisions.push(await health()); } catch (error) { errors.push(error); }
      await setTimeout(20);
    }
  })();

  const change = (from, to, env = process.env) =>
    run("bash", [join(directory, "switch.sh"), gateway, state, from, to], { env, timeout: 45_000 });
  await assert.rejects(change(old, notReady));
  assert.equal(await health(), old);
  assert.equal(readFileSync(join(state, "active.conf"), "utf8"), config(old));

  const shim = join(state, "shim");
  mkdirSync(shim);
  const dockerBin = execFileSync("which", ["docker"], { encoding: "utf8" }).trim();
  const script = join(shim, "docker");
  writeFileSync(script, `#!/usr/bin/env bash
if [[ "$*" == "exec ${gateway} nginx -s reload" && ! -f "${shim}/failed" ]]; then
  touch "${shim}/failed"
  exit 1
fi
exec "${dockerBin}" "$@"
`);
  chmodSync(script, 0o700);
  await assert.rejects(change(old, candidate, { ...process.env, PATH: `${shim}:${process.env.PATH}` }));
  assert.equal(await health(), old);
  assert.equal(readFileSync(join(state, "active.conf"), "utf8"), config(old));

  await change(old, candidate);
  await change(old, candidate); // Recovery after a lost success response.
  await until(async () => await health() === candidate);
  const switchedAddress = docker("exec", `${network}-b`, "node", "-e",
    "require('node:dns').lookup('mycellios-coordinator',(e,a)=>{if(e)throw e;console.log(a)})");
  assert.equal(switchedAddress, originalAddress);
  assert.match(decoder.decode((await reader.read()).value), new RegExp(old));
  const observedFrames = frames.length;
  await until(() => frames.length > observedFrames);
  assert.ok(frames.every((frame) => frame === old));

  await change(candidate, old);
  await until(async () => await health() === old);
  stopTraffic = true;
  await traffic;
  assert.ok(revisions.includes(old) && revisions.includes(candidate));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ candidateRejected: true, failedReloadRecovered: true, rollback: true,
    stableAddress: true, previousStreamSurvived: true, previousWebSocketSurvived: true,
    requests: revisions.length, requestErrors: errors.length }));
} finally {
  stopTraffic = true;
  readers.abort();
  socket?.close();
  await traffic;
  for (const name of containers.reverse()) docker("rm", "-f", name);
  docker("network", "rm", network);
  rmSync(state, { recursive: true, force: true });
}
