import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {electronQualificationRuntime} from './electron-qualification-runtime.mjs';

test('native qualification retains dynamically exposed CommonJS Electron APIs',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-qualification-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=path.join(root,'node_modules/@playwright/test');await mkdir(pkg,{recursive:true});
 await writeFile(path.join(root,'package.json'),'{}');await writeFile(path.join(pkg,'package.json'),'{"main":"index.cjs"}');
 await writeFile(path.join(pkg,'index.cjs'),'const api={_electron:{launch:()=>"launch"},expect:{poll:()=>"poll"}};for(const key of Object.keys(api))Object.defineProperty(module.exports,key,{get:()=>api[key]});');
 const manifest=path.join(root,'package.json'),resolved=createRequire(manifest).resolve('@playwright/test');
 assert.equal((await import(pathToFileURL(resolved).href))._electron,undefined);
 const runtime=electronQualificationRuntime(manifest);assert.equal(runtime._electron.launch(),'launch');assert.equal(runtime.expect.poll(),'poll');
});
test('qualification fails clearly if the selected dependency lacks a native launcher',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-qualification-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=path.join(root,'node_modules/@playwright/test');await mkdir(pkg,{recursive:true});await writeFile(path.join(root,'package.json'),'{}');
 await writeFile(path.join(pkg,'index.js'),'module.exports={expect:{poll(){}}}');
 assert.throws(()=>electronQualificationRuntime(path.join(root,'package.json')),/Native Electron qualification API unavailable/);
});
