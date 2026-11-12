import { useLingui } from "@lingui/react/macro";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { AudioLines, Ellipsis, FolderOpen, Monitor, PanelRightOpen, Settings, X } from "lucide-react";

import type { ReactNode, Ref } from "react";
import { useState } from "react";
import { desktopDragClass } from "../../lib/desktop";

export type ChatToolsActions = {
  onBrowser: () => void;
  onFiles: () => void;
  onSettings: () => void;
  onVoice?: () => void;
};

export function ChatHeaderTools({ open, onToggle, triggerRef }: {
  open: boolean;
  onToggle: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useLingui();
  return <Button ref={triggerRef} variant="ghost" size="icon-sm"
    className="app-no-drag size-8 shrink-0 rounded-lg text-muted-foreground"
    aria-label={t`Chat tools`} aria-expanded={open} aria-controls="chat-tools-sidebar"
    onClick={onToggle}>
    <PanelRightOpen size={17} strokeWidth={1.75} aria-hidden />
  </Button>;
}

export function ChatToolsMenu(props: ChatToolsActions) {
  const { t } = useLingui();
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={t`Chat tools`} className="app-no-drag rk-chat-action inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring min-[1100px]:hidden"><PanelRightOpen size={18} strokeWidth={1.75} aria-hidden /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={props.onBrowser}><Monitor size={15} />{t`Open browser`}</DropdownMenuItem>
      <DropdownMenuItem onClick={props.onFiles}><FolderOpen size={15} />{t`Open library`}</DropdownMenuItem>
      <DropdownMenuItem onClick={props.onSettings}><Settings size={15} />{t`Agent settings`}</DropdownMenuItem>
      {props.onVoice ? <DropdownMenuItem onClick={props.onVoice}><AudioLines size={15} />{t`Open voice`}</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function MobileChatActions({ children, label, onDismiss }: {
  children: (close: () => void) => ReactNode;
  label?: string;
  onDismiss?: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) onDismiss?.(); }}>
      <PopoverTrigger
        render={<Button variant="floating" size="icon-lg" className="size-12 shrink-0 rounded-full" />}
        aria-label={label ?? t`Chat tools`}
      >
        <Ellipsis className="size-6" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(70dvh,var(--available-height))] w-72 max-w-[calc(100vw-24px)] gap-0.5 overflow-y-auto p-1.5 [&_[data-mobile-chat-action]]:h-12 [&_[data-mobile-chat-action]]:w-full [&_[data-mobile-chat-action]]:max-w-none [&_[data-mobile-chat-action]]:justify-start [&_[data-mobile-chat-action]]:gap-3 [&_[data-mobile-chat-action]]:rounded-md [&_[data-mobile-chat-action]]:px-3 [&_[data-mobile-chat-action]]:text-sm [&_[data-mobile-chat-action]>svg]:size-5"
      >
        {children(() => { setOpen(false); onDismiss?.(); })}
      </PopoverContent>
    </Popover>
  );
}

export function MobileChatToolLinks({ onFiles, onSettings, onVoice, close }: Omit<ChatToolsActions, "onBrowser"> & { close: () => void }) {
  const { t } = useLingui();
  const links = [
    { label: t`Open library`, icon: FolderOpen, action: onFiles },
    { label: t`Agent settings`, icon: Settings, action: onSettings },
    ...(onVoice ? [{ label: t`Open voice`, icon: AudioLines, action: onVoice }] : []),
  ];
  return (
    <div className="mt-1 border-t border-border pt-1">
      {links.map(({ label, icon: Icon, action }) => (
        <Button key={label} variant="ghost" data-mobile-chat-action onClick={() => { close(); action(); }}>
          <Icon aria-hidden />{label}
        </Button>
      ))}
    </div>
  );
}

export function ChatToolsPanel({ onBrowser, onFiles, onSettings, onVoice, onClose, children }: ChatToolsActions & {
  onClose: () => void;
  children?: (close: () => void) => ReactNode;
}) {
  const { t } = useLingui();
  const actions = [
    { label: t`Open browser`, icon: Monitor, onClick: onBrowser },
    { label: t`Open library`, icon: FolderOpen, onClick: onFiles },
    { label: t`Agent settings`, icon: Settings, onClick: onSettings },
    ...(onVoice ? [{ label: t`Open voice`, icon: AudioLines, onClick: onVoice }] : []),
  ];
  return (
    <section id="chat-tools-sidebar" data-testid="chat-tools-panel" className="flex h-full min-h-0 w-full flex-col" aria-label={t`Chat tools`}>
      <div className={`${desktopDragClass()} flex h-[51px] shrink-0 items-center justify-end px-2`}>
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t`Close tools`} onClick={onClose}><X size={15} /></Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-6 pb-[51px]">
        {actions.map(({ label, icon: Icon, onClick }) => <Button key={label} variant="ghost" className="h-9 justify-start gap-3 rounded-md bg-muted/50 text-sm font-normal" onClick={onClick}><Icon size={15} strokeWidth={1.6} className="text-muted-foreground" />{label}</Button>)}
        {children ? <div className="mt-3 space-y-1.5 border-t border-border pt-3 [&_[data-mobile-chat-action]]:h-9 [&_[data-mobile-chat-action]]:w-full [&_[data-mobile-chat-action]]:max-w-none [&_[data-mobile-chat-action]]:justify-start [&_[data-mobile-chat-action]]:gap-3 [&_[data-mobile-chat-action]]:rounded-md [&_[data-mobile-chat-action]]:px-3 [&_[data-mobile-chat-action]]:text-sm [&_[data-mobile-chat-action]]:font-normal">{children(onClose)}</div> : null}
      </div>
    </section>
  );
}
