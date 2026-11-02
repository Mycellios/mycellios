import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {projectLocalEnvironment,localDataDir,localWorkerReady} from './project-local-env.mjs';
describe('isolated project backend',()=>{
  it('accepts only a live worker heartbeat and reconciliation from this startup',()=>{
    assert.equal(localWorkerReady({heartbeat:10000,reconciled:10000},9000,true,11000),true);
    assert.equal(localWorkerReady({heartbeat:8000,reconciled:8000},9000,true,11000),false);
    assert.equal(localWorkerReady({heartbeat:10000,reconciled:10000},9000,false,11000),false);
    assert.equal(localWorkerReady({heartbeat:'10000',reconciled:10000},9000,true,11000),false);
    assert.equal(localWorkerReady({heartbeat:100000,reconciled:10000},9000,true,11000),false);
    assert.equal(localWorkerReady({heartbeat:10000,reconciled:100000},9000,true,11000),false);
    assert.equal(localWorkerReady({heartbeat:10000,reconciled:10000},9000,true,400000),false);
  });
  it('drops production databases, SSO, models and telemetry instead of inheriting them',()=>{
    const env=projectLocalEnvironment({PATH:'tools',APPDATA:'profile',DATABASE_URL:'remote',OIDC_ISSUER:'remote',OPENROUTER_API_KEY:'secret',SENTRY_DSN:'secret',AWS_PROFILE:'prod',NODE_OPTIONS:'--require remote'});
    assert.equal(env.PATH,'tools');assert.equal(env.APPDATA,'profile');
    for(const key of ['DATABASE_URL','OIDC_ISSUER','OPENROUTER_API_KEY','SENTRY_DSN','AWS_PROFILE','NODE_OPTIONS'])assert.equal(env[key],undefined);
    assert.equal(env.BETTER_AUTH_URL,'http://127.0.0.1:5192');
    assert.equal(env.API_PROXY_TARGET,'http://127.0.0.1:3100');
    assert.equal(env.DATA_DIR,localDataDir);assert.equal(env.RAKAZO_PROJECT_LOCAL,'1');
  });
});
