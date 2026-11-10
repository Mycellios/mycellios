import { useLingui } from "@lingui/react/macro";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@rakazo/ui-web";
import { AudioLines, Ellipsis, FolderOpen, Globe, Monitor, Settings, X } from "lucide-react";
import type { ReactNode } from "react";
export function WorkAreaHeader({active,onBrowser,onComputer,onFiles,onSettings,onComputerSettings,onVoice,onClose,maintenance}: {
 active:"browser"|"computer";onBrowser:()=>void;onComputer?:()=>void;onFiles:()=>void;onSettings:()=>void;onComputerSettings?:()=>void;onVoice?:()=>void;onClose:()=>void;maintenance?:ReactNode;
}) {
 const {t}=useLingui();
 function changeView(view:"browser"|"computer", action:()=>void, keyboard:boolean) {
   action();
   if (keyboard && typeof requestAnimationFrame === "function") requestAnimationFrame(()=>{
     document.querySelector<HTMLButtonElement>(`[data-testid="work-area-header"] [data-work-view="${view}"]`)?.focus();
   });
 }
 return <header data-testid="work-area-header" className="sticky top-0 z-10 flex h-[51px] shrink-0 items-center gap-1 border-b border-border bg-background px-3">
   <nav aria-label={t`Browser and computer`} className="mr-auto flex min-w-0 flex-1 items-center gap-1 rounded-lg bg-muted p-0.5">
    <Button variant="ghost" size="sm" data-work-view="browser" aria-pressed={active==="browser"} onClick={event=>changeView("browser",onBrowser,event.detail===0)} className={`min-w-0 flex-1 max-md:h-11 max-md:px-2 ${active==="browser"?"bg-background text-foreground":"text-muted-foreground"}`}><Globe size={15} className="max-md:hidden" aria-hidden/><span className="truncate">{t`Browser`}</span></Button>
    {onComputer && <Button variant="ghost" size="sm" data-work-view="computer" aria-pressed={active==="computer"} onClick={event=>changeView("computer",onComputer,event.detail===0)} className={`min-w-0 flex-1 max-md:h-11 max-md:px-2 ${active==="computer"?"bg-background text-foreground":"text-muted-foreground"}`}><Monitor size={15} className="max-md:hidden" aria-hidden/><span className="truncate">{t`Computer`}</span></Button>}
   </nav>
   {maintenance}
   <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="max-md:size-11" aria-label={t`More tools`}/>}><Ellipsis size={17}/></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
     <DropdownMenuItem onClick={onFiles}><FolderOpen size={15}/>{t`Open library`}</DropdownMenuItem>
     <DropdownMenuItem onClick={onSettings}><Settings size={15}/>{t`Agent settings`}</DropdownMenuItem>
     {onComputerSettings && <DropdownMenuItem onClick={onComputerSettings}><Monitor size={15}/>{t`Computer settings`}</DropdownMenuItem>}
     {onVoice && <DropdownMenuItem onClick={onVoice}><AudioLines size={15}/>{t`Open voice`}</DropdownMenuItem>}
    </DropdownMenuContent>
   </DropdownMenu>
   <Button variant="ghost" size="icon-sm" className="max-md:size-11" aria-label={t`Close workspace`} onClick={onClose}><X size={16}/></Button>
 </header>;
}
