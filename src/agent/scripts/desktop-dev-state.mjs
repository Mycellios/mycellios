import {createHash, timingSafeEqual} from 'node:crypto';
import {readdir, readFile, realpath} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export async function developmentIdentity(root) {
  const source = await realpath(root);
  const digest = createHash('sha256').update(source).digest('hex');
  return {source, id: `wt-${digest}`, hue: parseInt(digest.slice(0, 4), 16) % 360};
}

export function developmentStack(raw) {
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || !path.isAbsolute(value.data) || !['web', 'api', 'ready'].every(key =>
    Number.isInteger(value[key]) && value[key] >= 1024 && value[key] <= 65535) ||
    new Set([value.web, value.api, value.ready]).size !== 3)
    throw new Error('Invalid isolated development stack');
  return {data: value.data, web: value.web, api: value.api, ready: value.ready};
}

export async function freeDevelopmentPorts() {
  const servers = [];
  try {
    for (let i = 0; i < 3; i++) {
      const server = net.createServer();
      await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
      servers.push(server);
    }
    return Object.fromEntries(['web', 'api', 'ready'].map((key, i) => [key, servers[i].address().port]));
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}

/** Include manifests, lock, patches and schema, so successful work is reusable. */
export async function preparationFingerprint(root) {
  const files = ['package.json', 'package-lock.json'];
  for (const parent of ['apps', 'packages']) {
    let names;try{names=await readdir(path.join(root,parent));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for (const name of names.sort()) {
      const file = `${parent}/${name}/package.json`;
      try {await readFile(path.join(root, file)); files.push(file);} catch (error) {if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;}
    }
  }
  async function visit(folder) {
    for (const entry of (await readdir(path.join(root, folder), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  for (const folder of ['patches', 'packages/db/prisma']) {
    try {await visit(folder);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

/** Reuse an existing npm-ci installation only when npm's installed lock agrees. */
export async function installedDevelopmentDependencies(root) {
  try {
    const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
    const installed=JSON.parse(await readFile(path.join(root,'node_modules/.package-lock.json'),'utf8'));
    if(lock.lockfileVersion!==3 || installed.lockfileVersion!==3)return false;
    for(const [name,expected] of Object.entries(lock.packages)) {
      if(!name)continue;
      const actual=installed.packages[name];
      if(!actual) {if(expected.optional)continue;return false;}
      for(const key of ['version','integrity','link'])if(expected[key]!==actual[key])return false;
    }
    return true;
  } catch {return false;}
}

export function authorizedControl(request, port, token) {
  const supplied = request.headers.authorization;
  const expected = `Bearer ${token}`;
  return request.method === 'POST' && request.headers.host === `127.0.0.1:${port}` &&
    !request.headers.origin && typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
