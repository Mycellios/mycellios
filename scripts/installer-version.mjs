import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
export function platformVersions(version){
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Invalid installer version');
 const [major,minor,patch]=version.split('.').map(Number);
 if(major>1999||minor>999||patch>999)throw Error('Installer version exceeds Android monotonic bounds');
 return {desktop:version,android:`${major+1}.${minor}.${patch}`,androidVersionCode:100_000+major*1_000_000+minor*1000+patch};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const v=platformVersions(JSON.parse(await readFile('src/agent/apps/desktop/package.json','utf8')).version);
 console.log(`MYCELLIOS_ANDROID_VERSION=${v.android}\nMYCELLIOS_ANDROID_VERSION_CODE=${v.androidVersionCode}`);
}
