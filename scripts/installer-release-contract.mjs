const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validatePlatformReceipt(receipt,{revision,tree,version,platform}){
 const ids=platform==='linux'?['linux-x64','fedora-x64']:[platform];
 if(!['linux','macos-arm64','macos-x64'].includes(platform)||receipt?.schema!=='mycellios-platform-release/1'||receipt.revision!==revision||receipt.tree!==tree||receipt.version!==version||receipt.platform!==platform||receipt.qualifiedStartup!==true||receipt.automaticUpdates!==false||!Array.isArray(receipt.files)||receipt.files.length!==ids.length)throw Error('Native platform qualification required');
 const seen=new Set();
 for(const file of receipt.files){
  const format=file.id==='linux-x64'?'DEB':file.id==='fedora-x64'?'RPM':'DMG';
  if(!ids.includes(file.id)||seen.has(file.id)||file.version!==version||file.format!==format||typeof file.fileName!=='string'||!/^[A-Za-z0-9._-]{1,220}$/.test(file.fileName)||!file.fileName.startsWith(`Mycellios-Desktop-${version}-`)||!file.fileName.endsWith('.'+format.toLowerCase())||!hash(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2_000_000_000)throw Error('Invalid native installer identity');
  seen.add(file.id);
 }
 return receipt.files;
}
