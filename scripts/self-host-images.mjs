// Self-host images for ghcr.io/<owner>/<repo>: app, computer and updater, built only from this
// repository's main branch (specs/trusted-distribution/spec.md, phase 1).
// .github/workflows/self-host-images.yml runs plan, publish and edge for each main commit;
// installer-release.yml runs release once a Desktop release is published.
//
// Tags are written once. A sha-<commit> manifest that already holds both architectures is kept.
// deploy.yml publishes an amd64-only computer:sha-<commit> for Nucleus; publish adds arm64 to
// that exact manifest and never replaces it. edge and v<version> copy a sha-<commit> manifest,
// so they never rebuild an image, and v<version> never moves once written.
//
//   node scripts/self-host-images.mjs plan              architectures that still need a build
//   node scripts/self-host-images.mjs publish <image>   write <image>:sha-<REVISION>
//   node scripts/self-host-images.mjs edge              move edge when REVISION is the newest
//   node scripts/self-host-images.mjs release           alias v<version>, then tag the commit
//
// Environment: REVISION, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GH_TOKEN for the GitHub API,
// BUILDS and DIGESTS for publish, GITHUB_OUTPUT for plan. Registry calls use the job's docker
// login.
import { execFile } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGES = Object.freeze({
  // The Agent API, worker, web and sandbox supervisor, with the Dockerfile's default / base path.
  app: { context: '.', dockerfile: 'src/agent/infra/compose/Dockerfile', revisionArg: 'GIT_SHA' },
  computer: { context: 'src/agent/infra/sandboxes/computer', dockerfile: 'src/agent/infra/sandboxes/computer/Dockerfile' },
  updater: { context: '.', dockerfile: 'src/agent/infra/updater/Dockerfile', revisionArg: 'GIT_SHA' },
});
/** GitHub-hosted runners only; each architecture builds natively, never under emulation. */
export const ARCHES = Object.freeze({ amd64: 'ubuntu-24.04', arm64: 'ubuntu-24.04-arm' });
export const PLATFORMS = Object.freeze(Object.keys(ARCHES).map(arch => `linux/${arch}`));
/** deploy.yml publishes computer:sha-<commit>, amd64 only, for Nucleus in this job. */
export const DEPLOY_WORKFLOW = 'deploy.yml';
export const DEPLOY_COMPUTER_JOB = 'Publish computer image';
export const REVISION_LABEL = 'org.opencontainers.image.revision';
const SOURCE_LABEL = 'org.opencontainers.image.source';
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// GHCR answers "denied" for a package that was never published, such as a first app or updater.
const ABSENT = /not found|manifest unknown|name unknown|denied|unauthorized/i;
const DEPLOY_WAIT_MS = 75 * 60_000;
const DEPLOY_POLL_MS = 30_000;

export function imageRepository(repository, image) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY must be owner/name.');
  if (!Object.hasOwn(IMAGES, image)) throw new Error(`Unknown self-host image: ${image}`);
  return `ghcr.io/${repository.toLowerCase()}/${image}`;
}

const normalizePlatform = name => (name === 'linux/arm64/v8' ? 'linux/arm64' : name);
const platformName = ({ os, architecture, variant }) => normalizePlatform([os, architecture, variant].filter(Boolean).join('/'));

/** Platform to revision label, from `docker buildx imagetools inspect --format '{{json .Image}}'`. */
export function imageRevisions(image) {
  const single = typeof image?.os === 'string' && typeof image?.architecture === 'string';
  const entries = single ? [[platformName(image), image]] : Object.entries(image ?? {});
  return Object.fromEntries(entries
    .map(([name, config]) => [normalizePlatform(name), config?.config?.Labels?.[REVISION_LABEL] ?? null])
    .filter(([name]) => !name.startsWith('unknown')));
}

/** Image platforms an index lists, leaving out attestation manifests. */
export function indexPlatforms(index) {
  return (index?.manifests ?? [])
    .filter(entry => entry.platform && entry.platform.os !== 'unknown'
      && entry.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest')
    .map(entry => platformName(entry.platform));
}

/** Platforms sha-<revision> already holds. Content built from anything else is never reused. */
export function publishedPlatforms(image, revision, published) {
  if (!published) return [];
  for (const [platform, label] of Object.entries(published.revisions)) {
    if (label !== revision) throw new Error(`${image}:sha-${revision} holds ${platform} built from ${label ?? 'an unlabelled source'}.`);
  }
  return Object.keys(published.revisions);
}

export function assertComplete(image, revision, published) {
  const platforms = publishedPlatforms(image, revision, published);
  const missing = PLATFORMS.filter(platform => !platforms.includes(platform));
  if (missing.length) throw new Error(`${image}:sha-${revision} lacks ${missing.join(' and ')}.`);
}

/**
 * Whether deploy.yml publishes computer:sha-<commit> in these runs of that commit: "pending"
 * while it may still push, "published" once it did, "none" when it does not publish it.
 */
export function deployComputerState(runs) {
  let pending = false;
  let published = false;
  for (const run of runs) {
    const jobs = run.jobs.filter(job => job.name === DEPLOY_COMPUTER_JOB);
    // A run that has not listed its jobs yet, or skipped them, settles when it completes.
    if (jobs.length === 0 && run.status !== 'completed') pending = true;
    for (const job of jobs) {
      if (job.status !== 'completed') pending = true;
      else if (job.conclusion === 'success') published = true;
    }
  }
  return pending ? 'pending' : published ? 'published' : 'none';
}

/** The native builds a revision still needs. deploy.yml owns the amd64 computer when it publishes one. */
export function planBuilds({ revision, published, deploy }) {
  const builds = [];
  for (const [image, spec] of Object.entries(IMAGES)) {
    const have = publishedPlatforms(image, revision, published[image]);
    for (const [arch, runner] of Object.entries(ARCHES)) {
      if (have.includes(`linux/${arch}`)) continue;
      if (image === 'computer' && arch === 'amd64' && deploy !== 'none') continue;
      builds.push({
        image, arch, runner, context: spec.context, dockerfile: spec.dockerfile,
        buildArgs: spec.revisionArg ? `${spec.revisionArg}=${revision}` : '',
      });
    }
  }
  return builds;
}

/**
 * Digests to combine into sha-<revision>, or null when it already holds both architectures. A
 * partial manifest (deploy.yml's amd64 computer) is kept whole and only the missing one is added.
 */
export function publishSources({ image, revision, published, built }) {
  const have = publishedPlatforms(image, revision, published);
  const missing = Object.keys(ARCHES).filter(arch => !have.includes(`linux/${arch}`));
  if (missing.length === 0) return null;
  const sources = published ? [published.digest] : [];
  for (const arch of missing) {
    if (!DIGEST.test(built[arch] ?? '')) throw new Error(`${image} has no linux/${arch} build of ${revision}.`);
    sources.push(built[arch]);
  }
  return sources;
}

/** edge only moves forward on main: to the head of main, or past the commit it names now. */
export function edgeDecision({ revision, mainHead, current, currentIsAncestor }) {
  if (current === revision) return 'current';
  if (revision === mainHead || current === null || currentIsAncestor) return 'move';
  return 'newer';
}

export function releaseTag(version) {
  if (!VERSION.test(version ?? '')) throw new Error(`The Desktop version is not X.Y.Z: ${version}`);
  return `v${version}`;
}

/** Commit of each tag in `git ls-remote --tags`; an annotated tag's peeled commit wins. */
export function tagCommits(stdout) {
  const direct = new Map();
  const peeled = new Map();
  for (const line of stdout.split('\n')) {
    const [commit = '', ref = ''] = line.trim().split(/\s+/);
    if (!COMMIT.test(commit) || !ref.startsWith('refs/tags/')) continue;
    const name = ref.slice('refs/tags/'.length);
    if (name.endsWith('^{}')) peeled.set(name.slice(0, -3), commit);
    else direct.set(name, commit);
  }
  return new Map([...direct, ...peeled]);
}

export function defaultDeps(env = process.env) {
  return {
    env,
    run: (file, args) => new Promise(resolve => {
      execFile(file, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    }),
    fetch: (url, init) => globalThis.fetch(url, init),
    readFile: file => readFile(file, 'utf8'),
    appendFile: (file, text) => appendFile(file, text),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: message => console.log(message),
  };
}

const lastLine = text => String(text).trim().split('\n').at(-1) ?? '';

async function command(deps, file, args) {
  const result = await deps.run(file, args);
  if (result.code !== 0) throw new Error(`${file} ${args.slice(0, 3).join(' ')} failed: ${lastLine(result.stderr)}`);
  return result.stdout;
}

const imagetools = (deps, args) => command(deps, 'docker', ['buildx', 'imagetools', ...args]);

/** The digest and per-platform revision labels of repository:tag, or null when it does not exist. */
export async function inspect(deps, repository, tag) {
  const head = await deps.run('docker', ['buildx', 'imagetools', 'inspect', `${repository}:${tag}`, '--format', '{{.Manifest.Digest}}']);
  if (head.code !== 0) {
    if (ABSENT.test(head.stderr)) return null;
    throw new Error(`Could not read ${repository}:${tag}: ${lastLine(head.stderr)}`);
  }
  const digest = head.stdout.trim();
  if (!DIGEST.test(digest)) throw new Error(`${repository}:${tag} reported no manifest digest.`);
  // Read the configs by digest, so a tag that moves in between cannot mix two manifests.
  const image = JSON.parse(await imagetools(deps, ['inspect', `${repository}@${digest}`, '--format', '{{json .Image}}']));
  return { digest, revisions: imageRevisions(image) };
}

async function github(deps, resource, init = {}) {
  return deps.fetch(`https://api.github.com/repos/${deps.env.GITHUB_REPOSITORY}/${resource}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${deps.env.GH_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
}

async function githubJson(deps, resource) {
  const response = await github(deps, resource);
  if (!response.ok) throw new Error(`GitHub API ${resource.split('?')[0]} answered ${response.status}.`);
  return response.json();
}

async function deployRuns(deps, revision) {
  const { workflow_runs: runs = [] } = await githubJson(deps, `actions/workflows/${DEPLOY_WORKFLOW}/runs?head_sha=${revision}&per_page=100`);
  return Promise.all(runs.map(async run => ({
    status: run.status,
    jobs: (await githubJson(deps, `actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs ?? [],
  })));
}

/** Waits while deploy.yml may still push computer:sha-<revision>, so the two never race for it. */
async function settleDeployComputer(deps, revision) {
  const deadline = deps.now() + DEPLOY_WAIT_MS;
  for (;;) {
    const state = deployComputerState(await deployRuns(deps, revision));
    if (state !== 'pending') return state;
    if (deps.now() >= deadline) throw new Error(`${DEPLOY_WORKFLOW} is still publishing computer:sha-${revision}.`);
    deps.log(`Waiting for ${DEPLOY_WORKFLOW} to publish computer:sha-${revision}.`);
    await deps.sleep(DEPLOY_POLL_MS);
  }
}

function revisionFrom(env) {
  const revision = String(env.REVISION ?? '').trim();
  if (!COMMIT.test(revision)) throw new Error('REVISION must be a full lowercase commit.');
  return revision;
}

/** REVISION, refused unless main contains it: self-host images come only from main. */
async function mainRevision(deps) {
  const revision = revisionFrom(deps.env);
  await command(deps, 'git', ['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  if ((await deps.run('git', ['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main'])).code !== 0) {
    throw new Error(`${revision} is not on main.`);
  }
  return revision;
}

async function plan(deps) {
  const revision = await mainRevision(deps);
  const published = {};
  for (const image of Object.keys(IMAGES)) {
    published[image] = await inspect(deps, imageRepository(deps.env.GITHUB_REPOSITORY, image), `sha-${revision}`);
  }
  const deploy = published.computer?.revisions['linux/amd64'] ? 'published' : deployComputerState(await deployRuns(deps, revision));
  const builds = planBuilds({ revision, published, deploy });
  const built = [...new Set(builds.map(build => build.image))];
  if (!deps.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set.');
  await deps.appendFile(deps.env.GITHUB_OUTPUT, `revision=${revision}\nbuilds=${JSON.stringify(builds)}\nbuilt=${JSON.stringify(built)}\n`);
  deps.log(builds.length
    ? `Building ${builds.map(build => `${build.image} ${build.arch}`).join(', ')} for ${revision}.`
    : `Every self-host image of ${revision} is already published.`);
}

async function builtDigests(deps, image) {
  const built = {};
  for (const { arch } of JSON.parse(deps.env.BUILDS || '[]').filter(build => build.image === image)) {
    const digest = await deps.readFile(path.join(deps.env.DIGESTS || 'digests', arch)).then(text => text.trim(), () => null);
    if (digest === null) continue;
    if (!DIGEST.test(digest)) throw new Error(`The ${image} ${arch} build recorded an invalid digest.`);
    built[arch] = digest;
  }
  return built;
}

async function publish(deps, image) {
  const revision = revisionFrom(deps.env);
  const repository = imageRepository(deps.env.GITHUB_REPOSITORY, image);
  const built = await builtDigests(deps, image);
  if (image === 'computer') await settleDeployComputer(deps, revision);
  const published = await inspect(deps, repository, `sha-${revision}`);
  const sources = publishSources({ image, revision, published, built });
  if (sources === null) {
    deps.log(`${repository}:sha-${revision} already holds both architectures; kept.`);
    return;
  }
  const source = `${deps.env.GITHUB_SERVER_URL || 'https://github.com'}/${deps.env.GITHUB_REPOSITORY}`;
  const args = [
    '--annotation', `index:${SOURCE_LABEL}=${source}`,
    '--annotation', `index:${REVISION_LABEL}=${revision}`,
    '--tag', `${repository}:sha-${revision}`,
    ...sources.map(digest => `${repository}@${digest}`),
  ];
  const planned = indexPlatforms(JSON.parse(await imagetools(deps, ['create', '--dry-run', ...args])));
  const missing = PLATFORMS.filter(platform => !planned.includes(platform));
  if (missing.length) throw new Error(`${repository}:sha-${revision} would lack ${missing.join(' and ')}.`);
  await imagetools(deps, ['create', ...args]);
  assertComplete(image, revision, await inspect(deps, repository, `sha-${revision}`));
  deps.log(`Published ${repository}:sha-${revision}.`);
}

/** Points repository:tag at digest. A single source manifest is copied as is: nothing is rebuilt. */
async function alias(deps, repository, digest, tag, movable) {
  const current = await inspect(deps, repository, tag);
  if (current?.digest === digest) return;
  if (current && !movable) throw new Error(`${repository}:${tag} already names ${current.digest}; release tags never move.`);
  await imagetools(deps, ['create', '--tag', `${repository}:${tag}`, `${repository}@${digest}`]);
  const after = await inspect(deps, repository, tag);
  if (after?.digest !== digest) throw new Error(`${repository}:${tag} names ${after?.digest ?? 'nothing'}, not ${digest}.`);
  deps.log(`${repository}:${tag} now names ${digest}.`);
}

async function completeDigests(deps, revision) {
  const digests = {};
  for (const image of Object.keys(IMAGES)) {
    const published = await inspect(deps, imageRepository(deps.env.GITHUB_REPOSITORY, image), `sha-${revision}`);
    assertComplete(image, revision, published);
    digests[image] = published.digest;
  }
  return digests;
}

async function edge(deps) {
  const revision = await mainRevision(deps);
  const digests = await completeDigests(deps, revision);
  const current = await inspect(deps, imageRepository(deps.env.GITHUB_REPOSITORY, 'app'), 'edge');
  const labels = new Set(Object.values(current?.revisions ?? {}));
  const currentRevision = labels.size === 1 ? [...labels][0] : null;
  const mainHead = (await command(deps, 'git', ['rev-parse', 'refs/remotes/origin/main'])).trim();
  const currentIsAncestor = COMMIT.test(currentRevision ?? '')
    && (await deps.run('git', ['merge-base', '--is-ancestor', currentRevision, revision])).code === 0;
  if (edgeDecision({ revision, mainHead, current: currentRevision, currentIsAncestor }) === 'newer') {
    deps.log(`edge already names a newer main commit than ${revision}; kept.`);
    return;
  }
  for (const [image, digest] of Object.entries(digests)) {
    await alias(deps, imageRepository(deps.env.GITHUB_REPOSITORY, image), digest, 'edge', true);
  }
}

/** The commit `tag` names in this repository, or null. A tag on another commit is refused. */
async function taggedCommit(deps, tag, revision) {
  const existing = tagCommits(await command(deps, 'git', ['ls-remote', '--tags', 'origin'])).get(tag) ?? null;
  if (existing !== null && existing !== revision) throw new Error(`${tag} already names ${existing}; release tags never move.`);
  return existing;
}

async function release(deps) {
  const revision = await mainRevision(deps);
  if ((await command(deps, 'git', ['rev-parse', 'HEAD'])).trim() !== revision) throw new Error('Check out REVISION before tagging its release.');
  const tag = releaseTag(JSON.parse(await deps.readFile('src/agent/apps/desktop/package.json')).version);
  const tagged = await taggedCommit(deps, tag, revision);
  const digests = await completeDigests(deps, revision);
  for (const [image, digest] of Object.entries(digests)) {
    await alias(deps, imageRepository(deps.env.GITHUB_REPOSITORY, image), digest, tag, false);
  }
  // The source tag goes last, so the updater only finds a release whose images exist.
  if (tagged === revision) return;
  const response = await github(deps, 'git/refs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: revision }),
  });
  // A concurrent run may have created the same tag; only the same commit is accepted.
  if (!response.ok && (await taggedCommit(deps, tag, revision)) !== revision) {
    throw new Error(`Could not tag ${revision} as ${tag} (${response.status}).`);
  }
  deps.log(`Tagged ${revision} as ${tag}.`);
}

export async function main(argv, deps = defaultDeps()) {
  const [name, image] = argv;
  if (name === 'plan') return plan(deps);
  if (name === 'publish') return publish(deps, image);
  if (name === 'edge') return edge(deps);
  if (name === 'release') return release(deps);
  throw new Error('Usage: node scripts/self-host-images.mjs plan | publish <image> | edge | release');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
