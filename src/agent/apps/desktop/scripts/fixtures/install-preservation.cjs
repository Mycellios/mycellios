const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
const [mode,profile,resources,result]=process.argv.slice(2);
app.setPath('userData',profile);app.disableHardwareAcceleration();
const timeout=setTimeout(()=>app.exit(1),45000);
app.whenReady().then(async()=>{
  const proof={mode};
  if(mode==='archives'){
    const destination=path.join(profile,'development-copy');
    await fs.cp(path.join(resources,'development-source.asar','source'),destination,{recursive:true});
    const source=JSON.parse(await fs.readFile(path.join(destination,'src/agent/package.json'),'utf8'));
    if(source.name!=='mycellios-agent')throw Error('Development source copy differs');
    proof.developmentSource=true;
    proof.npm=await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(resources,'development-tools/npm.asar/bin/npm-cli.js'),'--version'],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'',NO_UPDATE_NOTIFIER:'1'}},(error,stdout)=>error?reject(error):resolve(/^\d+\.\d+\.\d+$/.test(stdout.trim()))));
    if(!proof.npm)throw Error('Archived npm did not start');
  }else{
    await session.defaultSession.protocol.handle('https',()=>new Response('<html><body>Isolated fixture</body></html>',{headers:{'Content-Type':'text/html'}}));
    const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
    await window.loadURL('https://www.mycellios.com/agent/__installer_fixture');
    if(mode==='seed')await window.webContents.executeJavaScript(`for(let i=0;i<5;i++)localStorage.setItem('rakazo.composerDraft.fixture-'+i,JSON.stringify({text:'Borrador de prueba '+i}));`);
    const preserved=await window.webContents.executeJavaScript(`Array.from({length:5},(_,i)=>localStorage.getItem('rakazo.composerDraft.fixture-'+i)===JSON.stringify({text:'Borrador de prueba '+i})).every(Boolean)`);
    if(!preserved)throw Error('Installer changed fixture drafts');
    proof.drafts=5;window.destroy();
  }
  proof.passed=true;await fs.writeFile(result,JSON.stringify(proof));clearTimeout(timeout);app.quit();
}).catch(async error=>{await fs.writeFile(result,JSON.stringify({passed:false,error:error.message}));app.exit(1)});
