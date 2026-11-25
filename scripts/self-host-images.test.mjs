import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ARCHES, IMAGES, deployComputerState, edgeDecision, imageRevisions, indexPlatforms, main,
  planBuilds, publishSources, releaseTag, tagCommits,
} from './self-host-images.mjs';

const revision = 'a'.repeat(40);
const older = 'b'.repeat(40);
const newer = 'c'.repeat(40);
const digest = name => `sha256:${createHash('sha256').update(name).digest('hex')}`;
const config = (label, platform = 'linux/amd64') => {
  const [os, architecture] = platform.split('/');
  return { os, architecture, config: { Labels: { 'org.opencontainers.image.revision': label } } };
};
const repo = image => `ghcr.io/mycellios/mycellios/${image}`;

test('reads revision labels per platform and leaves attestations out', () => {
  assert.deepEqual(imageRevisions({ 'linux/amd64': config(revision), 'linux/arm64/v8': config(older), 'unknown/unknown': {} }),
    { 'linux/amd64': revision, 'linux/arm64': older });
  assert.deepEqual(imageRevisions(config(revision, 'linux/arm64')), { 'linux/arm64': revision });
  assert.deepEqual(imageRevisions({ 'linux/amd64': { config: {} } }), { 'linux/amd64': null });
  assert.deepEqual(indexPlatforms({ manifests: [
    { platform: { os: 'linux', architecture: 'amd64' } },
    { platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } },
    { platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
  ] }), ['linux/amd64', 'linux/arm64']);
});

test('follows deploy.yml publishing the amd64 computer of a commit', () => {
  const job = (status, conclusion = null, name = 'Publish computer image') => ({ name, status, conclusion });
  assert.equal(deployComputerState([]), 'none');
  assert.equal(deployComputerState([{ status: 'queued', jobs: [] }]), 'pending');
  assert.equal(deployComputerState([{ status: 'in_progress', jobs: [job('in_progress')] }]), 'pending');
  assert.equal(deployComputerState([{ status: 'in_progress', jobs: [job('completed', 'success')] }]), 'published');
  // Without NUCLEUS_DEPLOY_URL the image matrix is skipped under its unexpanded name.
  assert.equal(deployComputerState([{ status: 'completed', jobs: [job('completed', 'skipped', 'Publish ${{ matrix.image }} image')] }]), 'none');
  assert.equal(deployComputerState([{ status: 'completed', jobs: [job('completed', 'failure')] }]), 'none');
});

test('builds natively on GitHub-hosted runners only what a commit still lacks', () => {
  const none = { app: null, computer: null, updater: null };
  const fresh = planBuilds({ revision, published: none, deploy: 'none' });
  assert.deepEqual(fresh.map(build => `${build.image}/${build.arch}/${build.runner}`), [
    'app/amd64/ubuntu-24.04', 'app/arm64/ubuntu-24.04-arm', 'computer/amd64/ubuntu-24.04',
    'computer/arm64/ubuntu-24.04-arm', 'updater/amd64/ubuntu-24.04', 'updater/arm64/ubuntu-24.04-arm',
  ]);
  assert.deepEqual(fresh.map(build => build.buildArgs), [
    `GIT_SHA=${revision}`, `GIT_SHA=${revision}`, '', '', `GIT_SHA=${revision}`, `GIT_SHA=${revision}`,
  ]);
  assert.equal(fresh.find(build => build.image === 'app').dockerfile, 'src/agent/infra/compose/Dockerfile');
  // deploy.yml builds the amd64 computer for Nucleus; this workflow only adds arm64 to it.
  const deploying = planBuilds({ revision, published: none, deploy: 'pending' });
  assert.deepEqual(deploying.filter(build => build.image === 'computer').map(build => build.arch), ['arm64']);
  const deployed = { ...none, computer: { digest: digest('deploy'), revisions: { 'linux/amd64': revision } } };
  assert.deepEqual(planBuilds({ revision, published: deployed, deploy: 'published' }).filter(build => build.image === 'computer').map(build => build.arch), ['arm64']);
  const complete = { digest: digest('complete'), revisions: { 'linux/amd64': revision, 'linux/arm64': revision } };
  assert.deepEqual(planBuilds({ revision, published: { app: complete, computer: complete, updater: complete }, deploy: 'published' }), []);
  assert.throws(() => planBuilds({ revision, published: { ...none, app: { digest: digest('x'), revisions: { 'linux/amd64': older } } }, deploy: 'none' }), /built from b{40}/);
  assert.deepEqual(ARCHES, { amd64: 'ubuntu-24.04', arm64: 'ubuntu-24.04-arm' });
  assert.deepEqual(Object.keys(IMAGES), ['app', 'computer', 'updater']);
});

test('writes sha-<commit> once and extends a partial manifest without replacing it', () => {
  const built = { amd64: digest('amd64'), arm64: digest('arm64') };
  assert.deepEqual(publishSources({ image: 'app', revision, published: null, built }), [built.amd64, built.arm64]);
  const complete = { digest: digest('complete'), revisions: { 'linux/amd64': revision, 'linux/arm64': revision } };
  assert.equal(publishSources({ image: 'app', revision, published: complete, built }), null);
  const deploy = { digest: digest('deploy'), revisions: { 'linux/amd64': revision } };
  assert.deepEqual(publishSources({ image: 'computer', revision, published: deploy, built }), [deploy.digest, built.arm64]);
  assert.throws(() => publishSources({ image: 'computer', revision, published: deploy, built: {} }), /no linux\/arm64 build/);
  assert.throws(() => publishSources({ image: 'app', revision, published: null, built: { amd64: built.amd64 } }), /no linux\/arm64 build/);
  assert.throws(() => publishSources({ image: 'app', revision, published: { digest: digest('x'), revisions: { 'linux/amd64': older } }, built }), /never|built from/);
});

test('moves edge only forward along main and keeps release tags fixed', () => {
  assert.equal(edgeDecision({ revision, mainHead: revision, current: revision, currentIsAncestor: false }), 'current');
  assert.equal(edgeDecision({ revision, mainHead: revision, current: older, currentIsAncestor: false }), 'move');
  assert.equal(edgeDecision({ revision, mainHead: newer, current: null, currentIsAncestor: false }), 'move');
  assert.equal(edgeDecision({ revision, mainHead: newer, current: older, currentIsAncestor: true }), 'move');
  assert.equal(edgeDecision({ revision, mainHead: newer, current: newer, currentIsAncestor: false }), 'newer');
  assert.equal(releaseTag('0.25.0'), 'v0.25.0');
  for (const version of ['0.25', '0.25.0-beta.1', 'v0.25.0', '01.2.3', undefined]) assert.throws(() => releaseTag(version), /not X\.Y\.Z/);
  const tags = tagCommits([
    `${older}\trefs/tags/v0.25.0`, `${revision}\trefs/tags/v0.25.0^{}`, `${newer}\trefs/tags/desktop-v0.25.0-windows-preview`,
    `${newer}\trefs/heads/main`, 'not a line',
  ].join('\n'));
  assert.equal(tags.get('v0.25.0'), revision);
  assert.equal(tags.get('desktop-v0.25.0-windows-preview'), newer);
  assert.equal(tags.has('main'), false);
});

/** A registry, git checkout and GitHub API that answer like the real ones for these commands. */
function world({ head = revision, mainHead = revision, ancestors = [], deployRuns = () => [], remoteTags = '', version = '0.25.0' } = {}) {
  const tags = new Map();
  const images = new Map();
  const created = [];
  const refs = [];
  const logs = [];
  let time = 0;
  const put = (name, platforms, label = revision) => {
    const id = digest(name);
    images.set(id, Object.fromEntries(platforms.map(platform => [platform, config(label, platform)])));
    return id;
  };
  const docker = args => {
    const [command, ...rest] = args.slice(2);
    if (command === 'inspect') {
      const [ref, , format] = rest;
      const id = ref.includes('@') ? ref.split('@')[1] : tags.get(ref);
      if (!id) return { code: 1, stdout: '', stderr: `ERROR: ${ref}: not found` };
      return { code: 0, stdout: format === '{{.Manifest.Digest}}' ? `${id}\n` : JSON.stringify(images.get(id)), stderr: '' };
    }
    if (command === 'create') {
      const dryRun = rest[0] === '--dry-run';
      const options = dryRun ? rest.slice(1) : rest;
      const target = options[options.indexOf('--tag') + 1];
      const sources = options.filter(option => option.includes('@')).map(source => source.split('@')[1]);
      const annotated = options.includes('--annotation');
      const merged = Object.assign({}, ...sources.map(id => images.get(id)));
      if (dryRun) {
        return { code: 0, stdout: JSON.stringify({ manifests: Object.keys(merged).map(platform => ({ platform: { os: 'linux', architecture: platform.split('/')[1] } })) }), stderr: '' };
      }
      created.push({ target, sources, annotated });
      // One source without annotations is copied as is, like buildx does.
      const id = sources.length === 1 && !annotated ? sources[0] : digest(sources.join('+'));
      images.set(id, merged);
      tags.set(target, id);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected docker command' };
  };
  const git = args => {
    if (args[0] === 'fetch') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'merge-base') {
      const [, , ancestor, descendant] = args;
      const target = descendant === 'refs/remotes/origin/main' ? mainHead : descendant;
      const known = ancestor === target || ancestors.some(([a, d]) => a === ancestor && d === target);
      return { code: known ? 0 : 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${args[1] === 'HEAD' ? head : mainHead}\n`, stderr: '' };
    if (args[0] === 'ls-remote') return { code: 0, stdout: [remoteTags, ...refs.map(ref => `${ref.sha}\t${ref.ref}`)].join('\n'), stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected git command' };
  };
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const deps = {
    env: { GITHUB_REPOSITORY: 'Mycellios/mycellios', GITHUB_SERVER_URL: 'https://github.com', GH_TOKEN: 'token', GITHUB_OUTPUT: 'output', REVISION: revision },
    run: async (file, args) => (file === 'docker' ? docker(args) : git(args)),
    fetch: async (url, init = {}) => {
      const resource = url.replace('https://api.github.com/repos/Mycellios/mycellios/', '');
      const runs = deployRuns(time);
      if (resource.startsWith('actions/workflows/deploy.yml/runs?head_sha=')) return json({ workflow_runs: runs.map((run, id) => ({ id, status: run.status })) });
      const jobs = resource.match(/^actions\/runs\/(\d+)\/jobs/);
      if (jobs) return json({ jobs: runs[Number(jobs[1])].jobs });
      if (resource === 'git/refs' && init.method === 'POST') {
        refs.push(JSON.parse(init.body));
        return { ok: true, status: 201, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    readFile: async file => {
      if (file.replaceAll('\\', '/') === 'src/agent/apps/desktop/package.json') return JSON.stringify({ version });
      const arch = file.replaceAll('\\', '/').match(/^digests\/(amd64|arm64)$/)?.[1];
      if (arch && images.has(digest(`built-${arch}`))) return `${digest(`built-${arch}`)}\n`;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    appendFile: async (file, text) => logs.push(`${file}:${text}`),
    sleep: async ms => { time += ms; },
    now: () => time,
    log: message => logs.push(message),
  };
  return { deps, tags, images, created, refs, logs, put };
}

test('plan names the commit, its builds and leaves deploy.yml the amd64 computer', async () => {
  const { deps, logs } = world({ deployRuns: () => [{ status: 'in_progress', jobs: [{ name: 'Publish computer image', status: 'in_progress', conclusion: null }] }] });
  await main(['plan'], deps);
  const output = Object.fromEntries(logs.find(line => line.startsWith('output:')).slice('output:'.length).trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
  assert.equal(output.revision, revision);
  assert.deepEqual(JSON.parse(output.builds).map(build => `${build.image}/${build.arch}`), ['app/amd64', 'app/arm64', 'computer/arm64', 'updater/amd64', 'updater/arm64']);
  assert.deepEqual(JSON.parse(output.built), ['app', 'computer', 'updater']);
  await assert.rejects(main(['plan'], world({ mainHead: newer }).deps), /is not on main/);
  const { deps: invalid } = world();
  invalid.env.REVISION = 'main';
  await assert.rejects(main(['plan'], invalid), /full lowercase commit/);
});

test('publish waits for the Nucleus computer and adds arm64 to that exact manifest', async () => {
  const state = world({ deployRuns: time => [{ status: 'in_progress', jobs: [{ name: 'Publish computer image', status: time < 60_000 ? 'in_progress' : 'completed', conclusion: time < 60_000 ? null : 'success' }] }] });
  const { deps, tags, created, put } = state;
  put('built-arm64', ['linux/arm64']);
  deps.env.BUILDS = JSON.stringify([{ image: 'computer', arch: 'arm64' }]);
  // deploy.yml pushes its amd64 computer while publish waits.
  const nucleus = put('deploy', ['linux/amd64']);
  const sleep = deps.sleep;
  deps.sleep = async ms => { await sleep(ms); if (!tags.has(`${repo('computer')}:sha-${revision}`)) tags.set(`${repo('computer')}:sha-${revision}`, nucleus); };
  await main(['publish', 'computer'], deps);
  assert.deepEqual(created, [{ target: `${repo('computer')}:sha-${revision}`, sources: [nucleus, digest('built-arm64')], annotated: true }]);
  const published = tags.get(`${repo('computer')}:sha-${revision}`);
  assert.deepEqual(Object.keys(state.images.get(published)).sort(), ['linux/amd64', 'linux/arm64']);
});

test('publish keeps a complete tag and refuses foreign or partial content', async () => {
  const kept = world();
  kept.tags.set(`${repo('app')}:sha-${revision}`, kept.put('complete', ['linux/amd64', 'linux/arm64']));
  await main(['publish', 'app'], kept.deps);
  assert.deepEqual(kept.created, []);

  const foreign = world();
  foreign.tags.set(`${repo('updater')}:sha-${revision}`, foreign.put('foreign', ['linux/amd64', 'linux/arm64'], older));
  await assert.rejects(main(['publish', 'updater'], foreign.deps), /built from b{40}/);
  assert.deepEqual(foreign.created, []);

  const partial = world();
  partial.put('built-amd64', ['linux/amd64']);
  partial.deps.env.BUILDS = JSON.stringify([{ image: 'app', arch: 'amd64' }, { image: 'app', arch: 'arm64' }]);
  await assert.rejects(main(['publish', 'app'], partial.deps), /no linux\/arm64 build/);
  assert.deepEqual(partial.created, []);

  const fresh = world();
  fresh.put('built-amd64', ['linux/amd64']);
  fresh.put('built-arm64', ['linux/arm64']);
  fresh.deps.env.BUILDS = JSON.stringify([{ image: 'app', arch: 'amd64' }, { image: 'app', arch: 'arm64' }]);
  await main(['publish', 'app'], fresh.deps);
  assert.deepEqual(fresh.created[0].sources, [digest('built-amd64'), digest('built-arm64')]);
});

function published(state, label = revision) {
  for (const image of Object.keys(IMAGES)) {
    state.tags.set(`${repo(image)}:sha-${label}`, state.put(`${image}-${label}`, ['linux/amd64', 'linux/arm64'], label));
  }
}

test('edge copies the sha-<commit> manifests and never moves backwards', async () => {
  const moved = world();
  published(moved);
  await main(['edge'], moved.deps);
  for (const image of Object.keys(IMAGES)) assert.equal(moved.tags.get(`${repo(image)}:edge`), moved.tags.get(`${repo(image)}:sha-${revision}`));

  const behind = world({ mainHead: newer, ancestors: [[revision, newer]] });
  published(behind);
  published(behind, newer);
  for (const image of Object.keys(IMAGES)) behind.tags.set(`${repo(image)}:edge`, behind.tags.get(`${repo(image)}:sha-${newer}`));
  await main(['edge'], behind.deps);
  assert.equal(behind.tags.get(`${repo('app')}:edge`), behind.tags.get(`${repo('app')}:sha-${newer}`));
  assert.deepEqual(behind.created, []);

  const ahead = world({ mainHead: newer, ancestors: [[older, revision], [revision, newer]] });
  published(ahead);
  published(ahead, older);
  for (const image of Object.keys(IMAGES)) ahead.tags.set(`${repo(image)}:edge`, ahead.tags.get(`${repo(image)}:sha-${older}`));
  await main(['edge'], ahead.deps);
  assert.equal(ahead.tags.get(`${repo('computer')}:edge`), ahead.tags.get(`${repo('computer')}:sha-${revision}`));

  const incomplete = world();
  published(incomplete);
  incomplete.tags.set(`${repo('computer')}:sha-${revision}`, incomplete.put('nucleus-only', ['linux/amd64']));
  await assert.rejects(main(['edge'], incomplete.deps), /computer:sha-a{40} lacks linux\/arm64/);
});

test('release aliases v<version> to the same manifests, then tags the commit once', async () => {
  const fresh = world();
  published(fresh);
  await main(['release'], fresh.deps);
  for (const image of Object.keys(IMAGES)) assert.equal(fresh.tags.get(`${repo(image)}:v0.25.0`), fresh.tags.get(`${repo(image)}:sha-${revision}`));
  assert.deepEqual(fresh.refs, [{ ref: 'refs/tags/v0.25.0', sha: revision }]);
  assert.ok(fresh.created.every(entry => entry.sources.length === 1 && !entry.annotated));

  // Running again keeps everything as it is.
  await main(['release'], fresh.deps);
  assert.equal(fresh.refs.length, 1);

  const moved = world();
  published(moved);
  moved.tags.set(`${repo('app')}:v0.25.0`, moved.put('other', ['linux/amd64', 'linux/arm64']));
  await assert.rejects(main(['release'], moved.deps), /release tags never move/);
  assert.deepEqual(moved.refs, []);

  const tagged = world({ remoteTags: `${older}\trefs/tags/v0.25.0` });
  published(tagged);
  await assert.rejects(main(['release'], tagged.deps), /v0\.25\.0 already names b{40}/);
  assert.deepEqual(tagged.created, []);

  const retried = world({ remoteTags: `${revision}\trefs/tags/v0.25.0` });
  published(retried);
  await main(['release'], retried.deps);
  assert.deepEqual(retried.refs, []);
  assert.equal(retried.tags.get(`${repo('updater')}:v0.25.0`), retried.tags.get(`${repo('updater')}:sha-${revision}`));

  const elsewhere = world({ head: older, ancestors: [[older, revision]] });
  published(elsewhere);
  await assert.rejects(main(['release'], elsewhere.deps), /Check out REVISION/);

  const missing = world();
  await assert.rejects(main(['release'], missing.deps), /app:sha-a{40} lacks/);
  assert.deepEqual(missing.refs, []);
});
