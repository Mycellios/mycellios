import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const script = workflow.split('        run: |\n')[1].replace(/^ {10}/gm, '');
for (const [label, overrides, accepted] of [
  ['default-branch push', {}, true],
  ['manual readiness', { EVENT_NAME: 'workflow_dispatch' }, true],
  ['invalid revision', { RELEASE_SHA: 'not-a-sha' }, false],
  ['nondefault branch', { RELEASE_BRANCH: 'feature/other' }, false],
  ['unadmitted event', { EVENT_NAME: 'pull_request' }, false],
  ['actual default branch', { RELEASE_BRANCH: 'new', DEFAULT_BRANCH: 'new' }, true],
]) {
  test(`fast readiness handles ${label}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'mycellios-fast-ci-'));
    const summary = join(directory, 'summary.md').replaceAll('\\', '/');
    try {
      const result = spawnSync(process.env.TEST_BASH || 'bash', ['-e', '-c', script], {
        encoding: 'utf8', env: { ...process.env, RELEASE_SHA: 'a'.repeat(40), RELEASE_BRANCH: 'main',
          DEFAULT_BRANCH: 'main', EVENT_NAME: 'push', GITHUB_STEP_SUMMARY: summary, ...overrides },
      });
      assert.ifError(result.error);
      assert.equal(result.status === 0, accepted, result.stderr + result.stdout);
      if (accepted) {
        assert.match(readFileSync(summary, 'utf8'), /NOT RUN/);
        assert.match(result.stdout, /does not certify or perform a deployment/);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('readiness neither polls full CI nor triggers a production action', () => {
  assert.match(workflow, /name: CI summary/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(script, /curl|urlopen|fetch\(|npm |pnpm |docker |deploy\/by-repo|time\.sleep/);
  assert.doesNotMatch(workflow, /GH_TOKEN|checks: write|contents: write|secrets\./);
});
