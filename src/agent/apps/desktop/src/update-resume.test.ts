import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { restoreUpdateBinding, saveUpdateResume } from "./update-resume.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
const identity = {userId:"owner",spaceId:"space",connectionId:"authenticated-session"};
const binding = {base:"https://example.test/agent",...identity,deviceId:"11111111-1111-4111-8111-111111111111",generation:"22222222-2222-4222-8222-222222222222"};
it("restores only the planned version and freshly authenticated owner/server/session", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"update-continuity-"));roots.push(root);
  await saveUpdateResume(root,"0.3.16","0.3.17",[binding]);
  expect(await restoreUpdateBinding(root,"0.3.17",binding.base,identity)).toEqual(binding);
  expect(await restoreUpdateBinding(root,"0.3.16",binding.base,identity)).toEqual(binding);
  for (const changed of [{userId:"other"},{spaceId:"other"},{connectionId:"other"}])
    expect(await restoreUpdateBinding(root,"0.3.17",binding.base,{...identity,...changed})).toBeUndefined();
  expect(await restoreUpdateBinding(root,"0.3.18",binding.base,identity)).toBeUndefined();
  expect(await restoreUpdateBinding(root,"0.3.17","https://foreign.test/agent",identity)).toBeUndefined();
  expect(await restoreUpdateBinding(root,"0.3.17",binding.base,identity,"unowned-bot")).toBeUndefined();
  const file=path.join(root,"desktop-update-resume.json"), saved=JSON.parse(await readFile(file,"utf8"));
  await writeFile(file,JSON.stringify({...saved,expires:Date.now()-1}));
  expect(await restoreUpdateBinding(root,"0.3.17",binding.base,identity)).toBeUndefined();
});
