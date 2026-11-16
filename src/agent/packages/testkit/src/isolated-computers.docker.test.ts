import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import { DockerSandboxProvider, HostAwareSandbox } from "@rakazo/adapters";
import { computerHomeKey } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  computerNetworkNameFor,
  computerNetworkOwnerFor,
  containerNameFor,
} from "../../../infra/sandboxes/supervisor/src/computer-spec.js";

type ContainerInfo = {
  Id: string;
  Config: { Labels: Record<string, string> };
  State: { Pid: number };
  Mounts: Array<{ Destination: string; Source: string }>;
  HostConfig: { NetworkMode: string; CapDrop: string[]; SecurityOpt: string[] };
  NetworkSettings: { Networks: Record<string, { IPAddress?: string }> };
};
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe", timeout: 30_000 });

/** Opt-in real containers and real browser screenshots; no model or cloud API. */
describe.skipIf(process.env.RUN_ISOLATED_COMPUTERS_DOCKER !== "1")("isolated Mico computers in Docker", () => {
  it("keeps two private homes, screens and provider references apart with Desktop connected", async () => {
    if (!process.env.DATA_DIR || !process.env.SANDBOX_SUPERVISOR_TOKEN || !process.env.ISOLATED_COMPUTERS_OUTPUT || !process.env.RAKAZO_COMPUTER_IMAGE)
      throw new Error("Run via computer-replay.ts --isolated --output=<directory>");
    if (process.env.COMPUTER_RECORD_OUTPUT || process.env.OPENROUTER_API_KEY)
      throw new Error("Live model configuration is forbidden in isolated computer qualification");
    if (process.platform !== "linux") throw new Error("This real internal-network qualification requires a Linux Docker host");
    const supervisorImage = process.env.ISOLATED_COMPUTERS_SUPERVISOR_IMAGE;
    if (!supervisorImage) throw new Error("The isolated supervisor image is required");
    const endpoint = process.env.DOCKER_HOST ?? docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}").trim();
    if (!endpoint.startsWith("unix://")) throw new Error("Qualification requires a local Unix Docker socket");
    const directory = process.env.DATA_DIR;
    const output = process.env.ISOLATED_COMPUTERS_OUTPUT;
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "qualification.json"), JSON.stringify({ passed: false, stage: "starting", modelCalls: 0 }, null, 2));
    let proof: Record<string, unknown> | undefined;
    const identity = randomUUID();
    const actor = { userId: `fixture-owner-${identity}`, spaceId: `fixture-space-${identity}` };
    const members = ["first", "second"].map(name => {
      const botId = `fixture-${name}-${identity}`;
      return { botId, homeKey: computerHomeKey({ mode: "isolated", ...actor, botId }) };
    });
    const networkOwner = computerNetworkOwnerFor(directory, undefined);
    const ownedNetworks: string[] = [];
    const ownedHomes: string[] = [];
    const computers: Array<{ ref: ComputerRef; context: AdapterContext }> = [];
    let hostCalls = 0;
    let connected = false;
    await mkdir(directory, { recursive: true });
    const supervisorName = `mycellios-isolation-supervisor-${identity}`;
    let supervisorId: string | undefined;
    let supervisorUrl: string | undefined;
    try {
      supervisorId = docker("run", "--detach", "--name", supervisorName,
        "--label", `mycellios.isolation-fixture=${identity}`,
        "--mount", `type=bind,source=${endpoint.slice("unix://".length)},target=/var/run/docker.sock`,
        "--mount", `type=bind,source=${directory},target=/data`,
        "--publish", "127.0.0.1::7091",
        "--env", "RAKAZO_PROJECT_LOCAL=1", "--env", "LOG_LEVEL=off",
        "--env", "DATA_DIR=/data", "--env", "SUPERVISOR_HOST=0.0.0.0",
        "--env", `SANDBOX_SUPERVISOR_TOKEN=${process.env.SANDBOX_SUPERVISOR_TOKEN}`,
        "--env", `RAKAZO_COMPUTER_IMAGE=${process.env.RAKAZO_COMPUTER_IMAGE}`,
        "--env", "SANDBOX_SCREEN_NETWORK=isolated", "--env", "SANDBOX_COMPUTER_EGRESS=open",
        "--env", "SANDBOX_CONTROL_VIA_LOOPBACK=false", supervisorImage).trim();
      const controllerInfo = JSON.parse(docker("inspect", supervisorId))[0];
      expect(controllerInfo.Config.Labels["mycellios.isolation-fixture"]).toBe(identity);
      const published = controllerInfo.NetworkSettings.Ports["7091/tcp"]?.[0];
      expect(published?.HostIp).toBe("127.0.0.1");
      expect(published?.HostPort).toMatch(/^\d+$/);
      supervisorUrl = `http://127.0.0.1:${published.HostPort}`;
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        ready = await fetch(`${supervisorUrl}/health`, { signal: AbortSignal.timeout(1_000) })
          .then(async response => { const body = await response.json() as { ok?: boolean }; return response.ok && body.ok === true; }, () => false)
          .catch(() => false);
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) throw new Error(`Isolated supervisor failed to start: ${docker("logs", "--tail", "30", supervisorId)}`);
      const provider = new DockerSandboxProvider(supervisorUrl, process.env.SANDBOX_SUPERVISOR_TOKEN);
      // Every operation on the native side is a tripwire. Only the real Docker
      // provider below may execute; the assertion wrapper implements no sandbox.
      const forbiddenHost = new Proxy(provider, { get: (_target, property) => {
        if (property === "describe") return () => ({ ...provider.describe(), id: "desktop" });
        return () => { hostCalls++; throw new Error("Isolated computer attempted to use Desktop"); };
      } }) as SandboxProvider;
      const sandbox = new HostAwareSandbox(provider, forbiddenHost, async () => connected);
      const infos: ContainerInfo[] = [];
      const observations: Array<{ file: string; sha256: string; width: number; height: number }> = [];
      for (const [index, member] of members.entries()) {
        const network = computerNetworkNameFor(member.homeKey);
        // No external egress is available even while Chrome initializes. Names
        // are unique to this run; only successfully created networks are owned.
        docker("network", "create", "--internal", "--label", `rakazo.computerOwner=${networkOwner}`, "--label", `rakazo.botId=${member.homeKey}`, network);
        ownedNetworks.push(network);
        const homePath = `/data/homes/${member.homeKey}`;
        ownedHomes.push(member.homeKey);
        // The production supervisor never chowns runtime homes. Initialize only
        // this fixture's empty private directory with the image's uid/gid.
        docker("exec", supervisorId, "node", "-e",
          "const fs=require('node:fs');fs.mkdirSync(process.argv[1],{recursive:true,mode:0o700});fs.chownSync(process.argv[1],1000,1000)", homePath);
        const context: AdapterContext = {
          ...actor, botId: member.botId, operationId: `isolation-${index}`, traceId: identity,
          isolatedWorkspace: true, screenLeaseId: `fixture-run-${index}:1`, signal: AbortSignal.timeout(180_000),
        };
        connected = index === 1;
        expect(await sandbox.provisionKind(context)).toBe("docker");
        const ref = await sandbox.provision({ botId: member.homeKey, homePath, providerKind: "docker" }, context);
        computers.push({ ref, context });
        await sandbox.prepare(ref, context);
        const info = JSON.parse(docker("inspect", ref.id))[0] as ContainerInfo;
        expect(info.Config.Labels["rakazo.botId"]).toBe(member.homeKey);
        expect(info.Config.Labels["rakazo.spaceId"]).toBe(actor.spaceId);
        expect(info.Mounts.some(mount => mount.Destination === "/var/run/docker.sock")).toBe(false);
        expect(info.Mounts.map(mount => mount.Destination)).toEqual(["/home/rakazo"]);
        expect(info.HostConfig.NetworkMode).toBe(network);
        expect(Object.keys(info.NetworkSettings.Networks)).toEqual([network]);
        expect(JSON.parse(docker("network", "inspect", network))[0].Internal).toBe(true);
        expect(info.HostConfig.CapDrop).toContain("ALL");
        expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
        expect(info.State.Pid).toBeGreaterThan(0);
        infos.push(info);
        await sandbox.writeFile(ref, { path: "same-name.txt", content: new TextEncoder().encode(member.botId) }, context);
        await sandbox.writeFile(ref, { path: `only-${index}.txt`, content: new TextEncoder().encode(`private-${index}`) }, context);
        const screen = await sandbox.connectScreen(ref, { view: "stream", interactive: false }, context);
        expect(screen.url).toBeTruthy();
        const viewerUrl = new URL(screen.url!);
        expect(viewerUrl.protocol).toBe("http:");
        expect(viewerUrl.hostname).toBe(info.NetworkSettings.Networks[network]!.IPAddress);
        const viewer = await fetch(viewerUrl, { signal: AbortSignal.timeout(10_000) });
        expect(viewer.ok).toBe(true);
        expect(await viewer.text()).toMatch(/<!doctype html|<html/i);
        const socketPath = viewerUrl.searchParams.get("path");
        expect(socketPath).toMatch(/^websockify\?/);
        const socketUrl = new URL(socketPath!, viewerUrl);
        socketUrl.protocol = "ws:";
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(socketUrl, ["binary"]);
          socket.binaryType = "arraybuffer";
          const timeout = setTimeout(() => { socket.close(); reject(new Error("Real viewer VNC handshake timed out")); }, 10_000);
          let banner = "";
          socket.addEventListener("message", event => {
            banner += typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
            if (banner.length < 12) return;
            clearTimeout(timeout);
            socket.close();
            if (/^RFB \d{3}\.\d{3}\n/.test(banner)) resolve(); else reject(new Error("Viewer did not return the real VNC handshake"));
          });
          socket.addEventListener("error", () => { clearTimeout(timeout); socket.close(); reject(new Error("Real viewer WebSocket failed")); }, { once: true });
        });
        const observation = await sandbox.observe(ref, context);
        expect(observation.mimeType).toBe("image/png");
        expect([...observation.image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(observation.width).toBeGreaterThanOrEqual(640);
        expect(observation.height).toBeGreaterThanOrEqual(480);
        const decoded = PNG.sync.read(Buffer.from(observation.image));
        expect(decoded.width).toBe(observation.width);
        expect(decoded.height).toBe(observation.height);
        const file = `isolated-${index + 1}.png`;
        await writeFile(path.join(output, file), observation.image);
        observations.push({ file, sha256: createHash("sha256").update(observation.image).digest("hex"), width: observation.width, height: observation.height });
        await screen.close();
      }
      expect(computers[0]!.ref.id).not.toBe(computers[1]!.ref.id);
      expect(infos[0]!.State.Pid).not.toBe(infos[1]!.State.Pid);
      for (const info of infos) expect(info.Mounts.find(mount => mount.Destination === "/home/rakazo")?.Source).toBeTruthy();
      expect(infos[0]!.Mounts.find(mount => mount.Destination === "/home/rakazo")?.Source)
        .not.toBe(infos[1]!.Mounts.find(mount => mount.Destination === "/home/rakazo")?.Source);
      for (const [index, { ref, context }] of computers.entries()) {
        expect(new TextDecoder().decode(await sandbox.readFile(ref, "same-name.txt", context))).toBe(members[index]!.botId);
        await expect(sandbox.readFile(ref, `only-${1 - index}.txt`, context)).rejects.toThrow();
        expect(await sandbox.isRunning(ref, context)).toBe(true);
        const resumed = await sandbox.provision({ botId: members[index]!.homeKey, homePath: `/data/homes/${members[index]!.homeKey}`, providerKind: "docker", providerRef: ref.providerRef }, context);
        expect(resumed.id).toBe(ref.id);
        const finalInfo = JSON.parse(docker("inspect", ref.id))[0] as ContainerInfo;
        expect(Object.keys(finalInfo.NetworkSettings.Networks)).toEqual([computerNetworkNameFor(members[index]!.homeKey)]);
      }
      expect(hostCalls).toBe(0);
      proof = { passed: true, realDocker: true, realSupervisor: true, containerizedSupervisor: true, realViewerHttpAndVnc: true, isolatedContainers: 2, distinctHomes: true, distinctProcesses: true, privateInternalNetworks: true, realScreens: observations, desktopReconnectPreserved: true, hostCalls, modelCalls: 0, paidCloudResources: false };
    } finally {
      const cleanupErrors: unknown[] = [];
      for (const { ref, context } of computers) {
        try {
          if (!supervisorUrl) throw new Error("Supervisor was not initialized");
          const provider = new DockerSandboxProvider(supervisorUrl, process.env.SANDBOX_SUPERVISOR_TOKEN);
          await provider.destroy(ref, { ...context, signal: AbortSignal.timeout(30_000) });
        } catch (error) { cleanupErrors.push(error); }
      }
      // A lost provision response may leave a container with no returned ref.
      // Validate its immutable labels before removing only our exact name.
      for (const homeKey of ownedHomes) {
        try {
          const name = containerNameFor(homeKey);
          let info: ContainerInfo | undefined;
          try { info = JSON.parse(docker("inspect", name))[0] as ContainerInfo; }
          catch (error) { if (!/No such (object|container)/i.test(String((error as { stderr?: string }).stderr))) throw error; }
          if (info) {
            if (info.Config.Labels["rakazo.botId"] !== homeKey || info.Config.Labels["rakazo.spaceId"] !== actor.spaceId)
              throw new Error("Refusing to clean up an unowned container");
            docker("rm", "--force", info.Id);
          }
        } catch (error) { cleanupErrors.push(error); }
      }
      // Reclaim only these generated homes before the temporary host directory
      // is removed by the CLI. Never follow browser-profile symlinks.
      try {
        let controller: ContainerInfo | undefined;
        try { controller = JSON.parse(docker("inspect", supervisorId ?? supervisorName))[0]; }
        catch (error) { if (!/No such (object|container)/i.test(String((error as { stderr?: string }).stderr))) throw error; }
        if (controller) {
          if (controller.Config.Labels["mycellios.isolation-fixture"] !== identity || controller.Mounts.find(mount => mount.Destination === "/data")?.Source !== directory)
            throw new Error("Refusing to clean up an unowned supervisor");
          try {
            if (ownedHomes.length) docker("exec", controller.Id, "node", "-e",
              "const fs=require('node:fs'),path=require('node:path');const[uid,gid,...names]=process.argv.slice(1);function reclaim(p){let s;try{s=fs.lstatSync(p)}catch(e){if(e.code==='ENOENT')return;throw e}fs.lchownSync(p,+uid,+gid);if(s.isDirectory())for(const n of fs.readdirSync(p))reclaim(path.join(p,n))}for(const n of names){if(!/^iso-[a-f0-9]{32}$/.test(n))throw Error('Invalid fixture home');reclaim('/data/homes/'+n)}if(fs.existsSync('/data/homes'))fs.lchownSync('/data/homes',+uid,+gid)",
              String(process.getuid?.() ?? 1000), String(process.getgid?.() ?? 1000), ...ownedHomes);
          } finally { docker("rm", "--force", controller.Id); }
        }
      } catch (error) { cleanupErrors.push(error); }
      for (const network of ownedNetworks) {
        try {
          let info: { Labels: Record<string, string> } | undefined;
          try { info = JSON.parse(docker("network", "inspect", network))[0]; }
          catch (error) { if (!/not found|No such network/i.test(String((error as { stderr?: string }).stderr))) throw error; }
          if (info) {
            if (info.Labels["rakazo.computerOwner"] !== networkOwner) throw new Error("Refusing to clean up an unowned network");
            docker("network", "rm", network);
          }
        } catch (error) { cleanupErrors.push(error); }
      }
      if (cleanupErrors.length) {
        await writeFile(path.join(output, "qualification.json"), JSON.stringify({ passed: false, stage: "cleanup-failed", checksCompleted: Boolean(proof), modelCalls: 0 }, null, 2));
        throw new AggregateError(cleanupErrors, "Failed to clean up isolated computer qualification");
      }
      if (proof) {
        proof.cleanup = true;
        await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2));
        console.log(JSON.stringify(proof));
      }
    }
  }, 420_000);
});
