import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
process.env.RAKAZO_PROJECT_LOCAL = '1';
const output = path.resolve(process.argv[2] ?? 'build/tailscale-ui');
await mkdir(output, { recursive: true });
const root = path.resolve('apps/web'); process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'isolated-tailnet-ui', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__tailnet_fixture') return next();
        const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/tailscale-preview.tsx"></script></body></html>');
        res.setHeader('content-type', 'text/html'); res.end(html);
      });
    },
  }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  // Query helpers build their own immutable Space client; intercept only the
  // fixture's read RPCs while mutations use the injected scoped client.
  await page.route('**/rpc/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = pathname.endsWith('/bots/list')
      ? [{ id: 'mico-a', name: 'Research' }, { id: 'mico-b', name: 'Support' }]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ json }) });
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__tailnet_fixture`);
  await page.getByRole('button', { name: 'Add network', exact: true }).click();
  await page.getByLabel('Network name', { exact: true }).fill('Example private network');
  await page.getByLabel('Tailscale DNS suffix', { exact: true }).fill('tail123.ts.net');
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await page.getByRole('heading', { name: 'Example private network' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.tailscaleFixture.rows()[0].allowedBotIds), ['mico-a']);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('link', { name: 'Sign in to Tailscale', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Sign in to Tailscale' }).getAttribute('href'), 'https://login.tailscale.com/a/synthetic-test');
  await page.screenshot({ path: path.join(output, 'tailscale-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('button', { name: 'Save Mico access', exact: true }).click();
  await page.waitForFunction(() => window.tailscaleFixture.rows()[0].allowedBotIds.length === 0);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByText('Disconnected', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Sign in to Tailscale' }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'tailscale-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.getByRole('button', { name: 'Manage MCP servers', exact: true }).click();
  await page.getByLabel('Server name', { exact: true }).fill('Private MCP');
  await page.getByLabel('Server URL', { exact: true }).fill('https://mcp.tail123.ts.net/mcp');
  await page.getByRole('button', { name: 'Example private network', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'tailscale-mcp-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(errors, []);
  console.log('PASS: real network/MCP components, explicit Mico grant and revocation, enrollment link, disconnect and 390px layout; RPCs synthetic, no live tailnet');
} finally { await browser?.close(); await server.close(); }
