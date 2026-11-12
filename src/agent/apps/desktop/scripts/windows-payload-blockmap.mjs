import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/** Use the pinned builder's normal sidecar format without rewriting the EXE. */
export async function writeWindowsPayloadBlockmap(installer) {
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
  return buildBlockMap(installer, 'gzip', installer + '.blockmap');
}
