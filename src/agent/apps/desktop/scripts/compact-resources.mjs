import {createRequire} from 'node:module';
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const binary = /\.(?:node|exe|dll|so(?:\.\d+)*|dylib|wasm)$/i;

async function filesIn(root) {
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw Error('Compact resources require a relocated tree without links: '+name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name.split(path.sep).join('/'));
    }
  }
  await walk(''); return files.sort();
}

function packageRoot(file) {
  const parts = file.split('/'), i = parts.lastIndexOf('node_modules');
  if (i < 0 || !parts[i+1]) throw Error('Native resource is outside a package: '+file);
  return parts.slice(0, i + (parts[i+1].startsWith('@') ? 3 : 2)).join('/');
}

export async function compactPlan(source) {
  const files = await filesIn(source);
  const nativeRoots = [...new Set(files.filter(f=>binary.test(f)).map(packageRoot))]
    .sort((a,b)=>a.length-b.length)
    .filter((p,i,all)=>!all.slice(0,i).some(parent=>p.startsWith(parent+'/')));
  const external = file => file==='package.json' || file==='prisma.config.mjs' ||
    file.startsWith('prisma/') || nativeRoots.some(p=>file===p || file.startsWith(p+'/'));
  const packed = files.filter(f=>!external(f));
  return {files,nativeRoots,packed,external};
}

export async function compactServer(source, target) {
  await mkdir(target, {recursive:true});
  const {files,nativeRoots,packed,external}=await compactPlan(source);
  const archive = path.join(target, 'runtime.asar');
  await asar.createPackageFromFiles(source, archive, packed.map(f=>path.join(source,f)));
  for (const file of files.filter(external)) {
    const destination = path.join(target,file);
    await mkdir(path.dirname(destination),{recursive:true});
    await cp(path.join(source,file), destination);
  }
  await cp(fileURLToPath(new URL('./compact-resource-preload.cjs',import.meta.url)),path.join(target,'compact-resource-preload.cjs'));
  await cp(fileURLToPath(new URL('./compact-server-entry.cjs',import.meta.url)),path.join(target,'compact-server-entry.cjs'));
  // Check byte-for-byte preservation, including native modules and licenses.
  const digest = createHash('sha256');
  for (const file of files) {
    const input = await readFile(path.join(source,file));
    const output = external(file) ? await readFile(path.join(target,file)) : asar.extractFile(archive,path.normalize(file));
    if (!input.equals(output)) throw Error('Compact resource differs: '+file);
    digest.update(file+'\n').update(createHash('sha256').update(input).digest());
  }
  const receipt = {schema:'mycellios-compact-resources/1',sourceFiles:files.length,
    packedFiles:packed.length,physicalFiles:files.length-packed.length+4,nativeRoots,
    preservedTreeSha256:digest.digest('hex')};
  await writeFile(path.join(target,'compact-resources.json'),JSON.stringify(receipt,null,2));
  return receipt;
}

export async function compactDirectory(source, destination) {
  await mkdir(path.dirname(destination),{recursive:true});
  await asar.createPackage(source,destination);
}

export async function verifyCompactServer(root) {
  const receipt=JSON.parse(await readFile(path.join(root,'compact-resources.json'),'utf8'));
  const files=await filesIn(root);
  if(receipt.schema!=='mycellios-compact-resources/1' || files.length!==receipt.physicalFiles ||
      files.length>3000 || files.includes('dist/desktop-local-entry.js'))
    throw Error(`Packaged compact server contains a duplicate or unexpected loose tree (expected ${receipt.physicalFiles}, found ${files.length})`);
  return receipt;
}

export async function stageCompactResources(desktopRoot, development, output) {
  const destination=path.join(output,'compact-resources');
  const server=path.join(destination,'local-server');
  const receipt=await compactServer(path.join(desktopRoot,'local-server'),server);
  if(receipt.physicalFiles>3000) throw Error('Local server exceeds the compact physical-file budget');
  // A directory inside the archive can be copied by Electron fs.cp; the .asar
  // file itself is a regular file to stat and must never be used as a seed root.
  const sourceFiles=await filesIn(development.source);
  await asar.createPackageFromFiles(path.dirname(development.source),path.join(destination,'development-source.asar'),sourceFiles.map(f=>path.join(development.source,f)));
  await compactDirectory(development.npm,path.join(destination,'development-npm.asar'));
  return {server,source:path.join(destination,'development-source.asar'),npm:path.join(destination,'development-npm.asar'),receipt};
}
