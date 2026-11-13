import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [output]=process.argv.slice(2);
if(!output)throw Error('Provide release output');
const gradle=await fs.readFile('src/agent/apps/android/app/build.gradle','utf8');
const version=process.env.MYCELLIOS_ANDROID_VERSION??/versionName .*?'([0-9]+\.[0-9]+\.[0-9]+)'/.exec(gradle)?.[1];
const versionCode=Number(process.env.MYCELLIOS_ANDROID_VERSION_CODE??/versionCode .*?'(\d+)'/.exec(gradle)?.[1]);
if(!version||!/^\d+\.\d+\.\d+$/.test(version)||!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>=2_100_000_000)throw Error('Invalid Android version');
const assets='src/agent/apps/android/app/src/main/assets';
const target=path.join(assets,'web');
await fs.mkdir(assets,{recursive:true});
try{await fs.access(target);throw Error('Refusing to mix an old packaged web build');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.cp('src/agent/apps/web/dist',target,{recursive:true});
const files={};
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())files[path.relative(target,p).replaceAll('\\','/')]=createHash('sha256').update(await fs.readFile(p)).digest('hex');else throw Error('Unsupported web resource');}}
await walk(target);
await fs.writeFile(path.join(assets,'web-files.json'),JSON.stringify(Object.keys(files).sort()));
await fs.mkdir(output,{recursive:true});
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
await fs.writeFile(path.join(output,'android-build.json'),JSON.stringify({schema:'mycellios-android-build/1',revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),version,versionCode,applicationId:'com.mycellios.android',minSdk:26,sharedWebFiles:files},null,2));
