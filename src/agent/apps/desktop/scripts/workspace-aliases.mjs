import fs from 'node:fs/promises';
import path from 'node:path';
/** Resolve first-party sources from this checkout, never from stale workspace junctions. */
export async function workspaceAliases(root, { patterns = false } = {}) {
  const aliases = {};
  for (const name of await fs.readdir(path.join(root, 'packages'))) {
    const folder = path.join(root, 'packages', name);
    let pkg;
    try { pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      if (key.includes('*') && !patterns) continue;
      let target = value;
      while (target && typeof target === 'object') target = target.development ?? target.types ?? target.import ?? target.default;
      if (typeof target === 'string') aliases[pkg.name + (key === '.' ? '' : key.slice(1))] = path.resolve(folder, target);
    }
  }
  return aliases;
}

export async function workspaceViteAliases(root) {
  return Object.entries(await workspaceAliases(root, {patterns:true})).map(([name, replacement]) => ({
    find: new RegExp('^' + name.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+)') + '$'),
    replacement: replacement.replace('*', '$1'),
  }));
}
