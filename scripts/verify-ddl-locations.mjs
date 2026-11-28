#!/usr/bin/env node
// Database schema statements (DDL) outside the coordinator's declared schema paths fail CI.
// Nucleus skips the pre-deploy database copy when a release touches none of those paths, so
// DDL anywhere else could reach production without that copy. See config/ddl-locations.json.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DDL = /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|index|type|extension|schema|trigger|function|view|policy|sequence)\b/i;
const SOURCE = /\.(?:[cm]?[jt]sx?|sql|py)$/;

/** Files whose content holds DDL but whose path is neither a schema path nor ignored. */
export function misplacedDdl(files, read, config) {
  const under = (file, prefixes) => prefixes.some(prefix => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix));
  return files
    .filter(file => SOURCE.test(file) && !under(file, config.schemaPaths) && !under(file, config.ignoredPaths))
    .filter(file => DDL.test(read(file)))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(readFileSync('config/ddl-locations.json', 'utf8'));
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const found = misplacedDdl(files, file => {
    try { return readFileSync(file, 'utf8'); } catch { return ''; }
  }, config);
  if (found.length) {
    console.error(`Database schema statements outside config/ddl-locations.json schemaPaths:\n- ${found.join('\n- ')}\n` +
      'Move them under a schema path, or add the path there and to the coordinator migrationPaths in Nucleus in the same change. Test fixtures belong in ignoredPaths.');
    process.exit(1);
  }
  console.log(`DDL only in declared schema paths (${config.schemaPaths.join(', ')})`);
}
