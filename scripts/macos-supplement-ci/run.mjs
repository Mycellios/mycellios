import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// This workflow checks a narrow inherited119 module. It does not replace main's
// product source, reconstruct all production source, build an image or publish.
const root = process.cwd();
const recipe = path.join(root, 'scripts/macos-supplement-ci');
const out = path.join(root, 'runtime/macos-supplement-ci');
const sha = value => createHash('sha256').update(value).digest('hex');
const inputBytes = fs.readFileSync(path.join(recipe, 'inputs.json'));
assert.equal(sha(inputBytes), '967b422024d798678c0eb409670ca2884cf5c7d03cf7a8d46df808c140276944');
const input = JSON.parse(inputBytes);
assert.equal(input.schema, 'mycellios-macos-supplement-ci-inputs/1');
assert.equal(input.completeProductionSourceReconstructed, false);
assert.equal(input.files.length, 7);
assert(!fs.existsSync(out), 'Preserve previous CI outputs');
fs.mkdirSync(out, { recursive: true });
const fixture = path.join(out, 'fixture');
const rows = new Map();
for (const row of input.files) {
  assert(!rows.has(row.path), 'Duplicate input');
  const bytes = Buffer.from(row.base64, 'base64');
  assert.equal(bytes.length, row.bytes);
  assert.equal(sha(bytes), row.sha256);
  const text = bytes.toString('utf8');
  // Explicit public-recipe audit in decoded bytes; base64 must not hide host data.
  assert(!/DESKTOP-[A-Z0-9]+|[A-Z]:[/\\]Users[/\\]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}/i.test(text), 'Personal host data or credential in recipe input');
  rows.set(row.path, bytes);
}
function put(relative, bytes) {
  const target = path.join(fixture, relative);
  assert(target.startsWith(fixture + path.sep));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
}
const baselineTs = rows.get('runtime/macos-supplement119/release-upload.baseline.ts');
const baselineJs = rows.get('runtime/macos-supplement119/release-upload.baseline.js');
assert.equal(sha(baselineTs), 'f4987800945e632d2d8f72fe29f3918b96661a0b94e91c871055e2ead5c88d7b');
assert.equal(sha(baselineJs), '11808238e332c6a211ab6533de7861000e780bdb084888759c9ee89b7ea1f64a');
put('runtime/macos-supplement119/baseline-source/coordinator/release-upload.ts', baselineTs);
for (const relative of ['src/coordinator/release-upload.ts', 'src/coordinator/macos-release-supplement.ts', 'tests/macos-release-supplement.test.ts', 'tests/macos-release-supplement-integration.test.ts']) put(relative, rows.get(relative));
put('package.json', '{"type":"module"}\n');
put('vitest.config.mts', 'import {defineConfig} from "vitest/config";export default defineConfig({test:{include:["tests/**/*.test.ts"],testTimeout:60000,hookTimeout:30000}});\n');
const baseline = JSON.parse(rows.get('runtime/macos-supplement119/baseline-reproduction.json'));
assert.equal(sha(fs.readFileSync('node_modules/typescript/package.json')), baseline.typescriptPackageSha256);
assert.equal(sha(fs.readFileSync('tsconfig.json')), baseline.compilerConfigSha256);
assert.equal(sha(fs.readFileSync('tsconfig.build.json')), baseline.compilerBuildConfigSha256);
const command = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
function config(name, fields) {
  const file = path.join(out, name + '.json');
  fs.writeFileSync(file, JSON.stringify(fields, null, 2) + '\n', { flag: 'wx' });
  return file;
}
const baselineRoot = path.join(fixture, 'runtime/macos-supplement119/baseline-source');
const baselineOut = path.join(out, 'baseline-output');
command(tsc, '-p', config('baseline-compiler', { extends: path.join(root, 'tsconfig.build.json'), compilerOptions: { rootDir: baselineRoot, outDir: baselineOut, newLine: 'lf', declaration: false }, files: [path.join(baselineRoot, 'coordinator/release-upload.ts')], include: [], exclude: [] }));
assert(fs.readFileSync(path.join(baselineOut, 'coordinator/release-upload.js')).equals(baselineJs), 'Baseline119 reproduction is not byte exact');
command(tsc, '-p', config('closure-compiler', { extends: path.join(root, 'tsconfig.json'), compilerOptions: { rootDir: fixture, noEmit: true }, include: [path.join(fixture, '**/*.ts')], exclude: [] }));
const testReport = path.join(out, 'focused-tests.json');
command(path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--root', fixture, '--config', path.join(fixture, 'vitest.config.mts'), '--reporter=json', '--outputFile=' + testReport);
const tests = JSON.parse(fs.readFileSync(testReport));
assert.equal(tests.numFailedTests, 0);
assert.equal(tests.numPassedTests, 37);
assert.equal(tests.numPendingTests, 0);
const compiled = path.join(out, 'overlay-output');
command(tsc, '-p', config('overlay-compiler', { extends: path.join(root, 'tsconfig.build.json'), compilerOptions: { rootDir: path.join(fixture, 'src'), outDir: compiled, newLine: 'lf', declaration: false }, files: [path.join(fixture, 'src/coordinator/release-upload.ts'), path.join(fixture, 'src/coordinator/macos-release-supplement.ts')], include: [], exclude: [] }));
const outputs = fs.readdirSync(path.join(compiled, 'coordinator')).sort().map(name => {
  assert(['release-upload.js', 'release-upload.js.map', 'macos-release-supplement.js', 'macos-release-supplement.js.map'].includes(name));
  const bytes = fs.readFileSync(path.join(compiled, 'coordinator', name));
  return { path: 'coordinator/' + name, bytes: bytes.length, sha256: sha(bytes) };
});
assert.equal(outputs.length, 4);
fs.writeFileSync(path.join(out, 'verified-build.json'), JSON.stringify({ schema: 'mycellios-macos-supplement-ci-build/1', recipeGitRevision: process.env.GITHUB_SHA ?? null, baseGitRevision: input.baseGitRevision, inheritedProductionSourceId: input.inheritedProductionSourceId, inputsSha256: sha(inputBytes), baselineJavaScriptSha256: sha(baselineJs), baselineByteExact: true, focusedTests: 37, closureStrictTypecheck: true, outputs, fullProductionSourceReconstructed: false, imageBuilt: false, deployed: false }, null, 2) + '\n', { flag: 'wx' });
