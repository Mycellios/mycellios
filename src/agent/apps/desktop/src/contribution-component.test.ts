import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {contributionComponent} from "./contribution-component.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true, force:true}); });
const body = Buffer.from("pinned-runtime-fixture");
const sha256 = createHash("sha256").update(body).digest("hex");
const c = {schema:"mycellios-desktop-runtime/2", file:"mycellios-runtime.pkg", sha256, bytes:body.length,
  url:`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${sha256}/mycellios-runtime.pkg`};
async function root() { const r=await mkdtemp(path.join(os.tmpdir(),"component-test-"));roots.push(r);return r; }
it("downloads only the pinned original component and reuses the verified cache", async () => {
  const fetcher=vi.fn<typeof fetch>(async () => new Response(body));
  const cache=await root();
  const file=await contributionComponent(c,c.file,cache,fetcher);
  expect(await readFile(file)).toEqual(body);
  expect(await contributionComponent(c,c.file,cache,fetcher)).toBe(file);
  expect(fetcher).toHaveBeenCalledOnce();
  await writeFile(file,Buffer.alloc(body.length));
  await contributionComponent(c,c.file,cache,fetcher);
  expect(await readFile(file)).toEqual(body);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([Buffer.from("short"),Buffer.alloc(body.length),Buffer.alloc(body.length+1)])("never commits incomplete, corrupt or oversized bytes", async payload => {
  const cache=await root();
  await expect(contributionComponent(c,c.file,cache,vi.fn(async()=>new Response(payload)))).rejects.toThrow();
  expect(await readdir(path.join(cache,sha256))).toEqual([]);
});
it("rejects unpinned paths, platforms, sizes, redirects and URLs before installation",async()=>{
  const fetcher=vi.fn<typeof fetch>();const cache=await root();
  for(const patch of [{file:"../runtime.pkg"},{bytes:0},{bytes:2_000_000_001},{sha256:"bad"},
    {url:c.url+"?extra=1"},{url:c.url.replace("github.com","evil.invalid")},
    {url:c.url.replace(sha256,"a".repeat(64))}])
    await expect(contributionComponent({...c,...patch},c.file,cache,fetcher)).rejects.toThrow();
  await expect(contributionComponent(c,"mycellios-runtime.msi",cache,fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"https://evil.invalid/runtime.pkg"}}));
  await expect(contributionComponent(c,c.file,cache,fetcher)).rejects.toThrow();
});
