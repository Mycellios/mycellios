import { useLingui } from "@lingui/react/macro";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@mycellios/ui-web";
import { Check, CheckCheck, ListFilter } from "lucide-react";
import { useState } from "react";
import { setGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";
import type { SidebarChatOrder } from "../../lib/sidebar-chat-order";
import {
  EMPTY_SIDEBAR_FILTER, type SidebarFilter, sidebarFilterActive, toggleSidebarFilter, useSidebarFilter, writeSidebarFilter,
} from "../../lib/sidebar-filter";

function Choice({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return <Button size="sm" variant="ghost" aria-pressed={selected}
    className="h-8 w-full justify-start gap-2 px-2 font-normal" onClick={onClick}>
    <Check size={14} aria-hidden="true" className={selected ? "opacity-100" : "opacity-0"} />
    <span className="min-w-0 truncate" dir="auto">{label}</span>
  </Button>;
}

/**
 * The sidebar's view menu: filters (Micos, groups, unread, working, folders), how chats are
 * sorted, and Mark all as read. Filters and sort are saved on this device and never change
 * folders, pins or the manual order.
 */
export function SidebarViewMenu({ folders, onMarkAllRead, hasUnread, mobile = false }: {
  folders: readonly { id: string; path: string }[];
  onMarkAllRead: () => Promise<void> | void;
  hasUnread: boolean;
  mobile?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const filter = useSidebarFilter();
  const { sidebarChatOrder } = useGeneralPreferences();
  const active = sidebarFilterActive(filter);
  const toggle = <K extends keyof SidebarFilter>(key: K, value: SidebarFilter[K][number]) =>
    writeSidebarFilter(toggleSidebarFilter(filter, key, value));
  const orders: Array<{ value: SidebarChatOrder; label: string }> = [
    { value: "manual", label: t`Manual` },
    { value: "recent", label: t`Recent activity` },
    { value: "unread-group", label: t`Group unread` },
    { value: "unread-first", label: t`Unread first` },
  ];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" />} data-testid="sidebar-view-menu"
      aria-label={active ? t`Filter and sort chats, filters on` : t`Filter and sort chats`}
      className={`app-no-drag relative shrink-0 text-muted-foreground ${mobile ? "size-10" : "size-7"}`}>
      <ListFilter size={mobile ? 18 : 15} strokeWidth={1.8} aria-hidden="true" />
      {active ? <span aria-hidden="true" data-sidebar-filter-on className="absolute end-1 top-1 size-1.5 rounded-full bg-primary" /> : null}
    </PopoverTrigger>
    <PopoverContent align="end" aria-label={t`Filter and sort chats`}
      className="max-h-[min(70dvh,var(--available-height))] w-64 gap-0.5 overflow-y-auto p-1.5">
      <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">{t`Show`}</p>
      <Choice selected={!active} label={t`All chats`} onClick={() => writeSidebarFilter(EMPTY_SIDEBAR_FILTER)} />
      <Choice selected={filter.kinds.includes("bot")} label={t`Micos`} onClick={() => toggle("kinds", "bot")} />
      <Choice selected={filter.kinds.includes("group")} label={t`Groups`} onClick={() => toggle("kinds", "group")} />
      <Choice selected={filter.states.includes("unread")} label={t`Unread`} onClick={() => toggle("states", "unread")} />
      <Choice selected={filter.states.includes("working")} label={t`Working`} onClick={() => toggle("states", "working")} />
      {folders.length ? <>
        <p className="px-2 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">{t`Folders`}</p>
        {folders.map(folder => <Choice key={folder.id} selected={filter.folders.includes(folder.id)} label={folder.path}
          onClick={() => toggle("folders", folder.id)} />)}
      </> : null}
      {active ? <Button size="sm" variant="ghost" className="h-8 justify-start px-2 font-normal text-muted-foreground"
        onClick={() => writeSidebarFilter(EMPTY_SIDEBAR_FILTER)}>{t`Clear filters`}</Button> : null}
      <div className="my-1 border-t border-border" />
      <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">{t`Sort chats`}</p>
      {orders.map(order => <Choice key={order.value} selected={sidebarChatOrder === order.value} label={order.label}
        onClick={() => { try { setGeneralPreferences({ sidebarChatOrder: order.value }); } catch { /* Settings explain storage failures. */ } }} />)}
      <div className="my-1 border-t border-border" />
      <Button size="sm" variant="ghost" className="h-8 justify-start gap-2 px-2 font-normal"
        disabled={!hasUnread || busy}
        onClick={() => {
          setBusy(true);
          void Promise.resolve(onMarkAllRead()).finally(() => { setBusy(false); setOpen(false); });
        }}>
        <CheckCheck size={14} aria-hidden="true" />{t`Mark all as read`}
      </Button>
    </PopoverContent>
  </Popover>;
}
