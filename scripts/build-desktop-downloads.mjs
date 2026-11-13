import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await build({ configFile: false, root: resolve("landing"), base: "/downloads/desktop/", publicDir: false,
  plugins: [react()], build: { outDir: resolve("build/desktop-downloads/web"), emptyOutDir: true,
    rollupOptions: { input: resolve("landing/desktop-downloads.html") } } });
const root=resolve('build/desktop-downloads/web'),files={};
async function seal(directory,relative='') {
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  if(entry.isSymbolicLink())throw Error('Download page cannot contain links');
  const name=relative+entry.name,file=resolve(directory,entry.name);
  if(entry.isDirectory())await seal(file,name+'/');
  else files[name]=createHash('sha256').update(await readFile(file)).digest('hex');
 }
}
await seal(root);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
await writeFile(resolve(root,'build-receipt.json'),JSON.stringify({schema:'mycellios-download-page/1',revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),files},null,2)+'\n');
