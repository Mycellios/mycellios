import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMacInstaller} from '../../../../../scripts/desktop-macos/macos-installer.mjs';
import {stageDevelopmentResources} from './development-resources.mjs';
import {stageCompactResources} from './compact-resources.mjs';
import {writeBuildIdentity} from './desktop-release.mjs';
import {writeUpdatePolicy} from './update-policy.mjs';

if(process.platform!=='darwin'||!['arm64','x64'].includes(process.arch))throw Error('Use a native Mac runner for each architecture');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const output=path.resolve(argument('--out')??path.join(root,'release'));
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const signed=process.env.MYCELLIOS_SIGNED_RELEASE==='1';
if(signed&&(!process.env.CSC_LINK||!process.env.CSC_KEY_PASSWORD||!process.env.APPLE_API_KEY||!process.env.APPLE_API_KEY_ID||!process.env.APPLE_API_ISSUER))throw Error('Signed Mac release requires Developer ID and notarization credentials');
await mkdir(output,{recursive:true});
const identity=await writeBuildIdentity(root,output,`macos-${process.arch}`,signed);
const development=await stageDevelopmentResources(root);
const compact=await stageCompactResources(root,development,output);
const config=await prepareMacInstaller({desktopRoot:root,output,version,arch:process.arch,runtimePkg:argument('--runtime'),runtimeSha256:argument('--sha256'),scriptsRoot:path.resolve(root,'../../../../scripts/desktop-macos')});
config.beforePack=path.join(root,'scripts/verify-release.cjs');
config.extraResources.push({from:identity,to:'desktop-build.json'},await writeUpdatePolicy(output,'darwin',process.arch,signed),
  {from:compact.server,to:'local-server'}, {from:compact.source,to:'development-source.asar'}, {from:compact.npm,to:'development-tools/npm.asar'});
config.forceCodeSigning=signed;
config.mac={...config.mac,identity:signed?undefined:'-',notarize:signed,hardenedRuntime:signed,
  entitlements:path.join(root,'assets/entitlements.mac.plist'),entitlementsInherit:path.join(root,'assets/entitlements.mac.plist')};
config.publish=[{provider:'generic',url:`https://www.mycellios.com/downloads/desktop/updates/macos/${process.arch}`}];
// Electron-builder must resolve its modules against the canonical Agent workspace.
const {build,Arch,Platform}=await import('electron-builder');
await build({targets:Platform.MAC.createTarget(['dmg','zip'],process.arch==='arm64'?Arch.arm64:Arch.x64),projectDir:root,config,publish:'never'});
await writeFile(path.join(output,'release-mode.json'),JSON.stringify({platform:`macos-${process.arch}`,signed,automaticUpdates:signed})+'\n');
