import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseInputs, writeReleaseReceipt } from '../apps/desktop/scripts/release-continuity.mjs';

const agent = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const inputs = await releaseInputs(agent);
const desktop = process.argv.includes('--desktop');
execFileSync(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'], {
  cwd: fileURLToPath(new URL('../apps/web/', import.meta.url)),
  env: { ...process.env, NODE_ENV: 'production', ...(desktop ? {APP_BASE_PATH:'/'} : {}) }, stdio: 'inherit',
});
if (desktop) execFileSync(process.execPath, [
  path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
  'build', '--outDir', path.join(agent,'apps/web/dist/first-party'),
], {
  cwd: fileURLToPath(new URL('../apps/web/', import.meta.url)),
  env: {...process.env,NODE_ENV:'production',APP_BASE_PATH:'/agent/'}, stdio:'inherit',
});
await writeReleaseReceipt(agent, 'web', inputs);
