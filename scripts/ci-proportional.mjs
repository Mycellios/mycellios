import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This optional replica's boundary tests need only Python's standard library.
// Every other Python/native surface still requires its own focused admission.
const transcriptionPython = new Set(['python/distributed_runtime/transcription_engine.py',
  'python/distributed_runtime/replica_gpu_guard.py', 'python/tests/test_transcription_engine.py',
  'python/tests/test_transcription_gpu_guard.py', 'scripts/qualify-transcription-gpu.py']);
const installerPython = new Set(['deploy/installers/publisher.py', 'deploy/installers/test_publisher.py']);
// The private memory-embedding replica and forwarder tests use only the standard library.
const memoryEmbeddingPython = new Set(['python/distributed_runtime/qwen06_embedding_service.py',
  'python/distributed_runtime/qwen06_embedding_forwarder.py', 'python/tests/test_qwen06_embedding_service.py',
  'python/tests/test_qwen06_embedding_forwarder.py', 'deploy/transcription-openai-bridge/bridge.py',
  'deploy/transcription-openai-bridge/test_bridge.py']);
// Linear speculative drafting runs the real engine/server tests on CPU torch
// from the hash-locked cp312 wheel set; no model download or GPU.
const speculationPython = new Set(['python/distributed_runtime/speculation.py',
  'python/distributed_runtime/server.py', 'python/distributed_runtime/draft_quality_runtime_benchmark.py',
  'python/tests/test_speculation.py', 'python/tests/test_server.py', 'python/tests/test_draft_quality_runtime_benchmark.py',
  'python/distributed_runtime/macro_wave_adapter.py', 'python/tests/test_macro_wave_adapter.py',
  'python/distributed_runtime/draft_model.py', 'python/tests/test_draft_model.py',
  'python/distributed_runtime/engine.py', 'python/tests/test_engine.py']);
// The pinned llama.cpp stage runtime: pure tests need numpy from the same lock;
// its physical test is skipped on CI because no binary or model is present.
const llamaCppPython = new Set(['python/distributed_runtime/llama_cpp_runtime.py', 'python/tests/test_llama_cpp_runtime.py',
  'python/distributed_runtime/llama_cpp_view.py', 'python/distributed_runtime/llama_cpp_executor.py',
  'python/distributed_runtime/llama_cpp_stage_runner.py', 'python/distributed_runtime/native_gguf_runtime.py',
  'python/tests/test_llama_cpp_stage.py', 'python/distributed_runtime/llama_cpp_profile.py', 'python/tests/test_llama_cpp_profile.py',
  'python/distributed_runtime/native_gguf.py', 'python/distributed_runtime/native_gguf_remote.py', 'python/tests/test_native_gguf_remote.py']);
const llamaCppTests = ['test_llama_cpp_runtime.py', 'test_llama_cpp_stage.py', 'test_llama_cpp_profile.py', 'test_native_gguf.py', 'test_native_gguf_remote.py'];
// The Kokoro speech engine's unit tests use fake pipelines on CPU torch from the same lock.
const kokoroPython = new Set(['python/distributed_runtime/kokoro_engine.py', 'python/tests/test_kokoro_engine.py']);
const speculationTests = ['test_speculation.py', 'test_macro_wave_adapter.py', 'test_engine.py', 'test_draft_model.py', 'test_server.py', 'test_draft_quality_runtime_benchmark.py', 'test_session_reuse.py', 'test_recovery.py'];
export const uncoveredNativeFiles = files => files.filter(f => /\.(py|cpp|cc|c|h|hpp|rs)$/.test(f) && !transcriptionPython.has(f) && !installerPython.has(f) && !memoryEmbeddingPython.has(f) && !speculationPython.has(f) && !llamaCppPython.has(f) && !kokoroPython.has(f));

// Shared barrels must not expand a focused change into the complete Agent suite.
// Keep executable tests in the source directory, including named regression siblings.
export function agentAffectedTestFiles(sources, available) {
  const selected = new Set();
  for (const source of sources) {
    const directory = path.posix.dirname(source);
    const stem = path.posix.basename(source).replace(/\.[jt]sx?$/, '');
    const owned = available.filter(file => path.posix.dirname(file) === directory);
    const named = owned.filter(file => { const name = path.posix.basename(file); return name.startsWith(stem + '.test.') || name.startsWith(stem + '-') || name.startsWith(stem + '.'); });
    // A registry has cross-cutting consumers, not every adapter implementation.
    // Retain its wire-schema, exposure and executor regressions explicitly.
    const registry = source === 'packages/adapters/src/builtin-tools.ts'
      ? owned.filter(file => ['pi-runtime-field-descriptions.test.ts','pi-runtime.test.ts','executor.test.ts','index.test.ts'].includes(path.posix.basename(file))) : null;
    for (const file of registry ?? (named.length ? named : stem === 'index' ? [] : owned)) selected.add(file);
  }
  return [...selected].sort();
}
export function planChecks(files, availableAgentTests) {
  const code = files.filter(f => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith('.d.ts'));
  const visual = f => /\.(md|png|svg|jpg|webp|css|po)$/.test(f);
  const root = files.some(f => !visual(f) && /^(src\/(?!agent\/)|landing\/|mobile\/|tests\/|scripts\/.*\.ts$|tsconfig|vite\.|vitest\.|package(?:-lock)?\.json$)/.test(f))
    || files.some(f => /^scripts\/.*\.test\.[cm]?js$/.test(f) && f !== 'scripts/ci-fast-delivery.test.mjs');
  const agent = files.some(f => f.startsWith('src/agent/') && !visual(f));
  const agentShared = files.some(f => f.startsWith('src/agent/') && (!f.startsWith('src/agent/apps/') || f.startsWith('src/agent/apps/api/')));
  const agentWeb = agent && (agentShared || files.some(f => f.startsWith('src/agent/apps/web/')));
  const desktopDownloadBrowserTest = 'scripts/desktop-macos/download-page.test.mjs';
  const desktopDownloads = files.some(f => ['landing/src/DesktopDownloads.tsx', 'src/contracts/desktop-downloads.ts', desktopDownloadBrowserTest].includes(f));
  const commands = [];
  const agentScriptTests = [];
  const add = (cwd, bin, args, label) => commands.push({ cwd, bin, args, label });
  add('.', 'node', ['--test', 'scripts/ci-fast-delivery.test.mjs'], 'CI policy tests');
  // Private names (people, companies, retired products) never return; see the script.
  add('.', 'node', ['scripts/verify-private-terms.mjs'], 'private terms');
  if (files.some(f => installerPython.has(f))) {
    add('.', 'python3', ['-B', '-m', 'unittest', 'discover', '-s', 'deploy/installers', '-p', 'test_*.py'], 'installer promotion ownership, signing and recovery boundaries');
    add('.', 'python3', ['-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf8"),filename=p) for p in sys.argv[1:]]', ...installerPython], 'installer publisher Python syntax');
  }
  if (files.some(f => memoryEmbeddingPython.has(f))) {
    add('python', 'python3', ['-I', '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-p', 'test_qwen06_*.py'], 'memory-embedding replica and forwarder boundaries (no model or GPU)');
    add('.', 'python3', ['-I', '-B', '-m', 'unittest', 'discover', '-s', 'deploy/transcription-openai-bridge', '-p', 'test_*.py'], 'OpenAI transcription bridge boundaries (no ffmpeg or network)');
  }
  if (files.some(f => transcriptionPython.has(f) || f === 'python/transcription-artifacts.json')) {
    add('.', 'python3', ['-I', '-B', '-m', 'unittest', 'discover', '-s', 'python/tests', '-p', 'test_transcription_*.py'], 'native transcription Python boundaries (no model or GPU)');
    add('.', 'python3', ['-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf8"),filename=p) for p in sys.argv[1:]]', ...[...transcriptionPython].filter(f => existsSync(f))], 'native transcription Python syntax');
  }
  if (root || agent) add('.', 'npm', ['install', '--global', 'npm@10.9.8', '--no-audit', '--no-fund'], 'pinned npm toolchain');
  const speculationChanged = files.some(f => speculationPython.has(f));
  const llamaCppChanged = files.some(f => llamaCppPython.has(f));
  const kokoroChanged = files.some(f => kokoroPython.has(f));
  if (speculationChanged || llamaCppChanged || kokoroChanged) {
    const venv = '.ci/speculation-venv';
    add('.', 'python3', ['-c', 'import sys; assert sys.version_info[:2] == (3, 12), sys.version'], 'speculation runtime interpreter is CPython 3.12');
    add('.', 'python3', ['-m', 'venv', venv], 'speculation runtime virtual environment');
    add('.', `${venv}/bin/python`, ['-m', 'pip', 'install', '--require-hashes', '--only-binary=:all:', '--no-deps', '-r', 'scripts/wheel-locks/linux-x64-cp312.txt'], 'hash-locked CPU runtime wheels');
    if (speculationChanged) for (const test of speculationTests) add('python', `../${venv}/bin/python`, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-p', test], `speculation runtime ${test} (CPU, no model or GPU)`);
    if (llamaCppChanged) for (const test of llamaCppTests) add('python', `../${venv}/bin/python`, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-p', test], `llama.cpp native stage ${test} (no binary, model or GPU)`);
    if (kokoroChanged) add('python', `../${venv}/bin/python`, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-p', 'test_kokoro_engine.py'], 'Kokoro speech engine (fake pipelines, no model or GPU)');
  }
  for (const file of code.filter(f => /\.[cm]?js$/.test(f))) {
    add('.', 'node', ['--check', file], `syntax: ${file}`);
    if (/\.test\.[cm]js$/.test(file) && file !== 'scripts/ci-fast-delivery.test.mjs' && file !== desktopDownloadBrowserTest) {
      if (file.startsWith('src/agent/')) agentScriptTests.push(file);
      else add('.', 'node', ['--test', file], `test: ${file}`);
    }
  }
  // Agent's browser contribution imports the root-owned mobile runtime and its WebGPU types.
  if (root || agentWeb) add('.', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], 'root locked dependencies');
  if (root) {
    for (const script of ['verify:structure', 'verify:architecture', 'verify:component-boundaries']) add('.', 'npm', ['run', script], script);
    const config = files.some(f => /^(package|tsconfig|vitest\.|vite\.)/.test(f));
    for (const [prefix, script] of [['src/', 'typecheck'], ['landing/', 'landing:typecheck'], ['mobile/', 'mobile:typecheck']]) {
      if (config || files.some(f => f.startsWith(prefix) && !f.startsWith('src/agent/'))) add('.', 'npm', ['run', script, '--', '--incremental', '--tsBuildInfoFile', `.ci/${script.replaceAll(':', '-')}.tsbuildinfo`], script);
    }
    const related = code.filter(f => /^(src\/(?!agent\/)|landing\/|tests\/)/.test(f) && !/\.test\.[jt]sx?$/.test(f));
    const tests = code.filter(f => /^(tests\/|landing\/)/.test(f) && /\.test\.[jt]sx?$/.test(f));
    if (tests.length) add('.', 'node', ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers', '2', '--no-file-parallelism'], 'root changed tests');
    if (related.length) add('.', 'node', ['node_modules/vitest/vitest.mjs', 'related', ...related, '--run', '--passWithNoTests', '--maxWorkers', '2', '--no-file-parallelism'], 'root affected tests');
    if (files.some(f => /^(src\/economy\/(managed-|promotional-credits|referrals|wallet-topups|contribution-credit-wallet)|src\/coordinator\/(managed-|referral-routes|wallet-topup-routes)|src\/core\/managed-provider-config|tests\/(managed-|referrals\.)|scripts\/test-referrals-postgres)/.test(f))) {
      add('.', 'node', ['scripts/test-referrals-postgres.mjs', 'tests/managed-purchases.postgres.test.ts', 'tests/referrals.postgres.test.ts'], 'isolated managed wallet and referral PostgreSQL');
    }
    if (files.some(f => /^(src\/economy\/(browser-inference|contribution-credit-wallet)|src\/coordinator\/browser-inference|tests\/browser-inference)/.test(f))) {
      add('.', 'node', ['scripts/test-referrals-postgres.mjs', 'tests/browser-inference.postgres.test.ts'], 'isolated browser inference PostgreSQL settlement');
    }
    if (desktopDownloads) {
      add('.', 'node', ['scripts/build-desktop-downloads.mjs'], 'Desktop downloads page build');
      add('.', 'npm', ['ci', '--prefix', 'scripts/desktop-macos', '--ignore-scripts', '--no-audit', '--no-fund'], 'Desktop browser fixture dependencies');
      add('.', 'node', ['scripts/desktop-macos/node_modules/@playwright/test/cli.js', 'install', 'chromium', '--only-shell'], 'Desktop browser fixture Chromium');
      add('.', 'node', ['--test', desktopDownloadBrowserTest], 'Desktop downloads browser fixture');
    }
  }
  if (agent) {
    add('src/agent', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], 'Agent locked dependencies');
    for (const file of agentScriptTests) add('.', 'node', ['--test',file], `test: ${file}`);
    add('src/agent', 'npm', ['run', 'generate', '--workspace', '@mycellios/db'], 'Prisma client generation (no database connection)');
    const shared = agentShared;
    for (const app of ['web', 'api', 'worker', 'desktop']) {
      if (shared || files.some(f => f.startsWith(`src/agent/apps/${app}/`))) add('src/agent', 'node', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', `../../.ci/agent-${app}.tsbuildinfo`, '-p', `apps/${app}/tsconfig.json`], `Agent ${app} types`);
    }
    const tests = code.filter(f => f.startsWith('src/agent/') && /\.test\.[jt]sx?$/.test(f)).map(f => f.slice('src/agent/'.length));
    if (tests.length) add('src/agent', 'node', ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers', '2'], 'Agent changed tests');
    const related = code.filter(f => f.startsWith('src/agent/') && !/\.[cm]?js$/.test(f) && !/\.test\.[jt]sx?$/.test(f) && !f.includes('.config.')).map(f => f.slice('src/agent/'.length));
    const available = availableAgentTests ?? execFileSync('git', ['ls-files', '-z', 'src/agent'], { encoding: 'utf8' }).split('\0').filter(f => /\.test\.[jt]sx?$/.test(f)).map(f => f.slice('src/agent/'.length));
    const affected = agentAffectedTestFiles(related, available).filter(file => !tests.includes(file));
    if (affected.length) add('src/agent', 'node', ['node_modules/vitest/vitest.mjs', 'run', ...affected, '--maxWorkers', '2'], 'Agent affected tests');
    for (const [pattern, script, label] of [
      [/event-waits?[-.]|verify-autonomy-waits|event_wait_delegation_state|packages\/db\/src\/work-delegation/, 'verify-autonomy-waits-db.ts', 'event wait migration and automatic return on isolated PostgreSQL'],
      [/sidebar.fold|bot-folders|20261115130000_sidebar_folders/, 'verify-sidebar-folders-db.ts', 'folder migration, isolation and hierarchy'],
      [/message-pins|20261115160000_message_pins|20261122200000_message_pin_authors/, 'verify-message-pins-db.ts', 'message pin migrations, Mico pins and account/thread isolation'],
      [/conversation-titles|routes\/development\.ts|packages\/db\/src\/messages\.ts/, 'verify-conversation-titles-db.ts', 'atomic conversation titles and ownership'],
      [/signup-invite|20261122233000_signup_invite/, 'verify-signup-invite-db.ts', 'invitation link migration and concurrent signup places on isolated PostgreSQL'],
      [/thread-lifecycle|side-threads|thread-deletion|20261122120000_thread_lifecycle/, 'verify-thread-lifecycle-db.ts', 'conversation lifecycle migration, archive, delete and lock races on isolated PostgreSQL'],
      [/routine-thread|routine-run-markers|verify-routine-isolation|20261122180000_routine_run_markers/, 'verify-routine-isolation-db.ts', 'routine conversations, run markers and migration on isolated PostgreSQL'],
      [/conversation-surfaces/, 'verify-conversation-surfaces-db.ts', 'sidebar counts, mark all read and mirrored requests on isolated PostgreSQL'],
    ]) {
      if (files.some(file => file.startsWith('src/agent/') && pattern.test(file)))
        add('src/agent', 'node', ['node_modules/tsx/dist/cli.mjs', `scripts/${script}`], label);
    }
    if (files.some(file => file.startsWith('src/agent/') && /local-memory|packages\/memory\/src|20261115180000/.test(file)))
      add('src/agent', 'env', ['MEMORY_TEST_EPHEMERAL=1', 'node', 'scripts/verify-local-memory-db.mjs'], 'isolated memory migration, RLS and bounded review reservations');
    if (files.some(f => /^src\/agent\/(?:scripts\/verify-task-conversations|apps\/api\/src\/(?:routes\/task-inbox|task-inbox-conversations)|packages\/adapters\/src\/task-reminders|packages\/db\/prisma\/migrations\/20261115100000_task_followup)/.test(f))) {
      add('src/agent', 'node', ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-task-conversations-route-db.ts'], 'conversation follow-up migration, reminders and RLS in isolated PostgreSQL');
    }
    if (files.some(f => f === 'src/agent/scripts/verify-notification-devices-db.ts' || f.startsWith('src/agent/packages/db/prisma/migrations/20261112110000_mobile_push_devices/'))) {
      add('src/agent', 'node', ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-notification-devices-db.ts'], 'notification device migration and RLS in isolated PostgreSQL');
    }
  }
  return commands;
}

export function eventBase(name, event, head, git) {
  const base = name === 'pull_request' ? event.pull_request?.base?.sha : name === 'merge_group' ? event.merge_group?.base_sha : name === 'push' ? event.before : undefined;
  if (base && /^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)) return base;
  if (base && !/^0+$/.test(base)) throw new Error('Invalid comparison revision');
  return git(['rev-parse', `${head}^`]).trim();
}

export function runCI() {
  const git = args => execFileSync('git', args, { encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']).trim();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = eventBase(process.env.GITHUB_EVENT_NAME, event, head, git);
  const files = git(['diff', '--name-only', '-z', base, head]).split('\0').filter(Boolean);
  const receipt = { head, base, files, status: 'running', checks: [], omitted: ['full suites and global transitive Agent test discovery', 'security scans', 'cross-platform packaging', 'physical device tests', 'live provider/database qualification', 'release build', 'deployment', 'production health verification'] };
  mkdirSync('.ci', { recursive: true });
  const save = () => writeFileSync('.ci/proportional-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  save();
  try {
    git(['diff', '--check', base, head]);
    receipt.checks.push({ label: 'patch whitespace', status: 'passed' });
    const native = uncoveredNativeFiles(files);
    if (native.length) throw new Error('Python/native changes need a dedicated focused validation job; this TypeScript/JavaScript gate cannot certify them.');
    for (const command of planChecks(files)) {
      // Removed sources still select their surface's types, but cannot be syntax-checked.
      if (/^(syntax|test): /.test(command.label) && !existsSync(command.args.at(-1))) continue;
      console.log(`\nChecking ${command.label}`);
      const result = spawnSync(command.bin, command.args, { cwd: command.cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
      receipt.checks.push({ ...command, status: result.status === 0 && !result.error ? 'passed' : 'failed' });
      save();
      if (result.status !== 0 || result.error) throw result.error || new Error(`${command.label} exited ${result.status}`);
    }
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = error.message;
    throw error;
  } finally {
    save();
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Proportional validation: ${receipt.status}\n\nSource: \`${head}\`. Base: \`${base}\`.\n\n${receipt.checks.map(c => `- ${c.label}: ${c.status}`).join('\n')}\n\nNOT RUN: ${receipt.omitted.join(', ')}.\n\nRelated-test discovery may find no tests; this does not establish behavioral coverage. Sensitive changes retain focused acceptance gates. This check does not authorize or perform a deployment. Release must build the integrated revision, preserve rollback and verify health.\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCI();
