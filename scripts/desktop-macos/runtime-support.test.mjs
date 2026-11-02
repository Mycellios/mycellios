import test from'node:test';import assert from'node:assert/strict';import{supportsContribution}from'./source/runtime-support.ts';
test('Intel Desktop never advertises the ARM-only contribution installer',()=>{
 assert.equal(supportsContribution('darwin','x64'),false);assert.equal(supportsContribution('darwin','arm64'),true);assert.equal(supportsContribution('darwin','ia32'),false);
 assert.equal(supportsContribution('win32','x64'),true);assert.equal(supportsContribution('linux','x64'),true);
});
