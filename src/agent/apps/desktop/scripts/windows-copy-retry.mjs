import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout } from 'node:timers/promises';

/** Antivirus/indexer locks are transient. Never retry permission or path errors. */
export async function retryBusyCopy(copy, pause = setTimeout) {
  for (let attempt = 0; ; attempt++) {
    try { return await copy(); }
    catch (error) {
      if (error?.code !== 'EBUSY' || attempt >= 7) throw error;
      await pause(Math.min(100 * 2 ** attempt, 2000));
    }
  }
}

/** Install before loading electron-builder, whose fs-extra captures fs.copyFile. */
export async function withWindowsCopyRetry(action) {
  if (process.platform !== 'win32') return action();
  const callbackCopy = fs.copyFile, promiseCopy = fs.promises.copyFile;
  fs.copyFile = (...args) => {
    const callback = args.pop();
    retryBusyCopy(() => new Promise((resolve, reject) => {
      callbackCopy(...args, error => error ? reject(error) : resolve());
    })).then(() => callback(null), error => callback(error));
  };
  fs.promises.copyFile = (...args) => retryBusyCopy(() => promiseCopy(...args));
  syncBuiltinESMExports();
  try { return await action(); }
  finally {
    fs.copyFile = callbackCopy;
    fs.promises.copyFile = promiseCopy;
    syncBuiltinESMExports();
  }
}
