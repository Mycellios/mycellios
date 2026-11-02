import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionRuntime, mayManageContribution } from "./contribution-runtime.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const bundle = () => ({ schema: "mycellios-node-enrollment-bundle/1", coordinatorUrl: "https://www.mycellios.com", enrollmentId: "4b5e61db-9e21-4268-b1a3-50dd0e818660", enrollmentToken: "t".repeat(43), nonce: "n".repeat(32), expiresAt: "2030-01-01T00:00:00.000Z" });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mycellios-contribution-")); roots.push(root);
  const options = { platform: "win32" as const, resources: path.join(root, "resources"), userData: path.join(root, "user"), programFiles: path.join(root, "programs"), programData: path.join(root, "data") };
  const resource = path.join(options.resources, "contribution"); await mkdir(resource, { recursive: true });
  const bytes = Buffer.from("disposable test payload, not a real MSI");
  await writeFile(path.join(resource, "mycellios-runtime.msi"), bytes);
  await writeFile(path.join(resource, "runtime.json"), JSON.stringify({ schema: "mycellios-desktop-runtime/1", file: "mycellios-runtime.msi", sha256: createHash("sha256").update(bytes).digest("hex") }));
  const config = path.join(options.programData, "Mycellios", "Configuration", "node.json");
  const provision = async () => {
    await mkdir(path.dirname(config), { recursive: true });
    await writeFile(config, JSON.stringify({ nodeId: "existing-node" }));
    const executable = path.join(options.programFiles, "Mycellios", "bin", "node.exe");
    await mkdir(path.dirname(executable), { recursive: true }); await writeFile(executable, "fixture");
    await writeFile(path.join(options.programFiles, "Mycellios", "package.json"), JSON.stringify({ version: "0.2.95" }));
  };
  const run = vi.fn(async (_exe: string, args: string[]) => {
    const file = args[args.indexOf("-Enrollment") + 1]!;
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(bundle());
    await provision(); return 0;
  });
  return { root, options, config, resource, run, provision, manager: new ContributionRuntime({ ...options, run, now: () => Date.parse("2026-10-30T00:00:00Z") }) };
}

it.each([
  ["https://www.mycellios.com/agent/app/bot", true, true],
  ["https://www.mycellios.com/dashboard?view=contribute", true, true],
  ["https://www.mycellios.com.evil.example/agent", true, false],
  ["http://www.mycellios.com/agent", true, false],
  ["https://www.mycellios.com/oauth/consent", true, false],
  ["https://www.mycellios.com/agent/app/bot", false, false],
])("guards native runtime calls from %s", (url, main, expected) => {
  expect(mayManageContribution(url, main)).toBe(expected);
});
it("installs only the bundled verified payload and removes the transient account grant", async () => {
  const f = await fixture(); expect(await f.manager.status()).toMatchObject({ installed: false, enrolled: false });
  expect(await f.manager.enroll(bundle())).toMatchObject({ installed: true, enrolled: true, nodeId: "existing-node", version: "0.2.95", installing: false });
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.run.mock.calls[0]![1]).not.toContain(bundle().enrollmentToken);
  await expect(readFile(path.join(f.options.userData, "runtime-pairing", `${bundle().enrollmentId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
});
it("adopts detection of an existing identity without installing or overwriting it", async () => {
  const f = await fixture(); await f.provision(); const before = await readFile(f.config, "utf8");
  await expect(f.manager.enroll(bundle())).rejects.toThrow("already has a runtime identity");
  expect(f.run).not.toHaveBeenCalled(); expect(await readFile(f.config, "utf8")).toBe(before);
});
it("detects the installed runtime version from a full package manifest", async () => {
  const f = await fixture(); await f.provision();
  // The public 0.2.95 MSI includes an 11 KB manifest, not a minimal version stub.
  await writeFile(path.join(f.options.programFiles, "Mycellios", "package.json"), JSON.stringify({version: "0.2.95", scripts: {build: "x".repeat(12_000)}}));
  expect((await f.manager.status()).version).toBe("0.2.95");
  expect(f.run).not.toHaveBeenCalled();
});
it("rejects changed payloads before starting an installer", async () => {
  const f = await fixture(); await writeFile(path.join(f.resource, "mycellios-runtime.msi"), "changed");
  await expect(f.manager.enroll(bundle())).rejects.toThrow("verified"); expect(f.run).not.toHaveBeenCalled();
});
it.each([
  { coordinatorUrl: "http://www.mycellios.com" },
  { coordinatorUrl: "https://other.example" },
  { expiresAt: "2020-01-01T00:00:00.000Z" },
  { enrollmentToken: "short" },
])("refuses expired or wrong-authority grants", async extra => {
  const f = await fixture(); await expect(f.manager.enroll({ ...bundle(), ...extra })).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled();
});
it("reports cancelled elevation without leaving a reusable grant", async () => {
  const f = await fixture(); const manager = new ContributionRuntime({ ...f.options, run: async () => 1223 });
  await expect(manager.enroll(bundle())).rejects.toThrow("cancelled");
  expect((await manager.status()).installing).toBe(false);
  await expect(readFile(path.join(f.options.userData, "runtime-pairing", `${bundle().enrollmentId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
});

it("uses the Linux DEB through polkit with a private grant and retains the shared identity", async () => {
  const f = await fixture();
  const linuxRoot = path.join(f.root, "opt"), linuxConfig = path.join(f.root, "etc/node.json");
  const bytes = Buffer.from("disposable Linux test payload");
  await writeFile(path.join(f.resource, "mycellios-runtime.deb"), bytes);
  await writeFile(path.join(f.resource, "runtime.json"), JSON.stringify({ schema: "mycellios-desktop-runtime/1", file: "mycellios-runtime.deb", sha256: createHash("sha256").update(bytes).digest("hex") }));
  const run = vi.fn(async (executable: string, args: string[]) => {
    expect(executable).toBe("pkexec");
    expect(args[0]).toMatch(/install-runtime\.sh$/);
    expect(JSON.parse(await readFile(args[3]!, "utf8"))).toEqual(bundle());
    await mkdir(path.dirname(linuxConfig), { recursive: true }); await writeFile(linuxConfig, JSON.stringify({ nodeId: "linux-node" }));
    await mkdir(path.join(linuxRoot, "bin"), { recursive: true }); await writeFile(path.join(linuxRoot, "bin/node"), "fixture");
    await mkdir(path.join(linuxRoot, "app"), { recursive: true }); await writeFile(path.join(linuxRoot, "app/manifest.json"), JSON.stringify({ version: "0.2.108" }));
    return 0;
  });
  const manager = new ContributionRuntime({ ...f.options, platform: "linux", linuxRoot, linuxConfig, run });
  expect(await manager.enroll(bundle())).toMatchObject({ supported: true, installed: true, nodeId: "linux-node", version: "0.2.108" });
  await expect(manager.enroll(bundle())).rejects.toThrow("already has a runtime identity");
  expect(run).toHaveBeenCalledOnce();
  await expect(readFile(path.join(f.options.userData, "runtime-pairing", `${bundle().enrollmentId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
});

it("pairs an Apple Silicon PKG through the native administrator prompt without exposing its grant", async () => {
  const f=await fixture();const macRoot=path.join(f.root,"Mac Product"),macConfig=path.join(f.root,"Mac Configuration/node.json");
  const bytes=Buffer.from("synthetic macOS PKG");await writeFile(path.join(f.resource,"mycellios-runtime.pkg"),bytes);
  await writeFile(path.join(f.resource,"runtime.json"),JSON.stringify({schema:"mycellios-desktop-runtime/1",file:"mycellios-runtime.pkg",sha256:createHash("sha256").update(bytes).digest("hex")}));
  const run=vi.fn(async(executable:string,args:string[])=>{
    expect(executable).toBe("/usr/bin/osascript");expect(args[0]).toBe("-e");expect(args[1]).toContain("with administrator privileges");expect(args[1]).toContain("install-runtime-macos.sh");expect(args[1]).not.toContain(bundle().enrollmentToken);
    const grant=path.join(f.options.userData,"runtime-pairing",`${bundle().enrollmentId}.json`);expect(JSON.parse(await readFile(grant,"utf8"))).toEqual(bundle());
    await mkdir(path.dirname(macConfig),{recursive:true});await writeFile(macConfig,JSON.stringify({nodeId:"mac-existing-identity"}));
    await mkdir(path.join(macRoot,"bin"),{recursive:true});await writeFile(path.join(macRoot,"bin/node"),"fixture");
    await mkdir(path.join(macRoot,"app"),{recursive:true});await writeFile(path.join(macRoot,"app/manifest.json"),JSON.stringify({version:"0.2.95"}));return 0;
  });
  const manager=new ContributionRuntime({...f.options,platform:"darwin",macRoot,macConfig,run});
  expect(await manager.enroll(bundle())).toMatchObject({supported:true,installed:true,enrolled:true,nodeId:"mac-existing-identity",version:"0.2.95"});
  await expect(manager.enroll(bundle())).rejects.toThrow("already has a runtime identity");expect(run).toHaveBeenCalledOnce();
  await expect(readFile(path.join(f.options.userData,"runtime-pairing",`${bundle().enrollmentId}.json`))).rejects.toMatchObject({code:"ENOENT"});
});

it("keeps Mac identity lookup separate from enrollment and never installs an unverified PKG",async()=>{
 const f=await fixture();const run=vi.fn(async()=>0);const manager=new ContributionRuntime({...f.options,platform:"darwin",macRoot:path.join(f.root,"none"),macConfig:path.join(f.root,"absent.json"),run});
 expect((await manager.identify()).installed).toBe(false);expect(run).not.toHaveBeenCalled();
 await expect(manager.enroll(bundle())).rejects.toThrow("verified");expect(run).not.toHaveBeenCalled();
});
