// @vitest-environment jsdom
import {act,StrictMode,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({show:true,call:false,recording:'idle',ack:vi.fn()}));
vi.mock('@lingui/react/macro',()=>({useLingui:()=>({i18n:{locale:'en'}}),Trans:({children}:{children:ReactNode})=>children}));
vi.mock('../lib/client-build',()=>({CLIENT_BUILD:'20261102090000'}));
vi.mock('../lib/call-session',()=>({getSnapshot:()=>mock.call}));
vi.mock('../lib/dictation',()=>({dictation:{get state(){return {status:mock.recording};}}}));
vi.mock('../lib/release-notes',()=>({RELEASE_NOTES:{version:'2026.11.02',date:'2026-11-02'},observeRelease:()=>({previousBuild:'20261101164621',show:mock.show}),acknowledgeRelease:mock.ack,browserStorage:()=>null}));
import {ReleaseNotes} from './ReleaseNotes';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();mock.show=true;mock.call=false;mock.recording='idle';mock.ack.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function Fixture(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Reopen</button><ReleaseNotes open={open} onOpenChange={setOpen}/></>;}
async function mount(){await act(async()=>root.render(<StrictMode><Fixture/></StrictMode>));}
it('shows real notes once after update, acknowledges and allows manual reopening',async()=>{
 await mount();expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
 expect(document.body.textContent).toContain("What's new in Mycellios");
 const close=[...document.querySelectorAll('button')].find(b=>b.textContent==='Got it')!;
 await act(async()=>close.click());expect(mock.ack).toHaveBeenCalledOnce();expect(document.querySelector('[role=dialog]')).toBeNull();
 await act(async()=>vi.advanceTimersByTime(6000));expect(document.querySelector('[role=dialog]')).toBeNull();
 await act(async()=>host.querySelector('button')!.click());expect(document.querySelector('[role=dialog]')).not.toBeNull();
});
it('does not interrupt a first visit',async()=>{mock.show=false;await mount();expect(document.querySelector('[role=dialog]')).toBeNull();});
it.each(['call','recording','dialog'] as const)('waits while another %s is active',async(kind)=>{
 if(kind==='call')mock.call=true;if(kind==='recording')mock.recording='listening';
 const blocker=document.createElement('div');if(kind==='dialog'){blocker.setAttribute('role','dialog');document.body.append(blocker);}
 await mount();expect(document.querySelector('[data-testid=release-notes-dialog]')).toBeNull();
 mock.call=false;mock.recording='idle';blocker.remove();
 await act(async()=>vi.advanceTimersByTime(1500));expect(document.querySelector('[data-testid=release-notes-dialog]')).not.toBeNull();
});
it('does not reopen a manually acknowledged notice when a delayed call ends',async()=>{
 mock.call=true;await mount();await act(async()=>host.querySelector('button')!.click());
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Got it')!.click());
 mock.call=false;await act(async()=>vi.advanceTimersByTime(3000));expect(document.querySelector('[role=dialog]')).toBeNull();
});
