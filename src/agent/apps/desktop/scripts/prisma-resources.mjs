import { cp, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Preserve unfinished source folders, but never ship an empty migration as executable SQL. */
export async function stagePrismaResources(source, target) {
  const migrations = path.join(source, 'migrations');
  await cp(source, target, {recursive:true, filter:async file => {
    if (path.dirname(file) !== migrations || !(await lstat(file)).isDirectory()) return true;
    const files = await readdir(file);
    if (!files.length) return false;
    if (!files.includes('migration.sql')) throw new Error('Nonempty migration is missing SQL: ' + path.basename(file));
    return true;
  }});
}
