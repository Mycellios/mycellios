import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { verifyDesktopRelease } from './release-continuity.mjs';

const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function releaseTag(version) {
  if (!VERSION.test(version)) throw Error('Invalid Desktop release version');
  return `desktop-v${version}-windows-preview`;
}
export function assertReleaseIdentity(identity, version) {
  if (!VERSION.test(version) || identity?.schema !== 'mycellios-desktop-build/1' || identity.version !== version ||
      identity.platform !== 'windows-x64' || !SHA.test(identity.revision) || !SHA.test(identity.tree) ||
      !/^[a-f0-9]{64}$/.test(identity.sourceHash) || identity.automaticUpdates !== false)
    throw Error('Invalid Desktop build identity');
  for (const surface of ['web', 'desktop', 'local-server']) {
    const r = identity.surfaces?.[surface];
    if (r?.schema !== 'mycellios-desktop-release/1' || r.surface !== surface ||
        r.version !== version || r.sourceHash !== identity.sourceHash || !/^[a-f0-9]{64}$/.test(r.outputHash))
      throw Error(`Mixed or missing ${surface} build`);
  }
}

/** Executed before packaging: all three compiled surfaces must belong to this exact source. */
export async function writeBuildIdentity(desktopRoot, output) {
  const agent = path.resolve(desktopRoot, '../..');
  await verifyDesktopRelease(desktopRoot);
  const git = (...args) => execFileSync('git', args, {cwd: agent, encoding: 'utf8'}).trim();
  git('diff', '--exit-code', 'HEAD', '--', '.');
  if (git('ls-files', '--others', '--exclude-standard', '--', '.')) throw Error('Commit or isolate untracked Agent sources before packaging');
  const version = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8')).version;
  const surfaces = {};
  for (const surface of ['web', 'desktop', 'local-server']) {
    const directory = surface === 'local-server' ? path.join(desktopRoot, 'local-server') : path.join(agent, 'apps', surface, 'dist');
    surfaces[surface] = JSON.parse(await readFile(path.join(directory, 'release-inputs.json'), 'utf8'));
  }
  const identity = {schema: 'mycellios-desktop-build/1', version, revision: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'), platform: 'windows-x64', automaticUpdates: false,
    sourceHash: surfaces.desktop.sourceHash, surfaces};
  assertReleaseIdentity(identity, version);
  await mkdir(output, {recursive: true});
  const file = path.join(output, 'desktop-build.json');
  await writeFile(file, JSON.stringify(identity, null, 2) + '\n');
  return file;
}

export async function hashes(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Release artifacts must be regular files');
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  for await (const bytes of createReadStream(file)) { sha256.update(bytes); sha512.update(bytes); }
  return {bytes: info.size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64')};
}

/** Produces a complete immutable package/manifest pair; never publishes it or changes a channel. */
export async function writeWindowsRelease(directory, identity, smoke) {
  assertReleaseIdentity(identity, identity?.version);
  if (!smoke?.passed || smoke.version !== identity.version || smoke.revision !== identity.revision || !smoke.isolatedProfile)
    throw Error('Packaged startup qualification is missing or belongs to another build');
  const fileName = `Mycellios-Desktop-${identity.version}-windows-x64-pilot.exe`;
  const artifact = {fileName, ...await hashes(path.join(directory, fileName))};
  if (smoke.installerSha256 !== artifact.sha256) throw Error('Installer changed after qualification');
  const [major,minor,patch]=identity.version.split('.').map(Number);
  const requireInstallation=major>0 || minor>3 || (minor===3 && patch>=19);
  const installation=smoke.installation;
  const expedited=smoke.expedited===true && installation?.status==='not-run' && installation.reason==='operator-expedited-release' && installation.passed===false;
  if(requireInstallation && !expedited && (installation?.passed!==true || installation.version!==identity.version ||
      installation.revision!==identity.revision || installation.installerSha256!==artifact.sha256 ||
      !['fresh','legacy-to-compact'].every(label=>installation.measurements?.some(m=>m.label===label && m.exitCode===0 && Number.isFinite(m.elapsedMs) && m.elapsedMs>0 && m.elapsedMs<60000 && m.draftsPreserved===5 && m.taskMarkersPreserved===5))))
    throw Error('Real Windows installation timing/preservation qualification is missing');
  const blockmap = {fileName: fileName + '.blockmap', ...await hashes(path.join(directory, fileName + '.blockmap'))};
  const entry = {id: 'windows-x64', version: identity.version, format: 'EXE', fileName,
    path: `/downloads/desktop/releases/${identity.version}/${fileName}`, bytes: artifact.bytes, sha256: artifact.sha256};
  const manifest = {...identity,
    schema: 'mycellios-desktop-release-package/1', tag: releaseTag(identity.version), artifact, blockmap,
    catalogEntry: entry, qualifiedStartup: true, qualifiedInstallation:requireInstallation && !expedited,expedited,
    ...(requireInstallation?{installation}:{}),signature: 'unsigned-preview'};
  const previous = await readFile(path.join(directory, 'desktop-release.json'), 'utf8').then(JSON.parse).catch(e => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (previous && JSON.stringify(previous) !== JSON.stringify(manifest)) throw Error('A different immutable release already exists in this directory');
  // electron-updater's standard feed. The owned signed channel remains disabled until qualified.
  const yaml = `version: ${identity.version}\nfiles:\n  - url: ${fileName}\n    sha512: ${artifact.sha512}\n    size: ${artifact.bytes}\npath: ${fileName}\nsha512: ${artifact.sha512}\n`;
  await writeFile(path.join(directory, 'latest.yml'), yaml);
  await writeFile(path.join(directory, 'desktop-release.json'), JSON.stringify(manifest, null, 2) + '\n');
  let sums=`${artifact.sha256}  ${fileName}\n${blockmap.sha256}  ${blockmap.fileName}\n`;
  if(requireInstallation)for(const file of ['latest.yml','desktop-build.json','desktop-release.json','packaged-smoke.json','installer-qualification.json'])
    sums+=`${(await hashes(path.join(directory,file))).sha256}  ${file}\n`;
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), sums);
  return manifest;
}
