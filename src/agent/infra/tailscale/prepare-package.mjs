import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = JSON.parse(await readFile(process.argv[2], 'utf8'));
const dependency = source.packages?.['node_modules/undici'];
assert.equal(dependency?.version, '8.12.3', 'Review gateway compatibility when updating undici');
assert.ok(dependency.integrity && dependency.resolved, 'Gateway needs a sealed dependency');
assert.equal(Object.keys(dependency.dependencies ?? {}).length, 0, 'Seal transitive dependencies before adding any');
const manifest = { name: 'mycellios-tailscale-gateway', version: '1.0.0', private: true,
  type: 'module', dependencies: { undici: dependency.version } };
const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
  packages: { '': manifest, 'node_modules/undici': dependency } };
const output = process.argv[3] ?? '.';
await writeFile(join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(output, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
