import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withWindowsCopyRetry } from './windows-copy-retry.mjs';
import { stageDevelopmentResources } from './development-resources.mjs';
import { stageCompactResources, verifyCompactServer } from './compact-resources.mjs';
import { prepareWindowsInstaller, writeStandaloneWindowsConfig } from './windows-installer.mjs';
import { writeBuildIdentity } from './desktop-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const runtimeMsi = argument('--runtime');
const runtimeSha256 = argument('--sha256');
if (!runtimeMsi || !runtimeSha256) throw new Error('Use --runtime <verified MSI> --sha256 <pinned hash>');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const output = argument('--out') ?? path.join(root, 'release');
const buildIdentity = await writeBuildIdentity(root, output);
const development = await stageDevelopmentResources(root);
const compact = await stageCompactResources(root, development, output);
const config = await prepareWindowsInstaller({ desktopRoot: root, runtimeMsi, runtimeSha256, output, version, development, compact, buildIdentity });
const configFile = await writeStandaloneWindowsConfig(root,config,output);
await withWindowsCopyRetry(async () => {
  const { Arch, build, Platform } = await import('electron-builder');
  await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), projectDir: root, config:configFile, publish: 'never' });
});
console.log(JSON.stringify({compactServer:await verifyCompactServer(path.join(output,'win-unpacked/resources/local-server'))}));

