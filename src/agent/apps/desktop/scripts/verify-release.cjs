const { existsSync } = require('node:fs');
const path = require('node:path');

/** @param {import('app-builder-lib').BeforePackContext} context */
module.exports = async context => {
  const appDir = context.packager.info.appDir;
  // The WhatsApp runtime bundles GPL/AGPL code; it must never ship in a PolyForm Shield release.
  if (existsSync(path.join(appDir, 'dist', 'whatsapp-runtime.js')))
    throw new Error('Release builds must not include dist/whatsapp-runtime.js (GPL WhatsApp runtime).');
  const { verifyDesktopRelease } = await import('./release-continuity.mjs');
  await verifyDesktopRelease(appDir);
};
