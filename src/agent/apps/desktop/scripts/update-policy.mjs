import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function writeUpdatePolicy(output, platform, arch, signed = false) {
  if (!['win32','darwin','linux'].includes(platform) || !['x64','arm64'].includes(arch)) throw Error('Unsupported update platform');
  const channel = {win32:'windows',darwin:'macos',linux:'linux'}[platform];
  const policy = {schema:'mycellios-desktop-update-policy/1',platform,arch,
    automaticUpdates: platform === 'linux' || signed, trust: platform === 'linux' ? 'appimage' : signed ? 'signed' : 'manual',
    feedUrl:`https://www.mycellios.com/downloads/desktop/updates/${channel}/${arch}`};
  await mkdir(output,{recursive:true});
  const file = path.resolve(output,'desktop-update-policy.json');
  await writeFile(file,JSON.stringify(policy,null,2)+'\n');
  return {from:file,to:'desktop-update-policy.json'};
}
