import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {stageContributionComponent} from '../src/agent/apps/desktop/scripts/contribution-component.mjs';
import {publishRuntimeComponent} from './publish-runtime-components.mjs';

/**
 * Publishes a CI-built Windows node MSI as the immutable `desktop-runtime-<sha256>`
 * component that Desktop pins for enrollment and the one-time runtime update.
 * Desktop adopts it only after a reviewed change to its pinned hash.
 */
const {values}=parseArgs({options:{msi:{type:'string'},revision:{type:'string'}}});
if(!values.msi||!/^[a-f0-9]{40}$/.test(values.revision??''))throw Error('usage: --msi=<file> --revision=<40-hex commit>');
const sha256=execFileSync('sha256sum',[values.msi],{encoding:'utf8'}).split(' ')[0];
const gh=(...args)=>execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],encoding:'utf8'});
const api=async resource=>{const r=await fetch('https://api.github.com/repos/Mycellios/mycellios/'+resource,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'}});if(r.status===404)return null;if(!r.ok)throw Error('Release API unavailable');return r.json();};
const output=await mkdtemp(path.join(tmpdir(),'windows-runtime-'));
try{
 await stageContributionComponent({file:values.msi,sha256,output,extension:'msi'});
 const component=await publishRuntimeComponent({directory:path.join(output,'runtime-component'),extension:'msi',revision:values.revision,gh,api});
 console.log(JSON.stringify(component,null,2));
}finally{await rm(output,{recursive:true,force:true});}
