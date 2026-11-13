import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// require.resolve selects Playwright's CJS entry. Loading that file as an ESM
// namespace loses its dynamically exposed Electron launcher; use its actual API.
export function electronQualificationRuntime(manifest=new URL('../src/agent/apps/desktop/package.json',import.meta.url)) {
 const runtime=createRequire(manifest)('@playwright/test');
 if(typeof runtime._electron?.launch!=='function'||typeof runtime.expect?.poll!=='function')throw Error('Native Electron qualification API unavailable');
 return runtime;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 electronQualificationRuntime();console.log('Native Electron qualification API ready');
}
