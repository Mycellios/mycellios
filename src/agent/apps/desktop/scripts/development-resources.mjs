import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { snapshotDevelopmentSource, developmentToolchain } from '../src/development-copy.ts';
const require=createRequire(import.meta.url);
export async function stageDevelopmentResources(desktopRoot) {
  const agent=path.resolve(desktopRoot,'../..'),repository=path.resolve(agent,'../..');
  const stage=await mkdtemp(path.join(tmpdir(),'mycellios-development-source-'));
  const source=path.join(stage,'source');
  await snapshotDevelopmentSource(repository,source);
  await writeFile(path.join(source,'src/agent/development-toolchain.json'),JSON.stringify(await developmentToolchain(agent),null,2));
  const candidates=[...(process.env.npm_execpath?[path.resolve(process.env.npm_execpath,'../..')]:[]),path.join(path.dirname(process.execPath),'node_modules/npm')];
  try{candidates.push(path.dirname(require.resolve('npm/package.json')));}catch{}
  for(const npm of candidates)try{const pkg=JSON.parse(await readFile(path.join(npm,'package.json'),'utf8'));if(pkg.name==='npm' && (await stat(path.join(npm,'bin/npm-cli.js'))).isFile())return {source,npm};}catch{}
  throw new Error('Packaging development mode requires npm sources, including their bundled dependencies and license.');
}
