const fs = require('node:fs/promises');
const path = require('node:path');

// Leave space for directory entries and ZIP headers below the ZIP64 sentinels.
function verifyZip32Totals({ files, entries = files, bytes, largest }) {
  if (![files, entries, bytes, largest].every(Number.isSafeInteger) ||
      files < 1 || entries < files || entries > 60_000 || bytes < 0 ||
      largest < 0 || largest > bytes || bytes >= 0xe0000000)
    throw new Error('Windows compact payload exceeds its ZIP32 bounds');
}

async function verifyWindowsZip32({ appOutDir }) {
  const totals = { files: 0, entries: 0, bytes: 0, largest: 0 };
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      totals.entries++;
      if (entry.isSymbolicLink()) throw new Error('Windows ZIP32 payload contains a link');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const stat = await fs.stat(file);
        totals.files++; totals.bytes += stat.size;
        totals.largest = Math.max(totals.largest, stat.size);
      } else throw new Error('Windows ZIP32 payload contains a special file');
    }
  }
  await visit(appOutDir);
  verifyZip32Totals(totals);
  console.log(JSON.stringify({ windowsZip32: true, ...totals }));
}

module.exports = verifyWindowsZip32;
module.exports.verifyZip32Totals = verifyZip32Totals;
