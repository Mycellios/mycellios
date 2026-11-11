import { existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const system = [process.env.WORKSPACE_UI_CHROMIUM, '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium']
  .find(file => file && !/[\r\n]/.test(file) && existsSync(file));
if (system) {
  console.log(execFileSync(system, ['--version'], { encoding: 'utf8' }).trim());
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `WORKSPACE_UI_CHROMIUM=${system}\n`);
  console.log('Using the installed browser for real UI acceptance.');
} else {
  execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'install', 'chromium', '--only-shell', '--with-deps'], { stdio: 'inherit' });
}
