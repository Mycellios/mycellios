import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { computerConsentScope, prepareHostComputer } from "./host-computer.js";
import { bundledRendererCandidates, localRendererOverride, resolvePackagedRenderer } from "./renderer-assets.js";
import { servesBundledRenderer } from "./setup-config.js";

it("retains account permission and project notes when a new version replaces the old local UI", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "mycellios-upgrade-"));
  let computer: Awaited<ReturnType<typeof prepareHostComputer>> | undefined;
  try {
    computer = await prepareHostComputer(profile);
    const account = computerConsentScope("https://www.mycellios.com/agent", {userId:"fixture-owner"});
    await computer.grant(account);
    const workspace = computer.workspace("fixture-project-agent");
    await mkdir(workspace, {recursive:true});
    const notes = "Verified project destination and local changes remain here\n";
    await writeFile(path.join(workspace,"PROJECT.md"), notes);
    const directory = "local-web/" + "a".repeat(64);
    await mkdir(path.join(profile,directory), {recursive:true});
    await writeFile(path.join(profile,directory,"index.html"), '<script src="/agent/assets/previous.js"></script>');
    const preference = JSON.stringify({schema:"mycellios-local-renderer/1",directory,nativeVersion:"0.3.9"});
    await writeFile(path.join(profile,"local-renderer.json"), preference);
    const sessionFixture = "synthetic session bytes - never a real account";
    await writeFile(path.join(profile,"session-fixture"),sessionFixture);
    const resources = path.join(profile,"fixture-next-application");
    const packagedRoot = path.join(resources,"web/first-party");
    await mkdir(packagedRoot,{recursive:true});
    await writeFile(path.join(packagedRoot,"index.html"),"next version's bundled UI");
    const input = {userData:profile,resources,targetUrl:"https://www.mycellios.com/agent/app",managedLocalStack:false};
    // Windows may create temp directories through RUNNER~1 while realpath returns runneradmin.
    // Compare the exact canonical destination, keeping all retention assertions below intact.
    const previousRoot = await realpath(path.join(profile,directory));
    expect(await localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.9")).toBe(previousRoot);
    expect((await resolvePackagedRenderer({...input,nativeVersion:"0.3.9"}))?.root).toBe(previousRoot);
    await computer.close(); computer = undefined;

    // Installer replaces application files, while both versions use the same private profile.
    expect(await localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.10")).toBeNull();
    expect(servesBundledRenderer("https://www.mycellios.com/agent/app",false)).toBe(true);
    const updated = await resolvePackagedRenderer({...input,nativeVersion:"0.3.10"});
    expect(updated).toEqual({root:packagedRoot,basePath:"/agent",local:false,firstParty:true});
    expect(await readFile(path.join(updated!.root,"index.html"),"utf8")).toBe("next version's bundled UI");
    for (const route of ["/agent/api/auth/get-session","/agent/rpc/bots","/oauth/consent"])
      expect(bundledRendererCandidates(updated!.root,"https://www.mycellios.com"+route,"https://www.mycellios.com",true,updated!.basePath)).toBeNull();
    expect(await resolvePackagedRenderer({...input,targetUrl:"https://self-hosted.example/app",nativeVersion:"0.3.10"})).toBeNull();
    computer = await prepareHostComputer(profile);
    expect(computer.hasRememberedAccess(account)).toBe(true);
    expect(computer.isEnabled()).toBe(false); // identity still has to be revalidated natively.
    await computer.grant(account); computer.activate(true);
    expect(computer.isEnabled()).toBe(true);
    expect(computer.workspace("fixture-project-agent")).toBe(workspace);
    expect(await readFile(path.join(workspace,"PROJECT.md"),"utf8")).toBe(notes);
    expect(await readFile(path.join(profile,"local-renderer.json"),"utf8")).toBe(preference);
    expect(await readFile(path.join(profile,"session-fixture"),"utf8")).toBe(sessionFixture);
    expect(computer.hasRememberedAccess(computerConsentScope("https://www.mycellios.com/agent",{userId:"other-owner"}))).toBe(false);
  } finally { await computer?.close(); await rm(profile,{recursive:true,force:true}); }
});
