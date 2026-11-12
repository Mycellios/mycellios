import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { eventBase, planChecks, uncoveredNativeFiles, agentAffectedTestFiles } from './ci-proportional.mjs';

test('transcription has real Python checks without admitting unrelated native changes', () => {
  const files = ['python/distributed_runtime/transcription_engine.py', 'python/tests/test_transcription_engine.py'];
  const plan = planChecks(files);
  assert.ok(plan.some(c => c.bin === 'python3' && c.args.includes('unittest')));
  assert.ok(plan.some(c => c.bin === 'python3' && c.label.endsWith('syntax')));
  assert.deepEqual(uncoveredNativeFiles(files), []);
  assert.deepEqual(uncoveredNativeFiles([...files, 'python/distributed_runtime/decision_actor.py', 'native/unknown.cpp']),
    ['python/distributed_runtime/decision_actor.py', 'native/unknown.cpp']);
});

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
test('Agent web installs its imported root runtime dependencies without unrelated typechecks', () => {
  const plan = planChecks(['src/agent/apps/web/src/pages/Shell.tsx'], ['apps/web/src/pages/Shell.test.tsx']);
  assert.equal(plan.filter(c => c.args[0] === 'ci').length, 2);
  assert.ok(plan.findIndex(c => c.label === 'root locked dependencies') < plan.findIndex(c => c.label === 'Agent web types'));
  assert.ok(!plan.some(c => ['typecheck', 'landing:typecheck', 'mobile:typecheck'].includes(c.label)));
  assert.ok(plan.some(c => c.label === 'Agent web types'));
  assert.ok(!plan.some(c => c.label === 'Agent api types'));
  assert.ok(plan.some(c => c.label === 'Agent affected tests' && c.args.includes('apps/web/src/pages/Shell.test.tsx')));
});
test('shared Agent contracts check all consumers', () => {
  const plan = planChecks(['src/agent/packages/contracts/src/rpc.ts']);
  for (const app of ['web', 'api', 'worker', 'desktop']) assert.ok(plan.some(c => c.label === `Agent ${app} types`));
});

test('mobile notification migration runs actual isolated database qualification', () => {
  const plan = planChecks(['src/agent/packages/db/prisma/migrations/20261112110000_mobile_push_devices/migration.sql']);
  assert.ok(plan.some(c => c.args.includes('scripts/verify-notification-devices-db.ts')));
  assert.equal(plan.filter(c => c.args[0] === 'ci').length, 2);
  assert.ok(!planChecks(['src/agent/apps/web/src/pages/Shell.tsx']).some(c => c.args.includes('scripts/verify-notification-devices-db.ts')));
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

test('Agent script tests run after their locked workspace dependencies', () => {
  const file='src/agent/apps/desktop/scripts/compact-resources.test.mjs';
  const plan=planChecks([file]);
  const installed=plan.findIndex(c=>c.label==='Agent locked dependencies');
  const tested=plan.findIndex(c=>c.label===`test: ${file}`);
  assert.ok(installed>=0 && tested>installed);
  assert.ok(plan.findIndex(c=>c.label===`syntax: ${file}`)<installed);
});
test('root and Agent dependency graphs remain isolated', () => {
  const plan = planChecks(['src/coordinator/main.ts', 'landing/src/App.tsx']);
  assert.ok(plan.some(c => c.label === 'typecheck'));
  assert.ok(plan.some(c => c.label === 'landing:typecheck'));
  assert.ok(!plan.some(c => c.cwd === 'src/agent'));
});

test('managed billing and referral changes qualify actual isolated PostgreSQL accounting', () => {
  for (const file of ['src/economy/managed-purchases.ts', 'src/coordinator/managed-antseed-text.ts', 'src/economy/referrals.ts']) {
    const plan = planChecks([file]);
    const check = plan.find(c => c.label === 'isolated managed wallet and referral PostgreSQL');
    assert.deepEqual(check?.args, ['scripts/test-referrals-postgres.mjs', 'tests/managed-purchases.postgres.test.ts', 'tests/referrals.postgres.test.ts']);
    assert.ok(plan.findIndex(c => c.label === 'root locked dependencies') < plan.indexOf(check));
  }
  assert.ok(!planChecks(['src/agent/apps/web/src/components/AskCard.tsx']).some(c => c.label === 'isolated managed wallet and referral PostgreSQL'));
});
test('related checks do not invoke full suites, build or deployment', () => {
  const plan = planChecks(['src/coordinator/main.ts', 'src/agent/packages/contracts/src/rpc.ts']);
  assert.ok(plan.filter(c => c.label === 'root affected tests').every(c => c.args.includes('related')));
  assert.ok(plan.filter(c => c.label === 'Agent affected tests').every(c => c.args[1] === 'run' && c.args.slice(2, -2).every(f => /\.test\.[jt]sx?$/.test(f))));
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

test('shared barrels stay scoped while executor regression siblings are included', () => {
 const available=['packages/contracts/src/rpc.test.ts','packages/adapters/src/executor.test.ts','packages/adapters/src/executor-readonly-approval.test.ts','packages/adapters/src/unrelated.test.ts'];
 assert.deepEqual(agentAffectedTestFiles(['packages/contracts/src/index.ts'],available),['packages/contracts/src/rpc.test.ts']);
 assert.deepEqual(agentAffectedTestFiles(['packages/adapters/src/executor.ts'],available),['packages/adapters/src/executor-readonly-approval.test.ts','packages/adapters/src/executor.test.ts']);
});
test('changed Agent tests are not repeated in the affected batch', () => {
 const plan=planChecks(['src/agent/packages/adapters/src/executor.ts','src/agent/packages/adapters/src/executor-readonly-approval.test.ts'],['packages/adapters/src/executor.test.ts','packages/adapters/src/executor-readonly-approval.test.ts']);
 const affected=plan.find(c=>c.label==='Agent affected tests');
 assert.ok(affected.args.includes('packages/adapters/src/executor.test.ts'));
 assert.ok(!affected.args.includes('packages/adapters/src/executor-readonly-approval.test.ts'));
});

test("browser inference settlement changes require isolated real PostgreSQL", () => {
  for (const file of ["src/economy/browser-inference.ts", "src/economy/contribution-credit-wallet.ts", "tests/browser-inference.postgres.test.ts"]) {
    const check = planChecks([file]).find(c => c.label === "isolated browser inference PostgreSQL settlement");
    assert.deepEqual(check?.args, ["scripts/test-referrals-postgres.mjs", "tests/browser-inference.postgres.test.ts"]);
  }
});
