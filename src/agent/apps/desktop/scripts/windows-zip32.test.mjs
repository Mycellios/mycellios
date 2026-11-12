import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import verifyWindowsZip32 from './verify-windows-zip32.cjs';
const { verifyZip32Totals } = verifyWindowsZip32;

test('ZIP32 rejects ZIP64-sized payloads and too many directory entries', () => {
  verifyZip32Totals({ files: 1, entries: 60_000, bytes: 0xdfffffff, largest: 0xdfffffff });
  for (const value of [
    { files: 1, entries: 60_001, bytes: 1, largest: 1 },
    { files: 1, bytes: 0xe0000000, largest: 0xe0000000 },
    { files: 0, bytes: 0, largest: 0 },
    { files: 1, bytes: Number.NaN, largest: 0 },
  ]) assert.throws(() => verifyZip32Totals(value), /ZIP32 bounds/);
});

test('afterPack checks the actual nested payload', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'windows-zip32-'));
  try {
    await mkdir(path.join(root, 'resources'));
    await writeFile(path.join(root, 'resources/runtime.asar'), 'preserved runtime');
    await writeFile(path.join(root, 'app.exe'), 'executable fixture');
    await verifyWindowsZip32({ appOutDir: root });
  } finally { await rm(root, { recursive: true, force: true }); }
});
