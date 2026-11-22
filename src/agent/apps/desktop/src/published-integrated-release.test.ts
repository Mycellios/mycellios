import {describe,expect,it,vi} from "vitest";
import {publishedDesktopArtifact,publishedDesktopRelease} from "./published-desktop-release.js";
import {ManualUpdateController} from "./manual-update.js";
import type {ManualPackageKind} from "./manual-update.js";
const version="0.3.55",tag=`desktop-v${version}-windows-preview`;
const ids:ManualPackageKind[]=["windows-x64","linux-x64","fedora-x64","macos-arm64","macos-x64"];
const platforms=ids.map(id=>{
 const suffix=id==="windows-x64"?"windows-x64-pilot.exe":id==="linux-x64"?"linux-x64-pilot.deb":id==="fedora-x64"?"fedora-x86_64.rpm":`${id}-preview.dmg`;
 return {id,version,fileName:`Mycellios-Desktop-${version}-${suffix}`,format:id.startsWith("macos")?"DMG":id==="windows-x64"?"EXE":id==="fedora-x64"?"RPM":"DEB",sha256:"c".repeat(64),bytes:123};
});
const manifest={schema:"mycellios-installer-release/1",version,revision:"a".repeat(40),tree:"b".repeat(40),workflowRun:123,automaticUpdates:false,platforms};
function feed(kind:ManualPackageKind){
 const file=platforms.find(p=>p.id===kind)!;
 const platform=kind==="linux-x64"||kind==="fedora-x64"?"linux":kind;
 const receipt={...manifest,schema:"mycellios-platform-release/1",platform,qualifiedStartup:true,files:platforms.filter(p=>platform==="linux"?["linux-x64","fedora-x64"].includes(p.id):p.id===platform)};
 const list=[{tag_name:tag,draft:false,author:{login:"github-actions[bot]"},assets:[{name:"installer-release.json"},{name:`platform-release-${platform}.json`},{name:file.fileName,size:file.bytes,digest:`sha256:${file.sha256}`}]}];
 const fetcher=vi.fn<typeof fetch>(async url=>new Response(JSON.stringify(String(url).includes("api.github.com")?list:String(url).endsWith("/installer-release.json")?manifest:receipt)));
 return {fetcher,list,receipt,file};
}
describe("integrated direct Desktop feed",()=>{
 it.each(ids)("validates the exact %s package from the unified receipt",kind=>{
  const result=publishedDesktopArtifact(manifest,version,kind);expect(result.url).toContain(`/releases/download/${tag}/${result.fileName}`);
 });
 it.each(["macos-arm64","macos-x64","linux-x64","fedora-x64"] as const)("offers %s without the website mirror",async kind=>{
  const {fetcher,file}=feed(kind);expect(await publishedDesktopRelease("0.3.54",kind,fetcher)).toMatchObject({fileName:file.fileName,version});
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes("www.mycellios.com"))).toBe(true);
 });
 it("keeps the direct Windows download when release asset metadata exceeds 512 KB", async () => {
   const { fetcher, list, file } = feed("windows-x64");
   const windowsReceipt = {
     schema: "mycellios-desktop-release-package/1", version, tag, platform: "windows-x64",
     revision: manifest.revision, tree: manifest.tree, automaticUpdates: false,
     qualifiedStartup: true, qualifiedInstallation: true, signature: "unsigned-preview",
     artifact: file,
   };
   const [published] = list;
   const historicalReleases = Array.from({ length: 19 }, (_, index) => ({
     tag_name: `v0.2.${index}`, draft: false,
     assets: Array.from({ length: 30 }, (_, asset) => ({
       name: `release-asset-${asset}`,
       browser_download_url: `https://github.com/Mycellios/mycellios/releases/download/v0.2.${index}/release-asset-${asset}`,
       uploader: { login: "github-actions[bot]" },
       digest: `sha256:${"b".repeat(64)}`,
       url: `https://api.github.com/repos/Mycellios/mycellios/releases/assets/${asset}`,
       size: 123456,
       content_type: "application/octet-stream",
       created_at: "2026-11-22T08:00:00Z",
       updated_at: "2026-11-22T08:00:00Z",
       download_count: 0,
       label: "Desktop release artifact metadata ".repeat(15),
     })),
   }));
   fetcher.mockResolvedValueOnce(new Response(JSON.stringify([{
     ...published, assets: [{ name: "desktop-release.json" }, ...published!.assets],
   }, ...historicalReleases])));
   fetcher.mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
   fetcher.mockResolvedValueOnce(new Response(JSON.stringify(windowsReceipt)));

   await expect(publishedDesktopRelease("0.3.54", "windows-x64", fetcher)).resolves.toMatchObject({
     url: `https://github.com/Mycellios/mycellios/releases/download/${tag}/${file.fileName}`,
     bytes: file.bytes,
     sha256: file.sha256,
   });
 });
 it("offers the verified Mac package while the website mirror is unavailable, without installing",async()=>{
  const f=feed("macos-arm64"),handoff=vi.fn(async()=>{});
  const controller=new ManualUpdateController({version:"0.3.54",directory:()=>"unused-fixture",packageKind:"macos-arm64",
   fetch:vi.fn(async()=>new Response(null,{status:503})),publishedRelease:()=>publishedDesktopRelease("0.3.54","macos-arm64",f.fetcher),
   autoDownload:()=>false,busy:()=>false,prepare:async()=>true,handoff,installAction:"system-installer"});
  expect(await controller.check(true)).toMatchObject({phase:"available",availableVersion:version});
  expect(handoff).not.toHaveBeenCalled();
 });
 it("rejects partial, duplicate, mixed-version and unqualified receipts",()=>{
  for(const change of [{automaticUpdates:true},{revision:"bad"},{workflowRun:0},{platforms:platforms.slice(1)},
   {platforms:[platforms[0],...platforms.slice(0,4)]},{platforms:platforms.map((p,i)=>i?p:{...p,version:"0.3.54"})}])
   expect(()=>publishedDesktopArtifact({...manifest,...change},version,"macos-arm64")).toThrow();
 });
 it("rejects mismatched published bytes and native source identity",async()=>{
  const a=feed("macos-arm64");a.list[0]!.assets[2]!.digest="sha256:"+"d".repeat(64);
  await expect(publishedDesktopRelease("0.3.54","macos-arm64",a.fetcher)).rejects.toThrow(/differs/);
  const b=feed("macos-arm64");b.receipt.revision="d".repeat(40);
  await expect(publishedDesktopRelease("0.3.54","macos-arm64",b.fetcher)).rejects.toThrow(/differs/);
 });
 it("does not offer drafts, foreign authors, installed versions or downgrades",async()=>{
  for(const patch of [{draft:true},{author:{login:"other"}}]){const f=feed("macos-arm64");Object.assign(f.list[0]!,patch);expect(await publishedDesktopRelease("0.3.54","macos-arm64",f.fetcher)).toBeNull();}
  for(const current of [version,"0.3.56"]){const f=feed("macos-arm64");expect(await publishedDesktopRelease(current,"macos-arm64",f.fetcher)).toBeNull();}
 });
});
