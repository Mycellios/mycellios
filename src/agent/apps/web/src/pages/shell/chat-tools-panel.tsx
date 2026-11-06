import { useLingui } from "@lingui/react/macro";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@rakazo/ui-web";
import { AudioLines, FolderOpen, Monitor, PanelRightOpen, Settings, X } from "lucide-react";

export type ChatToolsActions = {
  onBrowser: () => void;
  onFiles: () => void;
  onSettings: () => void;
  onVoice?: () => void;
};

export function ChatToolsMenu(props: ChatToolsActions) {
  const { t } = useLingui();
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={t`Chat tools`} className="app-no-drag inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring min-[1100px]:hidden"><PanelRightOpen size={17} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={props.onBrowser}><Monitor size={15} />{t`Open browser`}</DropdownMenuItem>
      <DropdownMenuItem onClick={props.onFiles}><FolderOpen size={15} />{t`Open files`}</DropdownMenuItem>
      <DropdownMenuItem onClick={props.onSettings}><Settings size={15} />{t`Agent settings`}</DropdownMenuItem>
      {props.onVoice ? <DropdownMenuItem onClick={props.onVoice}><AudioLines size={15} />{t`Open voice`}</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ChatToolsPanel({ onBrowser, onFiles, onSettings, onVoice, onClose }: ChatToolsActions & {
  onClose: () => void;
}) {
  const { t } = useLingui();
  const actions = [
    { label: t`Open browser`, icon: Monitor, onClick: onBrowser },
    { label: t`Open files`, icon: FolderOpen, onClick: onFiles },
    { label: t`Agent settings`, icon: Settings, onClick: onSettings },
    ...(onVoice ? [{ label: t`Open voice`, icon: AudioLines, onClick: onVoice }] : []),
  ];
  return (
    <aside data-testid="chat-tools-panel" className="rk-chat-tools-panel" aria-label={t`Chat tools`}>
      <div className="app-drag flex h-[51px] shrink-0 items-center justify-end px-2">
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t`Close tools`} onClick={onClose}><X size={15} /></Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-6 pb-[51px]">
        {actions.map(({ label, icon: Icon, onClick }) => <Button key={label} variant="ghost" className="h-9 justify-start gap-3 rounded-md bg-muted/50 text-sm font-normal" onClick={onClick}><Icon size={15} strokeWidth={1.6} className="text-muted-foreground" />{label}</Button>)}
      </div>
    </aside>
  );
}
