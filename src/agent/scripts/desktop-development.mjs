// UI only: no environment files, API, workers or database.
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceAliases } from '../apps/desktop/scripts/workspace-aliases.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');
const require = createRequire(path.join(web, 'package.json'));
// Workspaces may reuse an exact-version dependency cache through junctions.
const dependencyPath = require.resolve('react').replaceAll('\\', '/');
const dependencyRoot = dependencyPath.slice(0, dependencyPath.indexOf('/node_modules/') + '/node_modules'.length);
const load = async name => import(pathToFileURL(require.resolve(name)).href);
const [{ createServer }, { default: react }, { default: babel }, { lingui }, { default: tailwindcss }] = await Promise.all([
  load('vite'), load('@vitejs/plugin-react'), load('@rolldown/plugin-babel'), load('@lingui/vite-plugin'), load('@tailwindcss/vite'),
]);
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const aliases = Object.entries(await workspaceAliases(root)).sort((a,b) => b[0].length-a[0].length).map(([name,replacement]) => ({ find: new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'), replacement }));
aliases.unshift(
  { find: /^@rakazo\/ui-web\/components\/ui\/(.+)$/, replacement: path.join(root, 'packages/ui-web/src/components/ui/$1.tsx') },
  { find: /^@rakazo\/ui-web\/hooks\/(.+)$/, replacement: path.join(root, 'packages/ui-web/src/hooks/$1.ts') },
);
process.chdir(web);
const base = process.env.MYCELLIOS_DEVELOPMENT_BASE_PATH ?? '/agent/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('Invalid development base path');
const projectLabel = (process.env.MYCELLIOS_DEVELOPMENT_PROJECT_NAME ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const server = await createServer({
  configFile: false, envDir: false, root: web, base,
  define: { 'import.meta.env.RAKAZO_BUILD': JSON.stringify('') }, resolve: { alias: aliases, dedupe: ['react', 'react-dom'] },
  plugins: [react(), babel({ plugins: ['@lingui/babel-plugin-lingui-macro'] }), lingui(), tailwindcss(), {
    name: 'desktop-development-label',
    // Explicit CSS delivery also works through the credential-free native asset proxy.
    transformIndexHtml: html => html.replace(/href="([^"]*\/src\/startup\.css)"/, 'href="$1?direct"').replace('<title>Mycellios Agent</title>', '<title>Mycellios · Desarrollo</title>').replace('</body>', '<div role="status" style="position:fixed;right:12px;bottom:5px;z-index:99999;pointer-events:none;padding:2px 8px;border-radius:4px;background:var(--background);color:var(--foreground);font:12px system-ui">'+projectLabel+' · Desarrollo · cambios en vivo · cuenta real</div></body>'),
  }],
  server: { host: '127.0.0.1', port, strictPort: true, allowedHosts: ['127.0.0.1'],
    hmr: { protocol: 'ws', host: '127.0.0.1', port, clientPort: port }, fs: { strict: true, allow: [root, dependencyRoot] } },
});
await server.listen();
console.log('MYCELLIOS_DEVELOPMENT_READY '+JSON.stringify({ port }));
let closing = false;
async function close() { if (closing) return; closing = true; await server.close(); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
const owner = process.ppid;
setInterval(() => { try { process.kill(owner, 0); } catch { void close(); } }, 2000).unref();

