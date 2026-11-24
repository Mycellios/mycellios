import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const relay = `
const net = require('node:net');
net.createServer(client => {
  const upstream = net.connect(Number(process.env.TEST_PORT), process.env.TEST_GATEWAY);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream).pipe(client);
}).listen(4174, '0.0.0.0');
`;

/** Connects the ingress kit's real Docker network to loopback-only test coordinators. */
export function coordinatorHandoffIngress(kitPath: string, source: string) {
  const kit = resolve(kitPath);
  const network = `coordinator-handoff-${randomBytes(8).toString("hex")}`;
  const gateway = network + "-gateway";
  const operation = randomBytes(32).toString("hex");
  const state = mkdtempSync(join(tmpdir(), "mycellios-handoff-ingress-"));
  const members: string[] = [];
  const bridges: Array<ReturnType<typeof createServer>> = [];
  const sockets = new Set<Socket>();
  const mount = (path: string, target: string) => ["--mount", `type=bind,src=${path},dst=${target},readonly`];
  const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 15_000 }).trim();
  let address: string;
  let created = false;
  function launch(name: string, ...args: string[]) {
    docker("run", "-d", "--network", network, "--name", name, ...args);
    members.push(name);
  }
  function command(script: string, ...args: string[]) {
    return execFileSync("bash", [join(kit, script), ...args], { encoding: "utf8", timeout: 45_000 });
  }
  async function register(revision: string, backend: string) {
    if (!created) {
      docker("network", "create", network);
      created = true;
    }
    const bridgeAddress = docker("network", "inspect", "--format", "{{(index .IPAM.Config 0).Gateway}}", network);
    const target = new URL(backend);
    const bridge = createServer((client) => {
      const upstream = connect(Number(target.port), "127.0.0.1");
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      }
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((done, fail) => {
      bridge.once("error", fail);
      bridge.listen(0, bridgeAddress, done);
    });
    bridges.push(bridge);
    const port = bridge.address();
    if (!port || typeof port === "string") throw new Error("Ingress fixture bridge has no port");
    launch(`${network}-${revision[0]}`, "--network-alias", `coordinator-release-${revision}`,
      "--env", `TEST_PORT=${port.port}`, "--env", `TEST_GATEWAY=${bridgeAddress}`,
      "node:24-alpine", "node", "-e", relay);
  }
  return {
    register,
    async start() {
      chmodSync(state, 0o755);
      writeFileSync(join(state, "gate.json"), JSON.stringify({ revision: source, hold: null }), { mode: 0o600 });
      writeFileSync(join(state, "active.conf"), `set $coordinator_backend coordinator-release-${source}:4174;\nset $coordinator_revision ${source};\n`);
      launch(network + "-gate", "--mount", `type=bind,src=${state},dst=/route-state`,
        ...mount(kit, "/kit"), "node:24-alpine", "node", "/kit/route-gate.mjs", "/route-state");
      launch(gateway, "--network-alias", "mycellios-coordinator", "-p", "127.0.0.1::4174",
        ...mount(state, "/etc/mycellios-route"), ...mount(join(kit, "nginx.conf"), "/etc/nginx/nginx.conf"),
        "nginx:1.29.8-alpine");
      address = "http://" + docker("port", gateway, "4174/tcp");
      await this.ready(source);
      return address;
    },
    async ready(revision: string) {
      // Use Docker DNS, the same upstream resolution used for production alias probes.
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const reply = JSON.parse(docker("exec", gateway, "wget", "-T", "1", "-qO-",
            `http://coordinator-release-${revision}:4174/health`));
          if (reply.revision === revision && reply.status === "ok" &&
              (await fetch(address + "/health", { signal: AbortSignal.timeout(1_000) })).ok) return;
        } catch { /* A fixture container may still be booting. */ }
        await setTimeout(100);
      }
      throw new Error("Ingress fixture did not reach the exact coordinator");
    },
    async transfer(from: string, to: string, changeOwner: () => Promise<void>) {
      command("hold.sh", "hold", state, operation, from);
      await changeOwner();
      command("switch.sh", gateway, state, operation, from, to);
      command("hold.sh", "release", state, operation, to);
      const response = await fetch(address + "/health", { signal: AbortSignal.timeout(3_000) });
      if (!response.ok || (await response.json()).revision !== to) throw new Error("Ingress did not serve transferred revision");
    },
    close() {
      for (const name of members.reverse()) {
        try { docker("rm", "-f", name); } catch { /* Container may have exited. */ }
      }
      for (const bridge of bridges) bridge.close();
      for (const socket of sockets) socket.destroy();
      if (created) docker("network", "rm", network);
      rmSync(state, { recursive: true, force: true });
    },
  };
}
