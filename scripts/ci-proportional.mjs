import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This optional replica's boundary tests need only Python's standard library.
// Every other Python/native surface still requires its own focused admission.
const transcriptionPython = new Set(['python/distributed_runtime/transcription_engine.py',
  'python/distributed_runtime/replica_gpu_guard.py', 'python/tests/test_transcription_engine.py',
  'python/tests/test_transcription_gpu_guard.py', 'scripts/qualify-transcription-gpu.py']);
export const uncoveredNativeFiles = files => files.filter(f => /\.(py|cpp|cc|c|h|hpp|rs)$/.test(f) && !transcriptionPython.has(f));

export function planChecks(files) {
  const code = files.filter(f => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith('.d.ts'));
  const visual = f => /\.(md|png|svg|jpg|webp|css|po)$/.test(f);
  const root = files.some(f => !visual(f) && /^(src\/(?!agent\/)|landing\/|mobile\/|tests\/|scripts\/.*\.ts$|tsconfig|vite\.|vitest\.|package(?:-lock)?\.json$)/.test(f))
    || files.some(f => /^scripts\/.*\.test\.[cm]?js$/.test(f) && f !== 'scripts/ci-fast-delivery.test.mjs');
  const agent = files.some(f => f.startsWith('src/agent/') && !visual(f));
  const desktopDownloadBrowserTest = 'scripts/desktop-macos/download-page.test.mjs';
  const desktopDownloads = files.some(f => ['landing/src/DesktopDownloads.tsx', 'src/contracts/desktop-downloads.ts', desktopDownloadBrowserTest].includes(f));
  const commands = [];
  const agentScriptTests = [];
  const add = (cwd, bin, args, label) => commands.push({ cwd, bin, args, label });
  add('.', 'node', ['--test', 'scripts/ci-fast-delivery.test.mjs'], 'CI policy tests');
  if (files.some(f => transcriptionPython.has(f) || f === 'python/transcription-artifacts.json')) {
    add('.', 'python3', ['-I', '-B', '-m', 'unittest', 'discover', '-s', 'python/tests', '-p', 'test_transcription_*.py'], 'native transcription Python boundaries (no model or GPU)');
    add('.', 'python3', ['-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf8"),filename=p) for p in sys.argv[1:]]', ...[...transcriptionPython].filter(f => existsSync(f))], 'native transcription Python syntax');
  }
  if (root || agent) add('.', 'npm', ['install', '--global', 'npm@10.9.8', '--no-audit', '--no-fund'], 'pinned npm toolchain');
  for (const file of code.filter(f => /\.[cm]?js$/.test(f))) {
    add('.', 'node', ['--check', file], `syntax: ${file}`);
    if (/\.test\.[cm]js$/.test(file) && file !== 'scripts/ci-fast-delivery.test.mjs' && file !== desktopDownloadBrowserTest) {
      if (file.startsWith('src/agent/')) agentScriptTests.push(file);
      else add('.', 'node', ['--test', file], `test: ${file}`);
    }
  }
  if (root) {
    add('.', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], 'root locked dependencies');
    for (const script of ['verify:structure', 'verify:architecture', 'verify:component-boundaries']) add('.', 'npm', ['run', script], script);
    const config = files.some(f => /^(package|tsconfig|vitest\.|vite\.)/.test(f));
    for (const [prefix, script] of [['src/', 'typecheck'], ['landing/', 'landing:typecheck'], ['mobile/', 'mobile:typecheck']]) {
      if (config || files.some(f => f.startsWith(prefix) && !f.startsWith('src/agent/'))) add('.', 'npm', ['run', script, '--', '--incremental', '--tsBuildInfoFile', `.ci/${script.replaceAll(':', '-')}.tsbuildinfo`], script);
    }
    const related = code.filter(f => /^(src\/(?!agent\/)|landing\/|tests\/)/.test(f) && !/\.test\.[jt]sx?$/.test(f));
    const tests = code.filter(f => /^(tests\/|landing\/)/.test(f) && /\.test\.[jt]sx?$/.test(f));
    if (tests.length) add('.', 'node', ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers', '2', '--no-file-parallelism'], 'root changed tests');
    if (related.length) add('.', 'node', ['node_modules/vitest/vitest.mjs', 'related', ...related, '--run', '--passWithNoTests', '--maxWorkers', '2', '--no-file-parallelism'], 'root affected tests');
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
    add('src/agent', 'npm', ['run', 'generate', '--workspace', '@rakazo/db'], 'Prisma client generation (no database connection)');
    const shared = files.some(f => f.startsWith('src/agent/') && (!f.startsWith('src/agent/apps/') || f.startsWith('src/agent/apps/api/')));
    for (const app of ['web', 'api', 'worker', 'desktop']) {
      if (shared || files.some(f => f.startsWith(`src/agent/apps/${app}/`))) add('src/agent', 'node', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', `../../.ci/agent-${app}.tsbuildinfo`, '-p', `apps/${app}/tsconfig.json`], `Agent ${app} types`);
    }
    const tests = code.filter(f => f.startsWith('src/agent/') && /\.test\.[jt]sx?$/.test(f)).map(f => f.slice('src/agent/'.length));
    if (tests.length) add('src/agent', 'node', ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers', '2'], 'Agent changed tests');
    const related = code.filter(f => f.startsWith('src/agent/') && !/\.[cm]?js$/.test(f) && !/\.test\.[jt]sx?$/.test(f) && !f.includes('.config.')).map(f => f.slice('src/agent/'.length));
    if (related.length) add('src/agent', 'node', ['node_modules/vitest/vitest.mjs', 'related', ...related, '--run', '--passWithNoTests', '--maxWorkers', '2'], 'Agent affected tests');
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
  const receipt = { head, base, files, status: 'running', checks: [], omitted: ['full suites', 'security scans', 'cross-platform packaging', 'physical device tests', 'live provider/database qualification', 'release build', 'deployment', 'production health verification'] };
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
