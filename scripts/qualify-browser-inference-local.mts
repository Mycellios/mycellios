// Private loopback qualification. Fictional accounts in a NEW disposable PostgreSQL cluster.
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createHash,generateKeyPairSync,randomUUID } from 'node:crypto';
import {createServer as createNetServer} from 'node:net';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import postgres from 'postgres';
import {MobileComputeHub} from '../src/coordinator/mobile-compute-hub.ts';
import {WorkerAdmissionAuthority} from '../src/coordinator/worker-admission.ts';
import {MeshDatabase} from '../src/storage/database.ts';
import {EconomicLedger} from '../src/economy/economic-ledger.ts';
import {ContributionCreditWallet,contributionCreditSchemaSql} from '../src/economy/contribution-credit-wallet.ts';
import {expiringPromotionSchemaSql} from '../src/economy/promotional-credits.ts';
import {managedPurchasesSchemaSql} from '../src/economy/managed-purchases.ts';
import {browserInferenceCreditsSchemaSql} from '../src/economy/browser-inference-credits.ts';
import {BrowserInference} from '../src/coordinator/browser-inference.ts';
import {mountBrowserInference} from '../src/coordinator/browser-inference-routes.ts';
import {browserTextModel} from '../src/contracts/browser-text.ts';
import {ApiAccessManager} from '../src/coordinator/api-access.ts';
import {buildNativeSourceProvenance} from './native-build-provenance.mjs';
const root=process.cwd(),bin=join(root,'src/agent/node_modules/@embedded-postgres/windows-x64/native/bin');
const cluster=mkdtempSync(join(tmpdir(),'mycellios-browser-inference-pg-'));
process.once('exit',()=>{try{execFileSync(join(bin,'pg_ctl.exe'),['-D',cluster,'-m','fast','-w','stop'],{stdio:'ignore'});}catch{}});
const reserve=createNetServer();await new Promise<void>(r=>reserve.listen(0,'127.0.0.1',r));
const pgPort=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
execFileSync(join(bin,'initdb.exe'),['-D',cluster,'--auth=trust','--no-locale','-U','postgres'],{stdio:'ignore'});
execFileSync(join(bin,'pg_ctl.exe'),['-D',cluster,'-l',join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${pgPort} -c shared_buffers=32MB -c max_connections=20`,'-w','start'],{stdio:'ignore'});
const url=`postgresql://postgres@127.0.0.1:${pgPort}/postgres`,schema='browser_qualification';
const sql=postgres(url,{onnotice:()=>{}});await sql.unsafe(`CREATE SCHEMA ${schema}`);
const source=readFileSync(join(root,'src/storage/database.ts'),'utf8');
for(const table of ['economic_contribution_evidence','economic_accounts','pricing_policies','economic_settlements','economic_ledger_entries','economic_settlement_receipts','node_ownership','economic_node_reputation','api_accounts','api_keys','api_usage']){
 const ddl=source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];if(!ddl)throw new Error('missing test DDL');
 await sql.unsafe(`SET search_path TO ${schema};`+ddl.replace(/\bINTEGER\b/g,'BIGINT'));
}
await sql.unsafe(`SET search_path TO ${schema};CREATE TABLE schema_meta(version integer);INSERT INTO schema_meta VALUES(33);CREATE TABLE api_operator_funded_usage(usage_id text);`+contributionCreditSchemaSql+expiringPromotionSchemaSql+managedPurchasesSchemaSql+browserInferenceCreditsSchemaSql);
const db=await MeshDatabase.openPostgres(url,schema),admissionDb=await MeshDatabase.open(':memory:');
const wallet=new ContributionCreditWallet(db,new EconomicLedger(db,{receiptSigning:{keyId:'local-test',privateKey:generateKeyPairSync('ed25519').privateKey}}),true);await wallet.initialize();
const api=new ApiAccessManager(db,{starterTokens:0,requestsPerMinute:100,maxConcurrent:10,maxActiveKeys:2},{},true);
await api.getOrCreateAccount('test-buyer');await api.getOrCreateAccount('test-contributor');
await db.raw.prepare(`INSERT INTO economic_promotional_grants(id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES('test-only','test-buyer','local-test','fictional-no-cash',200000,?,?)`).run(Date.now(),Date.now()+3600000);
const app=Fastify({logger:false});await app.register(websocket);
app.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
const hub=new MobileComputeHub({admissionAuthority:new WorkerAdmissionAuthority(admissionDb),expertArtifactsPath:join(cluster,'artifacts')});hub.attach(app);
await hub.textHub.enable(app,join(root,'.cache/browser-text-models'));
let service: BrowserInference;
app.post('/__browser-inference-test/bind',async(req,reply)=>{const b=req.body as {workerId:string;token:string};try{return await service.bind('test-contributor',b.workerId,b.token);}catch{return reply.code(403).send({error:'test bind rejected'});}});
app.post('/__browser-inference-test/infer',async()=>service.execute('test-buyer',null,'local-test-'+randomUUID(),inference,service.quote('test-buyer',inference).token));
app.get('/__browser-inference-test/balance',async()=>({earned:(await wallet.summary('account','test-contributor')).availableMicrounits,buyer:(await wallet.summary('account','test-buyer')).availableMicrounits}));
app.get('/__browser-inference-test/proof',async()=>({testOnly:true,supplierRequests:0,workers:hub.listWorkers().map(w=>({backend:w.backend,verifiedTasks:w.verifiedTasks,completedTasks:w.completedTasks,connected:w.connected})),buyer:await wallet.summary('account','test-buyer'),contributor:await wallet.summary('account','test-contributor'),settlements:await db.raw.prepare(`SELECT p.state,p.total_microunits,p.upstream_microunits,p.fee_microunits,c.amount_microunits FROM economic_managed_purchases p JOIN economic_browser_inference_credits c ON c.usage_id=p.usage_id`).all()}));
service=new BrowserInference(db,wallet,api,hub,[{kind:'text',model:'mycellios-browser/gpt2',artifactId:browserTextModel.files['model.onnx'].sha256,costMicrounitsPerToken:50,maxOutputTokens:32}],1000000);await service.initialize();
mountBrowserInference(app,service,request=>({kind:'user',userId:request.headers['x-local-test-account']==='test-buyer'?'test-buyer':'test-contributor'}));
app.post('/v1/chat/completions',async()=>{throw new Error('Browser chat routing was not handled');});
const inference={kind:'text',model:'mycellios-browser/gpt2',prompt:'The capital of France is',maxTokens:12};
await app.listen({host:'127.0.0.1',port:5197});
const {createServer}=await import('../src/agent/node_modules/vite/dist/node/index.js');
const provenance=buildNativeSourceProvenance(root);
const webRoot=join(root,'src/agent/apps/web');
const vite=await createServer({configFile:false,root:webRoot,cacheDir:join(root,'.cache/browser-inference-minimal-vite'),
  define:{__MYCELLIOS_BUILD_IDENTITY__:JSON.stringify({schema:provenance.schema,version:provenance.version,sourceId:provenance.sourceId})},
  resolve:{conditions:['onnxruntime-web-use-extern-wasm','module','browser','development|production']},worker:{format:'es'},
  optimizeDeps:{entries:[join(webRoot,'e2e/fixtures/browser-inference.html')],include:['zod'],noDiscovery:true},
  server:{port:5198,host:'127.0.0.1',strictPort:true,fs:{allow:[root]},proxy:Object.fromEntries(['/v1','/mobile/','/browser/ort/','/__browser-inference-test'].map(path=>[path,{target:'http://127.0.0.1:5197',ws:true}]))}});await vite.listen();
let stopping=false;async function stop(){if(stopping)return;stopping=true;await vite.close();hub.close();await app.close();await db.close();await admissionDb.close();await sql.end();execFileSync(join(bin,'pg_ctl.exe'),['-D',cluster,'-m','fast','-w','stop'],{stdio:'ignore'});process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
writeFileSync(join(root,'.cache/browser-inference-preview.json'),JSON.stringify({pid:process.pid,cluster,port:5198,apiPort:5197,testOnly:true}));
console.log('BROWSER_INFERENCE_TEST_READY http://127.0.0.1:5198/e2e/fixtures/browser-inference.html');
