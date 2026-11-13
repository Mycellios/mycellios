import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {platformVersions} from './installer-version.mjs';
import {verifyPublicInstallerRange} from './installer-public-probe.mjs';
const versions=platformVersions(JSON.parse(await readFile('src/agent/apps/desktop/package.json','utf8')).version);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const base='https://www.mycellios.com';
const request=async url=>{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Release surface not available');return r;};
const manifest=await(await request(`https://github.com/Mycellios/mycellios/releases/download/desktop-v${versions.desktop}-windows-preview/installer-release.json`)).json();
if(manifest.revision!==revision||manifest.version!==versions.desktop)throw Error('Published source differs');
const until=Date.now()+20*60_000;let admitted;
while(Date.now()<until){
 try{
  const catalog=await(await request(base+'/public/v1/desktop-downloads?include=macos-all')).json();
  const android=await(await request(base+'/downloads/android/latest.json')).json();
  const rows=[...catalog.packages,catalog.fedora];
  if(catalog.version!==versions.desktop||rows.length!==5||manifest.platforms.some(p=>!rows.some(r=>r.id===p.id&&r.version===versions.desktop&&r.sha256===p.sha256&&r.bytes===p.bytes))||android.revision!==revision||android.version!==versions.android||android.versionCode!==versions.androidVersionCode||android.signerSha256!==manifest.android.signerSha256)throw Error('The host has not promoted this qualified set yet');
  admitted=[...rows,android];break;
 }catch{console.log('Waiting for the qualified signing host and public catalog');}
 await new Promise(resolve=>setTimeout(resolve,20_000));
}
if(!admitted)throw Error('Public promotion deadline exceeded; previous catalog is retained');
for(const file of admitted){
 await verifyPublicInstallerRange(file);
}
console.log(JSON.stringify({published:true,revision,desktop:versions.desktop,android:versions.android,verifiedDownloads:admitted.length,physicalDeviceInstallation:false}));
