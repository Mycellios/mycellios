import {i18n} from "@lingui/core";
import {I18nProvider} from "@lingui/react";
import {TooltipProvider} from "@rakazo/ui-web";
import {useState} from "react";
import {createRoot} from "react-dom/client";
import {SidebarFooter} from "../../src/components/SidebarFooter";
import {WebUpdates} from "../../src/components/WebUpdates";
import {DesktopUpdatesProvider} from "../../src/components/DesktopUpdates";
import {messages} from "../../src/locales/es/messages.po";
import "../../src/styles.css";
const params=new URL(location.href).searchParams;
if(params.has('notes')&&!sessionStorage.getItem('fixture-notes-seeded')){
 sessionStorage.setItem('fixture-notes-seeded','1');
 localStorage.setItem('mycellios.release-notes.last-build.v1','20261101164621');
 localStorage.removeItem('mycellios.release-notes.acknowledged.v1');
 sessionStorage.setItem('rk:client-update-attempt',JSON.stringify({from:'20261101164621',to:'20261102090000'}));
}
const locale=params.get("locale")==="es"?"es":"en";
i18n.load(locale,locale==="es"?messages:{});i18n.activate(locale);
document.documentElement.dataset.theme=params.get("theme")==="dark"?"dark":"light";
function Fixture(){
 const [menu,setMenu]=useState(false);
 const mini=params.has("mini");
 return <div className="flex h-dvh bg-background text-foreground">
  <aside className={`flex h-full min-h-0 max-w-full shrink-0 flex-col border-e border-border bg-sidebar ${mini?"w-16":"w-[316px]"}`}>
   <div className="px-5 py-5 text-sm font-medium">Mycellios</div>
   <div className="min-h-0 flex-1 overflow-y-auto px-3">
    {!mini&&<><p className="px-2 py-4 text-xs text-muted-foreground">{locale==="es"?"MIS MICOS":"MY MICOS"}</p>
    {["Mico","Mycellios Film Studio","Developer"].map(name=><div key={name} className="mb-2 flex items-center gap-3 rounded-xl px-3 py-3 text-sm"><span className="size-7 rounded-full bg-primary/15"/>{name}</div>)}</>}
   </div>
   <SidebarFooter mini={mini} name="Example User" initials="E" open={menu} onOpenChange={setMenu}
    onIntegrations={()=>{}} onArtifacts={()=>{}} onSettings={()=>{}} onUsage={()=>{}} onLogOut={()=>{}}
    signingOut={false} logOutError={null}/>
  </aside>
 </div>;
}
if(params.has('native'))(window as any).rakazoDesktop={platform:'win32',update:{state:async()=>({phase:'downloading',percent:43.6,currentVersion:'0.0.1',availableVersion:'0.0.2'}),check:async()=>null,install:async()=>null}};
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><DesktopUpdatesProvider><TooltipProvider><Fixture/></TooltipProvider><WebUpdates/></DesktopUpdatesProvider></I18nProvider>);
