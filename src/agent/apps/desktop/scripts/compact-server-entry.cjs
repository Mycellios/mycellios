require('./compact-resource-preload.cjs');
import('./runtime.asar/dist/desktop-local-entry.js').catch(error => {
  console.error(error);
  process.exit(1);
});
