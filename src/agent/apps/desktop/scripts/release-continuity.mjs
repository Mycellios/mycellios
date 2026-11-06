import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RECEIPT = 'release-inputs.json';
const EXCLUDED = new Set(['node_modules', 'dist', 'out', 'outputs', '.git', '.turbo']);

function surfaceRoot(agentRoot, surface) {
  return surface === 'local-server' ? path.join(agentRoot, 'apps/desktop/local-server') :
    path.join(agentRoot, 'apps', surface, 'dist');
}

async function digestTree(root, entries, output = false) {
  const files = [];
  async function visit(relative) {
    let children;
    try { children = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOTDIR') { files.push(relative); return; }
      if (error.code === 'ENOENT' && !output) return;
      throw error;
    }
    for (const child of children) {
      if ((EXCLUDED.has(child.name) && !(output && child.name === 'dist')) || child.name.endsWith('.tsbuildinfo') ||
          (output && (child.name === RECEIPT || child.name.endsWith('.map')))) continue;
      const name = path.join(relative, child.name);
      if (child.isSymbolicLink()) throw new Error('Release input must belong to this checkout: ' + name);
      if (child.isDirectory()) await visit(name);
      else if (child.isFile()) files.push(name);
    }
  }
  for (const entry of entries) await visit(entry);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(JSON.stringify(file.split(path.sep).join('/')) + '\n');
    hash.update(createHash('sha256').update(await readFile(path.join(root, file))).digest());
  }
  if (!files.length) throw new Error('Empty release inputs: ' + root);
  return hash.digest('hex');
}

/** Include uncommitted canonical sources too; never build from a saved Git snapshot. */
export async function releaseInputs(agentRoot) {
  const version = JSON.parse(await readFile(path.join(agentRoot, 'apps/desktop/package.json'), 'utf8')).version;
  const sourceHash = await digestTree(agentRoot, [
    'package.json', 'package-lock.json', 'tsconfig.base.json', 'scripts',
    'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/assets', 'apps/desktop/package.json',
    'apps/desktop/tsconfig.json', 'apps/web/src', 'apps/web/public',
    'apps/web/index.html', 'apps/web/package.json', 'apps/web/vite.config.ts',
    'apps/api/src', 'apps/api/package.json', 'apps/worker/src', 'apps/worker/package.json',
    'packages', '../contracts',
  ]);
  return { version, sourceHash };
}

export async function writeReleaseReceipt(agentRoot, surface, inputs) {
  if (!['desktop', 'web', 'local-server'].includes(surface)) throw new Error('Unknown release surface');
  const current = await releaseInputs(agentRoot);
  if (JSON.stringify(current) !== JSON.stringify(inputs)) throw new Error('Source changed during build; rebuild before packaging');
  const dist = surfaceRoot(agentRoot, surface);
  await readFile(path.join(dist, surface === 'local-server' ? 'dist/desktop-local-entry.js' : surface === 'desktop' ? 'main.js' : 'index.html'));
  const outputHash = await digestTree(dist, ['.'], true);
  await writeFile(path.join(dist, RECEIPT), JSON.stringify({
    schema: 'mycellios-desktop-release/1', surface, ...inputs, outputHash,
  }, null, 2) + '\n');
}

/** electron-builder gate shared by ordinary and unified installers. */
export async function verifyDesktopRelease(desktopRoot) {
  const agentRoot = path.resolve(desktopRoot, '../..');
  const inputs = await releaseInputs(agentRoot);
  for (const surface of ['desktop', 'web', 'local-server']) {
    const dist = surfaceRoot(agentRoot, surface);
    let receipt;
    try { receipt = JSON.parse(await readFile(path.join(dist, RECEIPT), 'utf8')); }
    catch { throw new Error(`Missing ${surface} release receipt; rebuild web and Desktop from this checkout`); }
    if (receipt.schema !== 'mycellios-desktop-release/1' || receipt.surface !== surface ||
        receipt.version !== inputs.version || receipt.sourceHash !== inputs.sourceHash)
      throw new Error(`Stale ${surface} build; rebuild web and Desktop from this checkout`);
    if (receipt.outputHash !== await digestTree(dist, ['.'], true))
      throw new Error(`Modified ${surface} bundle; rebuild before packaging`);
  }
  const firstParty = await readFile(path.join(agentRoot, 'apps/web/dist/first-party/index.html'), 'utf8');
  if (!firstParty.includes('/agent/assets/')) throw new Error('Missing namespaced first-party frontend; build web with --desktop');
}
