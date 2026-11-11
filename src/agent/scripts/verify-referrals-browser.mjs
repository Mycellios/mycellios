import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
process.env.RAKAZO_PROJECT_LOCAL = '1';
const output = path.resolve('../../.ci/referrals-ui'); await mkdir(output, { recursive: true });
const root = path.resolve('apps/web'); process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'isolated-referrals', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__referrals')) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/referrals.tsx"></script></body></html>');
      res.setHeader('content-type', 'text/html'); res.end(html);
    });
  } }] });
let browser;
try {
  await server.listen(); browser = await chromium.launch();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__referrals`;
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const open = async query => { await page.goto(base + query); await page.getByRole('button', { name: 'Invitar amigos', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); };
  for (const [name, query] of [['light', ''], ['dark', '?dark'], ['mobile', '?mobile']]) {
    await page.setViewportSize(name === 'mobile' ? { width: 390, height: 844 } : { width: 1100, height: 800 });
    await open(query);
    await expect(page.getByRole('dialog')).toContainText('1 crédito promocional para cada uno');
    await expect(page.getByRole('dialog')).toContainText('14 días');
    const personal = `https://www.mycellios.com/v1/referrals/visit/${'f'.repeat(43)}`;
    await expect(page.getByLabel('Enlace de invitación')).toHaveValue(personal);
    await page.getByRole('button', { name: 'Copiar enlace', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enlace copiado', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), personal);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  }
  await open('?unavailable'); await expect(page.getByRole('dialog')).toContainText('todavía no está disponible');
  await expect(page.getByLabel('Enlace de invitación')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copiar enlace', exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'unavailable.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, scenarios: ['personal link clipboard', 'light', 'dark', 'mobile without overflow', 'unavailable without fake signup link'], limitation: 'Synthetic transport with real components; no real signup or reward writes.' }, null, 2));
  console.log('Referral browser qualification passed: clipboard, themes, mobile and unavailable state.');
} finally { await browser?.close(); await server.close(); }
