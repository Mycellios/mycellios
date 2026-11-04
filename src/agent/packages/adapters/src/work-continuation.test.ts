import {expect,it,vi} from 'vitest';
import type {AgentRunRequest} from '@rakazo/adapter-kit';
import {WorkContinuation,withWorkContinuation,WORK_PLAN_TOOL,toolFailed} from './work-continuation.js';
const plan=(status:string)=>({steps:[{id:'verify',title:'Verify the change',status}]});
it('continues pending work, changes approach once on no progress, then reports incomplete',()=>{
 const state=new WorkContinuation();state.update(plan('running'));
 expect(state.next('Partial result')).toContain('Pending steps');
 expect(state.next('Partial result')).toContain('different approach');
 expect(()=>state.next('Partial result')).toThrow('WORK_INCOMPLETE');
});
it('finishes when verified plan steps are done',()=>{
 const state=new WorkContinuation();state.update(plan('running'));state.next('Working');
 state.update(plan('done'));expect(state.next('Verified')).toBeUndefined();
});
it.each(['Voy a comprobar el resultado.','Ahora revisaré el archivo.','Now I will verify it.','¿Continúo?','¿Quieres que continúe?'])( 'continues a promised next step: %s',answer=>{
 const state=new WorkContinuation();expect(state.next(answer)).toContain('unfinished next step');
 expect(state.next(answer)).toBeTruthy();expect(()=>state.next(answer)).toThrow('WORK_INCOMPLETE');
});
it.each(['La traducción es: «Voy a revisar el archivo».','¿Continúo con el despliegue?','The explanation is complete.'])( 'does not reinterpret explanations or approval questions: %s',answer=>{
 expect(new WorkContinuation().next(answer)).toBeUndefined();
});
it.each(['Necesito que introduzcas la contraseña.','¿Qué cuenta debo usar?','Esperando tu aprobación.','Access denied.'])( 'respects user input and access blockers: %s',answer=>{
 const state=new WorkContinuation();state.update(plan('pending'));expect(state.next(answer)).toBeUndefined();
});
it('bounds continuations even when the model keeps changing its plan',()=>{
 const state=new WorkContinuation();for(let i=0;i<8;i++){state.update({steps:[{id:String(i),title:'Step '+i,status:'running'}]});expect(state.next('Working')).toBeTruthy();}
 state.update(plan('pending'));expect(()=>state.next('Working')).toThrow('budget');
});
it('stops after explicit steering and never treats a cancellation as unfinished work',async()=>{
 const state=new WorkContinuation();state.update(plan('pending'));
 const request={instructions:'Scope',tools:[],claimSteering:async()=>[{id:'s',messageId:'m',text:'No sigas'}]} as unknown as AgentRunRequest;
 await withWorkContinuation(request,state).claimSteering!([]);
 expect(state.next('Partial result')).toBeUndefined();
 expect(state.afterWait('command finished')).toBeUndefined();
 const other=new WorkContinuation();other.update(plan('pending'));expect(other.next('Me detengo.')).toBeUndefined();
});
it('replans after a tool failure but never retries the tool itself',()=>{
 const state=new WorkContinuation();state.result({details:{code:1}});expect(state.next('')).toContain('alternative');
 state.result({code:0});expect(state.next('Verified')).toBeUndefined();
 expect(toolFailed({details:{error:'failed'}})).toBe(true);
});
it('requires valid unique steps and skips silent/background work',()=>{
 const state=new WorkContinuation(false);state.update(plan('pending'));expect(state.next('Voy a comprobarlo.')).toBeUndefined();
 expect(()=>state.update({steps:[...plan('pending').steps,...plan('pending').steps]})).toThrow('unique');
 expect(()=>state.update(plan('imaginary'))).toThrow('Invalid');
});
it('changes strategy before executing a fourth identical no-progress action, but permits changing results',async()=>{
 const executeTool=vi.fn(async()=>({code:1}));
 const request={instructions:'Original scope',tools:[{name:'shell',description:'fixture',inputSchema:{type:'object'}}],executeTool} as unknown as AgentRunRequest;
 const wrapped=withWorkContinuation(request,new WorkContinuation());
 for(let i=0;i<3;i++)await wrapped.executeTool!('shell',{command:'missing'},String(i));
 expect(await wrapped.executeTool!('shell',{command:'missing'},'four')).toHaveProperty('error');
 expect(executeTool).toHaveBeenCalledTimes(3);
 await wrapped.executeTool!(WORK_PLAN_TOOL,plan('running'),'plan');expect(executeTool).toHaveBeenCalledTimes(3);
 let n=0;executeTool.mockImplementation(async()=>({code:n++}));
 for(let i=0;i<5;i++)await wrapped.executeTool!('shell',{command:'changing'},'new'+i);
 expect(executeTool).toHaveBeenCalledTimes(8);
});

it('keeps pure chat requests unchanged and accepts an explicit final failure report',()=>{
 const request={instructions:'Original',tools:[]} as unknown as AgentRunRequest;
 expect(withWorkContinuation(request,new WorkContinuation())).toBe(request);
 const state=new WorkContinuation();state.failed();expect(state.next('The requested action failed because the service is unavailable.')).toBeUndefined();
});
