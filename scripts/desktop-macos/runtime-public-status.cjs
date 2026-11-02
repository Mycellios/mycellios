// Executed only by the privileged helper. Publish identifiers, never configuration or credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const linux = process.platform === 'linux';
const mac = process.platform === 'darwin';
if ((linux || mac) && process.getuid() !== 0) process.exit(77);
const root = mac ? '/Library/Application Support/Mycellios/Product' : linux ? '/opt/mycellios' : path.join(process.env.ProgramFiles, 'Mycellios');
const config = mac ? '/Library/Application Support/Mycellios/Configuration/node.json' : linux ? '/etc/mycellios/node.json' : path.join(process.env.ProgramData, 'Mycellios/Configuration/node.json');
const info = fs.lstatSync(config);
if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) process.exit(22);
const value = JSON.parse(fs.readFileSync(config, 'utf8'));
if (typeof value.nodeId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value.nodeId)) process.exit(22);
const publicValue = JSON.stringify({ schema: 'mycellios-desktop-runtime-status/1', nodeId: value.nodeId });
function publish(destination) {
  const temporary = path.join(root, `.desktop-node.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, publicValue, { flag: 'wx', mode: 0o644 });
    fs.renameSync(temporary, destination);
  } finally { fs.rmSync(temporary, { force: true }); }
}
publish(path.join(root, 'desktop-node.json'));
const at = process.argv.indexOf('--receipt');
if (at >= 0) {
  const receipt = path.resolve(process.argv[at + 1] || '');
  if (path.dirname(receipt) !== root || !/^\.desktop-status-receipt-[a-f0-9-]{36}\.json$/.test(path.basename(receipt))) process.exit(64);
  publish(receipt);
}
