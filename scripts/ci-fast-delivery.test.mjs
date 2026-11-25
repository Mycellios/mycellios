import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { eventBase, planChecks, uncoveredNativeFiles, agentAffectedTestFiles } from './ci-proportional.mjs';
import { ARCHES, DEPLOY_COMPUTER_JOB } from './self-host-images.mjs';

test('isolated native revisions do not block newer builds and common publication stays serialized',()=>{
 const release=readFileSync('.github/workflows/installer-release.yml','utf8');
 assert.ok(release.includes('group: installer-release-${{ github.event.workflow_run.head_sha || github.sha }}'));
 assert.match(release,/publish:[\s\S]*?concurrency:\s+group: installer-publication\s+cancel-in-progress: false\s+queue: max/);
 for(const platform of ['macos','linux-release','windows-release']) {
  const workflow=readFileSync(`.github/workflows/desktop-${platform}.yml`,'utf8');
  assert.ok(workflow.includes('${{ inputs.revision || github.sha }}'));
  assert.ok(!workflow.includes('cancel-in-progress: true'));
 }
});

test('transcription has real Python checks without admitting unrelated native changes', () => {
  const files = ['python/distributed_runtime/transcription_engine.py', 'python/tests/test_transcription_engine.py'];
  const plan = planChecks(files);
  assert.ok(plan.some(c => c.bin === 'python3' && c.args.includes('unittest')));
  assert.ok(plan.some(c => c.bin === 'python3' && c.label.endsWith('syntax')));
  assert.deepEqual(uncoveredNativeFiles(files), []);
  assert.deepEqual(uncoveredNativeFiles([...files, 'python/distributed_runtime/decision_actor.py', 'native/unknown.cpp']),
    ['python/distributed_runtime/decision_actor.py', 'native/unknown.cpp']);
});

test('speculation changes run locked CPU engine and server tests without admitting other runtime files', () => {
  const files = ['python/distributed_runtime/speculation.py', 'python/distributed_runtime/server.py', 'python/tests/test_speculation.py'];
  const plan = planChecks(files);
  assert.ok(plan.some(c => c.args.includes('--require-hashes') && c.args.includes('scripts/wheel-locks/linux-x64-cp312.txt')));
  for (const test of ['test_speculation.py', 'test_engine.py', 'test_server.py']) assert.ok(plan.some(c => c.cwd === 'python' && c.args.includes(test)));
  assert.deepEqual(uncoveredNativeFiles(files), []);
  assert.deepEqual(uncoveredNativeFiles([...files, 'python/distributed_runtime/engine.py']), []);
  assert.deepEqual(uncoveredNativeFiles([...files, 'python/distributed_runtime/stage.py']), ['python/distributed_runtime/stage.py']);
  for (const test of ['test_session_reuse.py', 'test_recovery.py']) assert.ok(planChecks(['python/distributed_runtime/engine.py']).some(c => c.args.includes(test)));
  assert.ok(readFileSync('.github/workflows/ci.yml', 'utf8').includes('python-version: "3.12"'));
});

test('llama.cpp stage runtime changes run its locked tests without the speculation suites', () => {
  const files = ['python/distributed_runtime/llama_cpp_runtime.py', 'python/tests/test_llama_cpp_runtime.py'];
  const plan = planChecks(files);
  assert.ok(plan.some(c => c.args.includes('--require-hashes') && c.args.includes('scripts/wheel-locks/linux-x64-cp312.txt')));
  assert.ok(plan.some(c => c.cwd === 'python' && c.args.includes('test_llama_cpp_runtime.py')));
  for (const test of ['test_llama_cpp_stage.py', 'test_native_gguf.py', 'test_llama_cpp_install.py']) assert.ok(plan.some(c => c.cwd === 'python' && c.args.includes(test)));
  assert.deepEqual(uncoveredNativeFiles(['python/distributed_runtime/llama_cpp_install.py']), []);
  assert.deepEqual(uncoveredNativeFiles(['python/distributed_runtime/llama_cpp_stage_runner.py', 'python/distributed_runtime/native_gguf_runtime.py']), []);
  assert.ok(!plan.some(c => c.args.includes('test_engine.py')));
  assert.deepEqual(uncoveredNativeFiles(files), []);
  const both = planChecks([...files, 'python/distributed_runtime/speculation.py']);
  assert.equal(both.filter(c => c.args.includes('--require-hashes')).length, 1);
  assert.ok(both.some(c => c.args.includes('test_engine.py')) && both.some(c => c.args.includes('test_llama_cpp_runtime.py')));
});

test('installer publishing changes execute real signing, catalog and recovery boundaries', () => {
 const files=['deploy/installers/publisher.py','deploy/installers/test_publisher.py'];
 const plan=planChecks(files);
 assert.ok(plan.some(c=>c.bin==='python3'&&c.args.includes('unittest')&&c.args.includes('deploy/installers')));
 assert.deepEqual(uncoveredNativeFiles(files),[]);
 assert.deepEqual(uncoveredNativeFiles(['deploy/installers/new-native.py']),['deploy/installers/new-native.py']);
});

test('Kokoro engine changes run its CPU unit tests', () => {
  const files = ['python/tests/test_kokoro_engine.py'];
  assert.deepEqual(uncoveredNativeFiles(files), []);
  assert.ok(planChecks(files).some(c => c.args.includes('test_kokoro_engine.py')));
});
test('the stdlib two-host link probe runs its loopback test', () => {
  const files = ['python/distributed_runtime/link_probe.py', 'python/tests/test_link_probe.py'];
  assert.deepEqual(uncoveredNativeFiles(files), []);
  assert.ok(planChecks(files).some(c => c.args.includes('test_link_probe.py') && c.args.includes('-I')));
  assert.deepEqual(uncoveredNativeFiles(['python/distributed_runtime/server_extra.py']), ['python/distributed_runtime/server_extra.py']);
});
test('documentation requires no dependency installation', () => {
  const plan = planChecks(['docs/DEVELOPMENT.md', 'AGENTS.md']);
  assert.ok(plan.some(c => c.label === 'CI policy tests'));
  assert.ok(plan.some(c => c.label === 'private terms' && c.bin === 'node'));
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
  assert.ok(planChecks(['src/agent/packages/db/src/routine-run-markers.ts']).some(c => c.args.includes('scripts/verify-routine-isolation-db.ts')));
  assert.ok(!planChecks(['src/agent/apps/web/src/pages/Shell.tsx']).some(c => c.args.includes('scripts/verify-routine-isolation-db.ts')));
  assert.ok(planChecks(['src/agent/packages/db/src/conversation-surfaces.ts']).some(c => c.args.includes('scripts/verify-conversation-surfaces-db.ts')));
  assert.ok(!planChecks(['src/agent/apps/web/src/pages/Shell.tsx']).some(c => c.args.includes('scripts/verify-conversation-surfaces-db.ts')));
  assert.ok(planChecks(['src/agent/packages/db/src/message-queue.ts']).some(c => c.args.includes('scripts/verify-message-queue-db.ts')));
  assert.ok(planChecks(['src/agent/packages/db/src/mico-concurrency.ts']).some(c => c.args.includes('scripts/verify-message-queue-db.ts')));
  assert.ok(!planChecks(['src/agent/apps/web/src/pages/Shell.tsx']).some(c => c.args.includes('scripts/verify-message-queue-db.ts')));
  for (const file of ['src/agent/packages/db/src/conversation-branch.ts', 'src/agent/apps/api/src/conversation-branch.ts', 'src/agent/scripts/verify-conversation-branch-db.ts', 'src/agent/packages/db/src/thread-lifecycle.ts'])
    assert.ok(planChecks([file]).some(c => c.args.includes('scripts/verify-conversation-branch-db.ts')), file);
  assert.ok(!planChecks(['src/agent/apps/web/src/pages/Shell.tsx']).some(c => c.args.includes('scripts/verify-conversation-branch-db.ts')));
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
 assert.deepEqual(agentAffectedTestFiles(['packages/contracts/src/index.ts'],available),[]);
 assert.deepEqual(agentAffectedTestFiles(['packages/adapters/src/executor.ts'],available),['packages/adapters/src/executor-readonly-approval.test.ts','packages/adapters/src/executor.test.ts']);
});

test('tool registries keep wire and exposure checks without selecting the whole adapter suite',()=>{
 const files=['executor.test.ts','pi-runtime-field-descriptions.test.ts','pi-runtime.test.ts','index.test.ts','slack-messaging.test.ts'].map(name=>'packages/adapters/src/'+name);
 const selected=agentAffectedTestFiles(['packages/adapters/src/builtin-tools.ts'],files);
 assert.equal(selected.length,4);assert.ok(selected.includes('packages/adapters/src/pi-runtime-field-descriptions.test.ts'));
 assert.ok(!selected.includes('packages/adapters/src/slack-messaging.test.ts'));
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

test('conversation follow-up retains an isolated real database and delivery gate',()=>{
 const plan=planChecks(['src/agent/packages/db/prisma/migrations/20261115100000_task_followup/migration.sql','src/agent/packages/adapters/src/task-reminders.ts'],[]);
 assert.ok(plan.some(c=>c.args.includes('scripts/verify-task-conversations-route-db.ts')));
 assert.ok(!planChecks(['src/agent/apps/web/src/pages/tasks/tasks.css'],[]).some(c=>c.args.includes('scripts/verify-task-conversations-route-db.ts')));
});

test('conversation lifecycle changes qualify their migration, archive and delete on a real isolated database',()=>{
 for (const file of ['src/agent/packages/db/src/thread-lifecycle.ts','src/agent/apps/api/src/side-threads.ts','src/agent/packages/adapters/src/thread-deletion.ts','src/agent/packages/db/prisma/migrations/20261122120000_thread_lifecycle/migration.sql']) {
  assert.ok(planChecks([file],[]).some(c=>c.args.includes('scripts/verify-thread-lifecycle-db.ts')), file);
 }
 assert.ok(!planChecks(['src/agent/apps/web/src/pages/tasks/tasks.css'],[]).some(c=>c.args.includes('scripts/verify-thread-lifecycle-db.ts')));
});

test('event waits qualify the deployed CHECK upgrade and automatic return on a real isolated database',()=>{
 for (const file of ['src/agent/packages/db/src/event-waits.ts','src/agent/packages/db/src/work-delegation.ts','src/agent/scripts/verify-autonomy-waits-db.ts','src/agent/packages/db/prisma/migrations/20261116150000_event_wait_delegation_state/migration.sql']) {
  const check=planChecks([file],[]).find(c=>c.args.includes('scripts/verify-autonomy-waits-db.ts'));
  assert.deepEqual(check?.args,['node_modules/tsx/dist/cli.mjs','scripts/verify-autonomy-waits-db.ts']);
 }
 assert.ok(!planChecks(['src/agent/apps/web/src/pages/tasks/tasks.css'],[]).some(c=>c.args.includes('scripts/verify-autonomy-waits-db.ts')));
});

test('Mico-opened conversations qualify their reports and report recovery on a real isolated database',()=>{
 for (const file of ['src/agent/packages/db/src/agent-tasks.ts','src/agent/packages/core/src/agent-tasks.ts','src/agent/scripts/verify-agent-tasks-db.ts']) {
  const check=planChecks([file],[]).find(c=>c.args.includes('scripts/verify-agent-tasks-db.ts'));
  assert.deepEqual(check?.args,['node_modules/tsx/dist/cli.mjs','scripts/verify-agent-tasks-db.ts'], file);
 }
 assert.ok(!planChecks(['src/agent/packages/adapters/src/executor-agent-tasks.test.ts'],[]).some(c=>c.args.includes('scripts/verify-agent-tasks-db.ts')));
});

test('deployments are requested only from main pushes after the exact commit passes CI, with OIDC and no stored secret', () => {
  const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(deploy, /^on:\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.ok(deploy.includes("if: github.event_name == 'push'"), 'manual runs publish images but never request a deployment');
  assert.ok(!deploy.includes('pull_request'));
  assert.ok(!deploy.includes('secrets.'));
  assert.ok(!deploy.includes('self-hosted'));
  const images = deploy.slice(deploy.indexOf('  publish-images:'), deploy.indexOf('  request-deployment:'));
  assert.ok(images.includes("if: github.ref == 'refs/heads/main' && (vars.NUCLEUS_DEPLOY_URL != '' || github.event_name == 'workflow_dispatch')"));
  assert.ok(images.includes('runs-on: ubuntu-latest') && images.includes('packages: write'));
  assert.ok(images.includes(':sha-${{ github.sha }}'));
  assert.ok(images.includes('org.opencontainers.image.revision=${{ github.sha }}'));
  for (const image of ['coordinator', 'agent', 'computer']) assert.ok(images.includes(`- image: ${image}\n`), image);
  assert.ok(images.includes('context: src/agent/infra/sandboxes/computer'));
  const request = deploy.slice(deploy.indexOf('  request-deployment:'));
  assert.ok(request.includes('needs: publish-images') && request.includes('id-token: write'));
  assert.ok(request.indexOf('check_name=CI%20summary') < request.indexOf('/api/v1/deployments/github'));
  assert.ok(request.includes('"completed success"'));
  assert.ok(!readFileSync('.github/workflows/ci.yml', 'utf8').includes('deployments/github'));
});

test('self-host images come only from main on GitHub-hosted runners and never replace the Nucleus images', () => {
  const workflow = readFileSync('.github/workflows/self-host-images.yml', 'utf8');
  assert.match(workflow, /^on:\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.ok(workflow.includes("if: github.ref == 'refs/heads/main'"));
  for (const forbidden of ['pull_request', 'secrets.', 'id-token', 'contents: write', 'deployments/github', 'APP_BASE_PATH', 'setup-qemu']) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
  assert.deepEqual([...new Set(workflow.match(/runs-on: .+/g))].sort(), ['runs-on: ${{ matrix.runner }}', 'runs-on: ubuntu-latest']);
  assert.deepEqual(Object.values(ARCHES), ['ubuntu-24.04', 'ubuntu-24.04-arm']);
  assert.ok(workflow.includes('platforms: linux/${{ matrix.arch }}') && workflow.includes('push-by-digest=true'));
  assert.ok(workflow.includes('org.opencontainers.image.revision=${{ needs.plan.outputs.revision }}'));
  for (const [, action] of workflow.matchAll(/uses:\s+([^\s#]+)/g)) assert.match(action, /@[0-9a-f]{40}$/, action);
  assert.match(workflow, /edge:[\s\S]*?concurrency:\s+group: self-host-edge\s+cancel-in-progress: false\s+queue: max/);
  // publish adds arm64 to the amd64 computer that deploy.yml builds for Nucleus, never replacing it.
  const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.ok(deploy.includes('name: Publish ${{ matrix.image }} image') && deploy.includes('- image: computer\n'));
  assert.equal(DEPLOY_COMPUTER_JOB, 'Publish computer image');
  assert.ok(!deploy.includes('self-host'));
  // A Desktop release builds its revision's images, and adds v<version> only once it is public.
  const release = readFileSync('.github/workflows/installer-release.yml', 'utf8');
  const images = release.slice(release.indexOf('  self-host-images:'), release.indexOf('  publish:'));
  assert.ok(images.includes('uses: ./.github/workflows/self-host-images.yml'));
  assert.ok(images.includes('revision: ${{ needs.admit.outputs.revision }}'));
  const tagging = release.slice(release.indexOf('  self-host-release:'), release.indexOf('  node-components:'));
  assert.ok(tagging.includes('needs: [admit, publish, self-host-images]'));
  assert.ok(tagging.includes("needs.publish.result == 'success'") && tagging.includes("needs.self-host-images.result == 'success'"));
  assert.ok(tagging.includes('node scripts/self-host-images.mjs release') && !tagging.includes('secrets.'));
});
