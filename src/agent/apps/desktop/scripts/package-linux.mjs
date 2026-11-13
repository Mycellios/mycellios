import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Arch, build, Platform } from 'electron-builder';
import { stageDevelopmentResources } from './development-resources.mjs';
import {writeUpdatePolicy} from './update-policy.mjs';
import {writeBuildIdentity} from './desktop-release.mjs';
import { prepareLinuxInstaller } from './linux-installer.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const runtimeDeb = argument('--runtime'), runtimeSha256 = argument('--sha256');
if (!runtimeDeb || !runtimeSha256) throw new Error('Use --runtime <verified Linux x64 DEB> --sha256 <pinned hash>');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const config = await prepareLinuxInstaller({ desktopRoot: root, runtimeDeb, runtimeSha256, output: argument('--out') ?? path.join(root, 'release'), version, development: await stageDevelopmentResources(root) });
config.extraResources.push(await writeUpdatePolicy(config.directories.output,'linux','x64'));
await writeBuildIdentity(root,config.directories.output,'linux-x64',true);
config.publish=[{provider:'generic',url:'https://www.mycellios.com/downloads/desktop/updates/linux/x64'}];
await build({ targets: Platform.LINUX.createTarget(['AppImage', 'deb'], Arch.x64), projectDir: root, config, publish: 'never' });

