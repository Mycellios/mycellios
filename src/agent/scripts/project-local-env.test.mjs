import {describe,it,expect} from 'vitest';
import {projectLocalEnvironment,localDataDir,localWorkerReady} from './project-local-env.mjs';
describe('isolated project backend',()=>{
  it('accepts only a live worker heartbeat and reconciliation from this startup',()=>{
    expect(localWorkerReady({heartbeat:10000,reconciled:10000},9000,true,11000)).toBe(true);
    expect(localWorkerReady({heartbeat:8000,reconciled:8000},9000,true,11000)).toBe(false);
    expect(localWorkerReady({heartbeat:10000,reconciled:10000},9000,false,11000)).toBe(false);
    expect(localWorkerReady({heartbeat:'10000',reconciled:10000},9000,true,11000)).toBe(false);
    expect(localWorkerReady({heartbeat:100000,reconciled:10000},9000,true,11000)).toBe(false);
    expect(localWorkerReady({heartbeat:10000,reconciled:100000},9000,true,11000)).toBe(false);
    expect(localWorkerReady({heartbeat:10000,reconciled:10000},9000,true,400000)).toBe(false);
  });
  it('drops production databases, SSO, models and telemetry instead of inheriting them',()=>{
    const env=projectLocalEnvironment({PATH:'tools',APPDATA:'profile',DATABASE_URL:'remote',OIDC_ISSUER:'remote',OPENROUTER_API_KEY:'secret',SENTRY_DSN:'secret',AWS_PROFILE:'prod',NODE_OPTIONS:'--require remote'});
    expect(env.PATH).toBe('tools');expect(env.APPDATA).toBe('profile');
    for(const key of ['DATABASE_URL','OIDC_ISSUER','OPENROUTER_API_KEY','SENTRY_DSN','AWS_PROFILE','NODE_OPTIONS'])expect(env[key]).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBe('http://127.0.0.1:5192');
    expect(env.API_PROXY_TARGET).toBe('http://127.0.0.1:3100');
    expect(env.DATA_DIR).toBe(localDataDir);expect(env.RAKAZO_PROJECT_LOCAL).toBe('1');
  });
});
