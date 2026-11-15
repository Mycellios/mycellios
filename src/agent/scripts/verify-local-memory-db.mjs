// Creates and removes ONLY an isolated test database/role on the owned project-local cluster.
import {readFile} from 'node:fs/promises';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {Client} from 'pg';import {fileURLToPath} from 'node:url';import path from 'node:path';import assert from 'node:assert/strict';
let embedded;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const data=path.join(root,'data/project-preview');
let identity,port;
if(process.env.MEMORY_TEST_EPHEMERAL==='1'){
 assert(process.platform==='linux','Ephemeral CI database is Linux-only');
 if(process.env.GITHUB_ACTIONS!=='true')await readFile('/.dockerenv');const {default:EmbeddedPostgres}=await import('embedded-postgres');
 const net=await import('node:net');const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 identity={databasePassword:randomUUID().replaceAll('-',''),encryptionKey:'memory-review-ci-test-key-not-a-production-secret'};
 embedded=new EmbeddedPostgres({databaseDir:'/tmp/memory-review-'+randomUUID(),user:'postgres',password:identity.databasePassword,port,persistent:false,createPostgresUser:process.getuid()===0,autoRehydrateSymlinks:true});await embedded.initialise();await embedded.start();
}else{identity=JSON.parse(await readFile(path.join(data,'identity.json'),'utf8'));port=Number((await readFile(path.join(data,'postgres/postmaster.pid'),'utf8')).split(/\r?\n/)[3]);}assert(port>1024);
const suffix=randomUUID().replaceAll('-','');const name='memory_test_'+suffix;const role='memory_role_'+suffix;const password=randomUUID().replaceAll('-','');assert(/^[a-z0-9_]+$/.test(name+role));
const admin=new Client({host:'127.0.0.1',port,user:'postgres',password:identity.databasePassword,database:'postgres'});await admin.connect();let created=false,roleCreated=false;
const url=(user,pw,database)=>'postgresql://'+user+':'+encodeURIComponent(pw)+'@127.0.0.1:'+port+'/'+database;
const scrub=text=>text.replaceAll(password,'[test credential]').replaceAll(identity.databasePassword,'[local credential]');
async function run(args,env){const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>process.stdout.write(scrub(String(x))));child.stderr.on('data',x=>process.stderr.write(scrub(String(x))));return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);roleCreated=true;
 const ownerUrl=url('postgres',identity.databasePassword,name);const runtimeUrl=url(role,password,name);
 const result=await run([path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--config',path.join(root,'packages/db/prisma.config.ts')],{RAKAZO_PROJECT_LOCAL:'1',DATABASE_URL:ownerUrl,DATABASE_MIGRATION_URL:ownerUrl});if(result!==0)throw Error('Isolated migration failed');
 const grants=new Client({connectionString:ownerUrl});await grants.connect();try{await grants.query(`GRANT CONNECT ON DATABASE "${name}" TO "${role}"; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);}finally{await grants.end();}
 const args=[path.join(root,'node_modules/vitest/vitest.mjs'),'run','--maxWorkers','1','--no-file-parallelism',
 'packages/adapters/src/local-memory-review.postgres.test.ts'];
 process.exitCode=await run(args,{RAKAZO_PROJECT_LOCAL:'1',TEST_DATABASE_URL:runtimeUrl,ENCRYPTION_KEY:identity.encryptionKey});
 if(process.exitCode===0)process.exitCode=await run([path.join(root,'node_modules/vitest/vitest.mjs'),'run','--maxWorkers','1','--no-file-parallelism','packages/memory/src/commit.postgres.test.ts'],{RAKAZO_PROJECT_LOCAL:'1',TEST_DATABASE_URL:ownerUrl,DATABASE_URL:ownerUrl,VERIFY_DATABASE:"1",ENCRYPTION_KEY:identity.encryptionKey});
 console.log(JSON.stringify({isolatedDatabase:true,appRoleWithoutBypass:true,testExitCode:process.exitCode}));
}finally{
 if(created)await admin.query(`DROP DATABASE "${name}"`);
 if(roleCreated)await admin.query(`DROP ROLE "${role}"`);await admin.end();if(embedded)await embedded.stop();
}
