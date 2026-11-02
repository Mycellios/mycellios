import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Apple Silicon preview: one shared UI and the pinned existing native runtime. */
export async function prepareMacInstaller({desktopRoot,runtimePkg,runtimeSha256,output,version}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid Desktop version');
  if (!/^[a-f0-9]{64}$/.test(runtimeSha256)) throw Error('A pinned runtime hash is required');
  const info=await lstat(runtimePkg);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Runtime payload must be a regular PKG');
  const hash=createHash('sha256');for await(const chunk of createReadStream(runtimePkg))hash.update(chunk);
  if(hash.digest('hex')!==runtimeSha256)throw Error('Runtime payload hash mismatch');
  await mkdir(output,{recursive:true});const manifest=path.join(output,'runtime.json');
  await writeFile(manifest,JSON.stringify({schema:'mycellios-desktop-runtime/1',file:'mycellios-runtime.pkg',sha256:runtimeSha256},null,2));
  const agent=path.resolve(desktopRoot,'../..');
  const repository=path.resolve(agent,'../..');
  return {
    beforePack:path.join(desktopRoot,'scripts/verify-release.cjs'),
    appId:'com.mycellios.agent.desktop',productName:'Mycellios Desktop',
    artifactName:`Mycellios-Desktop-${version}-macos-arm64-preview.\${ext}`,
    directories:{output:path.resolve(output),buildResources:path.join(desktopRoot,'assets')},
    files:['dist/**/*','!dist/**/*.map','package.json'],
    extraMetadata:{name:'mycellios-desktop',version,main:'dist/main.js',homepage:'https://www.mycellios.com'},
    extraResources:[
      {from:path.join(desktopRoot,'local-server'),to:'local-server',filter:['**/*','!node_modules{,/**/*}']},
      {from:path.join(desktopRoot,'local-server/node_modules'),to:'local-server/node_modules',filter:['**/*','!**/.bin{,/**/*}']},
      {from:path.resolve(runtimePkg),to:'contribution/mycellios-runtime.pkg'},
      {from:manifest,to:'contribution/runtime.json'},
      ...['install-runtime-macos.sh','describe-runtime-macos.sh','runtime-public-status.cjs'].map(name=>({from:path.join(desktopRoot,'scripts',name),to:'contribution/'+name})),
      {from:path.join(agent,'apps/web/dist'),to:'web',filter:['**/*','!**/*.map']},
      {from:path.join(agent,'infra/compose/docker-compose.images.yml'),to:'stack/docker-compose.images.yml'},
      {from:path.join(agent,'infra/compose/stack-env.example'),to:'stack/stack-env.example'},
      {from:path.join(agent,'LICENSE'),to:'licenses/Agent-Apache-2.0.txt'},
      {from:path.join(repository,'LICENSE'),to:'licenses/Mycellios-GPL-3.0.txt'},
      {from:path.join(repository,'THIRD_PARTY.md'),to:'licenses/THIRD_PARTY.md'},
    ],
    // Preview only. Never enable the unsigned automatic-update channel.
    mac:{target:[{target:'dmg',arch:['arm64']},{target:'zip',arch:['arm64']}],category:'public.app-category.productivity',icon:path.join(desktopRoot,'assets/icon-macos.png'),identity:null,notarize:false,hardenedRuntime:false,extendInfo:{NSMicrophoneUsageDescription:'Mycellios uses the microphone for dictation and voice calls.'}},
    publish:[],
  };
}
