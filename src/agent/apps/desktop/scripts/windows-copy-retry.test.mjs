import test from 'node:test';
import assert from 'node:assert/strict';
import { retryBusyCopy, withWindowsCopyRetry } from './windows-copy-retry.mjs';
import fs from 'node:fs';

test('retries a brief busy lock and preserves the successful copy result', async () => {
  let attempts = 0; const pauses = [];
  assert.equal(await retryBusyCopy(async () => {
    if (++attempts < 3) throw Object.assign(new Error('locked'), {code:'EBUSY'});
    return 'copied';
  }, async ms => pauses.push(ms)), 'copied');
  assert.deepEqual(pauses, [100,200]);
});
test('permission failures are immediate and a persistent busy lock remains an error', async () => {
  for (const [code, expected] of [['EACCES',1],['EBUSY',8]]) {
    let calls=0; const error=Object.assign(new Error(code),{code});
    await assert.rejects(retryBusyCopy(async()=>{calls++;throw error;},async()=>{}), e=>e===error);
    assert.equal(calls,expected);
  }
});
test('restores the normal filesystem functions when packaging fails', async () => {
  const callback=fs.copyFile, promise=fs.promises.copyFile;
  await assert.rejects(withWindowsCopyRetry(async()=>{throw Error('pack failed');}),/pack failed/);
  assert.equal(fs.copyFile,callback); assert.equal(fs.promises.copyFile,promise);
});
