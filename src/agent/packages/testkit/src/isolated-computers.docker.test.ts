import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
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
  NetworkSettings: { Networks: Record<string, unknown> };
};
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 });

/** Opt-in real containers and real browser screenshots; no model or cloud API. */
describe.skipIf(process.env.RUN_ISOLATED_COMPUTERS_DOCKER !== "1")("isolated Mico computers in Docker", () => {
  it("keeps two private homes, screens and provider references apart with Desktop connected", async () => {
    if (!process.env.DATA_DIR || !process.env.SANDBOX_SUPERVISOR_TOKEN || !process.env.ISOLATED_COMPUTERS_OUTPUT)
      throw new Error("Run via computer-replay.ts --isolated --output=<directory>");
    if (process.env.COMPUTER_RECORD_OUTPUT || process.env.OPENROUTER_API_KEY)
      throw new Error("Live model configuration is forbidden in isolated computer qualification");
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
    const { supervisorApp } = await import("../../../infra/sandboxes/supervisor/src/index.js");
    const server = serve({ fetch: supervisorApp.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      if (!server.listening) await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.once("listening", () => { server.off("error", reject); resolve(); });
      });
      const provider = new DockerSandboxProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, process.env.SANDBOX_SUPERVISOR_TOKEN);
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
        const homePath = path.join(directory, "homes", member.homeKey);
        await mkdir(homePath, { recursive: true });
        ownedHomes.push(member.homeKey);
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
        const observation = await sandbox.observe(ref, context);
        expect(observation.mimeType).toBe("image/png");
        expect([...observation.image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(observation.width).toBeGreaterThan(0);
        expect(observation.height).toBeGreaterThan(0);
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
        const resumed = await sandbox.provision({ botId: members[index]!.homeKey, homePath: path.join(directory, "homes", members[index]!.homeKey), providerKind: "docker", providerRef: ref.providerRef }, context);
        expect(resumed.id).toBe(ref.id);
        const finalInfo = JSON.parse(docker("inspect", ref.id))[0] as ContainerInfo;
        expect(Object.keys(finalInfo.NetworkSettings.Networks)).toEqual([computerNetworkNameFor(members[index]!.homeKey)]);
      }
      expect(hostCalls).toBe(0);
      proof = { passed: true, realDocker: true, realSupervisor: true, isolatedContainers: 2, distinctHomes: true, distinctProcesses: true, privateInternalNetworks: true, realScreens: observations, desktopReconnectPreserved: true, hostCalls, modelCalls: 0, paidCloudResources: false };
    } finally {
      const cleanupErrors: unknown[] = [];
      for (const { ref, context } of computers) {
        try {
          const provider = new DockerSandboxProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, process.env.SANDBOX_SUPERVISOR_TOKEN);
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
      await new Promise<void>((resolve, reject) => {
        server.close(error => error && (!("code" in error) || error.code !== "ERR_SERVER_NOT_RUNNING") ? reject(error) : resolve());
        server.closeAllConnections();
      });
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
