import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {DEVELOPMENT_CHECKOUT_FILE,developmentCheckout} from "./development-checkout.js";

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture({git=true,installed=true}={}) {
  const base=await mkdtemp(path.join(tmpdir(),"mycellios-checkout-"));roots.push(base);
  const userData=path.join(base,"user"),repo=path.join(base,"repo"),agent=path.join(repo,"src/agent");
  await mkdir(path.join(agent,"scripts"),{recursive:true});await mkdir(userData,{recursive:true});
  await writeFile(path.join(agent,"scripts/desktop-development.mjs"),"");
  if(git)await writeFile(path.join(repo,".git"),"gitdir: elsewhere\n");
  if(installed){await mkdir(path.join(agent,"node_modules/vite"),{recursive:true});await writeFile(path.join(agent,"node_modules/vite/package.json"),"{}");}
  const choose=(value:unknown)=>writeFile(path.join(userData,DEVELOPMENT_CHECKOUT_FILE),JSON.stringify(value));
  return {userData,repo,agent,choose};
}
it("keeps the bundled copy until the owner chooses a checkout",async()=>{
  const {userData}=await fixture();
  expect(await developmentCheckout(userData)).toBeNull();
});
it("returns the chosen git checkout and its agent workspace",async()=>{
  const {userData,repo,choose}=await fixture();
  await choose({schema:"mycellios-development-checkout/1",path:repo});
  const checkout=await developmentCheckout(userData);
  expect(path.basename(checkout!.workspace)).toBe("agent");
  await expect(checkout!.validate()).resolves.toBeUndefined();
});
it("refuses a folder that is not a git checkout, has no dependencies or is malformed",async()=>{
  const notGit=await fixture({git:false});await notGit.choose({schema:"mycellios-development-checkout/1",path:notGit.repo});
  await expect(developmentCheckout(notGit.userData)).rejects.toThrow(/not a git repository/);
  const bare=await fixture({installed:false});await bare.choose({schema:"mycellios-development-checkout/1",path:bare.repo});
  await expect(developmentCheckout(bare.userData)).rejects.toThrow(/npm ci/);
  const relative=await fixture();await relative.choose({schema:"mycellios-development-checkout/1",path:"repo"});
  await expect(developmentCheckout(relative.userData)).rejects.toThrow(/Invalid/);
});
