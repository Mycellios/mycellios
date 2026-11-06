import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { eventBase, planChecks } from './ci-proportional.mjs';

test('documentation requires no dependency installation', () => {
  const plan = planChecks(['docs/DEVELOPMENT.md', 'AGENTS.md']);
  assert.ok(plan.some(c => c.label === 'CI policy tests'));
  assert.ok(!plan.some(c => c.bin === 'npm'));
});
test('CSS and translations use the presentation-only fast route', () => {
  const plan = planChecks(['landing/src/styles.css', 'src/agent/apps/web/src/styles.css', 'src/agent/apps/web/src/locales/es/messages.po']);
  assert.ok(!plan.some(c => c.bin === 'npm'));
});
test('changed tests execute directly rather than relying on import discovery', () => {
  const plan = planChecks(['src/agent/apps/web/src/example.test.tsx', 'tests/example.test.ts']);
  assert.ok(plan.some(c => c.label === 'Agent changed tests' && c.args.includes('apps/web/src/example.test.tsx')));
  assert.ok(plan.some(c => c.label === 'root changed tests' && c.args.includes('tests/example.test.ts')));
});
test('Agent web uses only its owned dependency graph and affected surface', () => {
  const plan = planChecks(['src/agent/apps/web/src/pages/Shell.tsx']);
  assert.equal(plan.filter(c => c.args[0] === 'ci').length, 1);
  assert.ok(plan.some(c => c.label === 'Agent web types'));
  assert.ok(!plan.some(c => c.label === 'Agent api types'));
  assert.ok(plan.some(c => c.label === 'Agent affected tests' && c.args.includes('apps/web/src/pages/Shell.tsx')));
});
test('shared Agent contracts check all consumers', () => {
  const plan = planChecks(['src/agent/packages/contracts/src/rpc.ts']);
  for (const app of ['web', 'api', 'worker', 'desktop']) assert.ok(plan.some(c => c.label === `Agent ${app} types`));
});
test('Agent test files share the existing two-worker budget without serializing discovery', () => {
  const plan = planChecks(['src/agent/apps/web/src/pages/Shell.tsx', 'src/agent/apps/web/src/pages/shell/composer.test.tsx']);
  for (const check of plan.filter(c => c.label === 'Agent changed tests' || c.label === 'Agent affected tests')) {
    assert.equal(check.args[check.args.indexOf('--maxWorkers') + 1], '2');
    assert.ok(!check.args.includes('--no-file-parallelism'));
  }
});
test('API contract changes check renderer and execution consumers', () => {
  const plan = planChecks(['src/agent/apps/api/src/router.ts']);
  for (const app of ['web', 'api', 'worker', 'desktop']) assert.ok(plan.some(c => c.label === `Agent ${app} types`));
});
test('root and Agent dependency graphs remain isolated', () => {
  const plan = planChecks(['src/coordinator/main.ts', 'landing/src/App.tsx']);
  assert.ok(plan.some(c => c.label === 'typecheck'));
  assert.ok(plan.some(c => c.label === 'landing:typecheck'));
  assert.ok(!plan.some(c => c.cwd === 'src/agent'));
});
test('related checks do not invoke full suites, build or deployment', () => {
  const plan = planChecks(['src/coordinator/main.ts', 'src/agent/packages/contracts/src/rpc.ts']);
  assert.ok(plan.filter(c => c.args.includes('node_modules/vitest/vitest.mjs')).every(c => c.args.includes('related')));
  assert.ok(!plan.some(c => c.args.includes('build') || c.args.includes('deploy')));
});
test('each event uses its actual comparison revision', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  const never = () => { throw new Error('unexpected fallback'); };
  assert.equal(eventBase('pull_request', { pull_request: { base: { sha: a } } }, b, never), a);
  assert.equal(eventBase('merge_group', { merge_group: { base_sha: a } }, b, never), a);
  assert.equal(eventBase('push', { before: a }, b, never), a);
  assert.equal(eventBase('workflow_dispatch', {}, b, () => a), a);
  assert.throws(() => eventBase('push', { before: 'invalid' }, b, never), /Invalid/);
});
test('workflow validates merge candidates read-only and preserves evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /name: CI summary/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/ci-proportional.mjs/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|contents: write|checks: write/);
});
