import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localDataDir = path.join(projectRoot, 'data', 'project-preview');
export function localWorkerReady(health,startedAt,alive,now=Date.now()) {
  return Boolean(alive && startedAt>0 && health &&
    typeof health.heartbeat==='number' && typeof health.reconciled==='number' &&
    health.heartbeat>=startedAt && health.reconciled>=startedAt &&
    health.heartbeat<=now+5000 && health.reconciled<=now+5000 &&
    now-health.heartbeat<90000 && now-health.reconciled<300000);
}
/** A local preview cannot inherit production database, SSO, telemetry or model credentials. */
export function projectLocalEnvironment(inherited = process.env) {
  const osNames = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USER|USERNAME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|LANG|LANGUAGE|TZ|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|LC_.*)$/i;
  return {
    ...Object.fromEntries(Object.entries(inherited).filter(([name]) => osNames.test(name))),
    RAKAZO_PROJECT_LOCAL: '1', NODE_ENV: 'development',
    WEB_PORT: '5192', WEB_ORIGIN: 'http://127.0.0.1:5192',
    BETTER_AUTH_URL: 'http://127.0.0.1:5192',
    API_PORT: '3100', API_HOST: '127.0.0.1', API_URL: 'http://127.0.0.1:3100',
    API_PROXY_TARGET: 'http://127.0.0.1:3100', APP_BASE_PATH: '/', RAKAZO_DEV_HOST: '127.0.0.1',
    DATA_DIR: localDataDir, SIGNUPS_ENABLED: 'true', SIGNUP_ALLOWLIST: '',
    AUTH_PASSWORD_ENABLED: 'true', MYCELLIOS_SSO_ENABLED: 'false',
    SANDBOX_PROVIDER: 'none', CLOUD_AGENT_PROVIDER: 'none', AGENT_RUNTIME: 'pi',
    WAKEUP_DRIVER: 'graphile', SECRET_STORE: 'encrypted', CONTENT_ENCRYPTION: 'on',
    DB_POOL_MAX: '8', AUTH_BREACHED_PASSWORD_CHECK_ENABLED: 'false',
    RAKAZO_WORKER_HEALTH_FILE: path.join(localDataDir, 'worker-health.json'),
    // Local development owns the same PC that serves the UI, so the desktop relay
    // must be available; without it "use this computer" asks a dead endpoint.
    MYCELLIOS_DESKTOP_RELAY_ENABLED: 'true',
  };
}

export function applyProjectLocalEnvironment() {
  const env = projectLocalEnvironment();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  return env;
}
