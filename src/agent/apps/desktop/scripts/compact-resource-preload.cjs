// Loaded only by the packaged local server and its Node-mode children.
// Native packages live beside runtime.asar so spawn/dlopen see real paths.
const { registerHooks, isBuiltin, createRequire } = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const root = __dirname;
const archive = path.join(root, 'runtime.asar');
const rootUrl = pathToFileURL(root + path.sep).href;
const archiveUrl = pathToFileURL(archive + path.sep).href;
const missing = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ENOTDIR']);
let resolvingCounterpart = false;
let lastResolution = 'bootstrap';
if(process.env.MYCELLIOS_LOCAL_SERVER_DIAGNOSTICS==='1') {
  setInterval(()=>console.error(JSON.stringify({compactResolution:lastResolution})),5000).unref();
}

function counterpart(url) {
  if (url?.startsWith(archiveUrl)) return rootUrl + url.slice(archiveUrl.length);
  if (url?.startsWith(rootUrl) && !url.startsWith(archiveUrl))
    return archiveUrl + url.slice(rootUrl.length);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    lastResolution=specifier.startsWith('data:') ? '[inline module]' : specifier.slice(0,180);
    try { return nextResolve(specifier, context); }
    catch (error) {
      // Preserve exports/conditions errors and modules outside this resource root.
      if (resolvingCounterpart || !missing.has(error.code) || isBuiltin(specifier)) throw error;
      const parentURL = counterpart(context.parentURL);
      if (!parentURL) throw error;
      let mapped = specifier;
      if (specifier.startsWith('file:')) mapped = counterpart(specifier) ?? specifier;
      else if (path.isAbsolute(specifier)) {
        const url = counterpart(pathToFileURL(specifier).href);
        if (url) mapped = fileURLToPath(url);
      }
      resolvingCounterpart = true;
      try {
        if ([...context.conditions].includes('require')) {
          const filename = createRequire(parentURL).resolve(mapped);
          return {url:pathToFileURL(filename).href,shortCircuit:true};
        }
        return nextResolve(mapped, { ...context, parentURL });
      } catch (fallback) {
        if (fallback.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw fallback;
        throw error;
      } finally { resolvingCounterpart = false; }
    }
  },
});

// The migration CLI uses Electron's Node mode; it needs the same bounded resolver.
// This value is a native-owned packaged path, never renderer or account input.
process.env.NODE_OPTIONS = `--require=${JSON.stringify(__filename)}`;
