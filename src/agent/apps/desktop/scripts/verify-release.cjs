/** @param {import('app-builder-lib').BeforePackContext} context */
module.exports = async context => {
  const { verifyDesktopRelease } = await import('./release-continuity.mjs');
  await verifyDesktopRelease(context.packager.info.appDir);
};
