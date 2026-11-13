import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {walkSequential} from './macos-sign-walk.mjs';

test('large signing traversal bounds open files and seals nested code inside out',async()=>{
  const root=path.resolve('fixture'), framework=path.join(root,'Nested.framework');
  const names=Array.from({length:600},(_,i)=>`file-${i}`);
  let active=0,maximum=0;const removed=[];
  const io={
    readdir:async dir=>dir===root?[...names,'text.txt','old.cstemp','Nested.framework']:['binary.node'],
    stat:async file=>({isFile:()=>file!==framework,isDirectory:()=>file===framework,isSymbolicLink:()=>false}),
    unlink:async file=>removed.push(file),
  };
  const result=await walkSequential(root,{io,isBinaryFile:async file=>{
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
    return !file.endsWith('.txt');
  }});
  assert.equal(maximum,1);assert.equal(result.length,602);
  assert.deepEqual(result.slice(-2),[path.join(framework,'binary.node'),framework]);
  assert.deepEqual(removed,[path.join(root,'old.cstemp')]);
});

test('unreadable code fails the signing walk instead of silently omitting it',async()=>{
  const io={readdir:async()=>['binary'],stat:async()=>({isFile:()=>true})};
  await assert.rejects(walkSequential(path.resolve('fixture'),{io,isBinaryFile:async()=>{throw Error('read denied');}}),/read denied/);
});
