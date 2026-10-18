// Harmless LaunchServices experiment. No product installation or administrator access.
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
if (process.platform !== 'darwin') throw Error('mac_only');
const base = await mkdtemp(join(tmpdir(), 'mycellios-document-probe-'));
const nonce = randomBytes(8).toString('hex');
const report = {schema:'mycellios-macos-document-open-probe/1', recipeRevision:process.env.GITHUB_SHA,
  productPayloadChanged:false, administratorUsed:false, productionUsed:false, qualified:false, results:[]};
const asString = s => '"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
function run(file,args) { return execFileSync(file,args,{encoding:'utf8',timeout:20000}); }
try {
  const document = join(base, 'Synthetic space üni\'code.mycellios-enrollment');
  await writeFile(document, 'Harmless synthetic document; not an enrollment bundle.\n', {flag:'wx'});
  for (const kind of ['original-shell', 'prototype-applet']) {
    const app=join(base,kind+'.app'), capture=join(base,kind+'-capture.sh'), output=join(base,kind+'-argv.bin');
    // Capture only the exact arguments delivered by LaunchServices/the proposed handler.
    await writeFile(capture, '#!/bin/sh\nprintf \'%s\\0\' "$@" > '+"'"+output.replaceAll("'","'\\''")+"'"+'\n', {flag:'wx'});
    await chmod(capture,0o700);
    if (kind==='prototype-applet') {
      const source=join(base,'handler.applescript');
      await writeFile(source, 'on open incomingDocuments\nrepeat with incomingDocument in incomingDocuments\ndo shell script '+asString("'"+capture.replaceAll("'","'\\''")+"' ")+' & quoted form of POSIX path of incomingDocument\nend repeat\nquit\nend open\n', {flag:'wx'});
      run('/usr/bin/osacompile',['-o',app,source]);
    } else {
      await mkdir(join(app,'Contents','MacOS'),{recursive:true});
      const launcher=join(app,'Contents','MacOS','launcher.sh');
      // Same $1 forwarding shape as the authenticated original95 Pairing.app.
      await writeFile(launcher, '#!/bin/sh\nexec '+"'"+capture.replaceAll("'","'\\''")+"'"+' "$1"\n', {flag:'wx'});
      await chmod(launcher,0o700);
    }
    const plist=join(app,'Contents','Info.plist');
    if (kind==='original-shell') await writeFile(plist,'<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>launcher.sh</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>',{flag:'wx'});
    for(const key of ['CFBundleIdentifier','CFBundleDocumentTypes']) {
      try { run('/usr/bin/plutil',['-remove',key,plist]); } catch {}
    }
    run('/usr/bin/plutil',['-insert','CFBundleIdentifier','-string','com.mycellios.probe.'+nonce+'.'+kind,plist]);
    run('/usr/bin/plutil',['-insert','CFBundleDocumentTypes','-json',JSON.stringify([{CFBundleTypeName:'Mycellios Enrollment',CFBundleTypeExtensions:['mycellios-enrollment'],CFBundleTypeRole:'Viewer',LSHandlerRank:'Owner'}]),plist]);
    let openError=null;
    try { run('/usr/bin/open',['-a',app,document]); } catch(error) { openError=String(error.message).slice(0,1000); }
    let argv=null;
    for(let n=0;n<100;n++) {
      try { argv=(await readFile(output)).toString('utf8').split('\0');argv.pop();break; }
      catch(error) { if(error.code!=='ENOENT')throw error; }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    report.results.push({kind,openError,argv,documentDeliveredToArgv:argv?.length===1 && argv[0]===document,
      usedOpenArgs:false,scope:kind==='original-shell'?'Original95 shell launch shape; dummy executor only.':'Unpublished AppleScript on-open prototype; dummy executor only.'});
    // Remove only this temporary registered bundle. No product or personal application.
    try { run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',app]); } catch {}
  }
} finally {
  await mkdir('build',{recursive:true});
  await writeFile('build/document-open-probe.json',JSON.stringify(report,null,2)+'\n');
  await rm(base,{recursive:true,force:true});
}
console.log(JSON.stringify(report));
