import { existsSync } from 'node:fs';
import path from 'node:path';

export function localResourcePaths(root: string) {
  const archive = path.join(root, 'runtime.asar');
  const compact = existsSync(archive);
  return {
    entry: compact ? path.join(root,'compact-server-entry.cjs') : path.join(root,'dist','desktop-local-entry.js'),
    migrationsRoot: root,
  };
}
