import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar, Button, Input, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";

/** In-window companion. The existing OS dock takes precedence when enabled. */
export function MicoEdgeDock({ bots, spaceId, scope, activeId, onOpen, onCreate }: {
  bots: Bot[]; spaceId: string; scope: string; activeId?: string;
  onOpen: (id: string) => void; onCreate: () => void;
}) {
  const { t } = useLingui();
  const storageKey = `mycellios.mico-edge-dock:${scope}`;
  const available = bots.filter(bot => !bot.archivedAt && bot.spaceId === spaceId);
  const bridge = desktopBridge()?.companions;
  const [nativeDock, setNativeDock] = useState(Boolean(bridge));
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [prefs, setPrefs] = useState<{ ids: string[]; y: number }>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object" && "ids" in saved && Array.isArray(saved.ids) &&
          saved.ids.length <= 8 && saved.ids.every(id => typeof id === "string") &&
          "y" in saved && typeof saved.y === "number" && Number.isFinite(saved.y)) {
        return { ids: [...new Set(saved.ids)], y: Math.max(10, Math.min(90, saved.y)) };
      }
    } catch { /* An absent device preference uses the active Mico. */ }
    return { ids: activeId && available.some(bot => bot.id === activeId) ? [activeId] : available.slice(0, 1).map(bot => bot.id), y: 50 };
  });
  const [height, setHeight] = useState(window.innerHeight);
  const dock = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; center: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => { void bridge?.state().then(value => { if (live) setNativeDock(value.dock.shown); }).catch(() => { if (live) setNativeDock(false); }); };
    refresh();
    window.addEventListener("mycellios:companion-preferences", refresh);
    return () => { live = false; window.removeEventListener("mycellios:companion-preferences", refresh); };
  }, [bridge]);
  function save(next: typeof prefs) {
    setPrefs(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setError(""); }
    catch { setError(t`Could not save this preference.`); }
  }
  const pinned = prefs.ids.flatMap(id => { const bot = available.find(bot => bot.id === id); return bot ? [bot] : []; });
  const bodyHeight = Math.max(92, Math.min(height - 180, pinned.length * 46 + 82));
  if (nativeDock) return null;
  return <aside ref={dock} className="rk-mico-edge-dock" aria-label={t`Mico dock`} data-dragging={dragging || undefined}
    style={{ height: bodyHeight, top: Math.max(bodyHeight / 2 + 56, Math.min(height - bodyHeight / 2 - 56, height * prefs.y / 100)) }}>
    <svg className="rk-mico-edge-shape" viewBox={`0 0 60 ${bodyHeight}`} preserveAspectRatio="none" aria-hidden>
      <path d={`M60 0 C60 15 57 19 42 20 C19 20 8 29 8 48 L8 ${bodyHeight - 48} C8 ${bodyHeight - 29} 19 ${bodyHeight - 20} 42 ${bodyHeight - 20} C57 ${bodyHeight - 19} 60 ${bodyHeight - 15} 60 ${bodyHeight} Z`} />
    </svg>
    <div className="rk-mico-edge-seats">
      <div className="rk-mico-edge-list">
        {pinned.map(bot => <button key={bot.id} type="button" className="rk-mico-edge-seat"
          aria-label={bot.name} aria-current={bot.id === activeId ? "page" : undefined}
          title={`${bot.name}${bot.unread ? ` · ${t`Unread`}` : ""}`} onClick={() => onOpen(bot.id)}
          onContextMenu={event => { event.preventDefault(); setPicker(true); }}>
          <BotAvatar identity={bot.id} color={bot.color} size={34} status={bot.status} />
          {bot.unread ? <span className="rk-mico-edge-unread" aria-hidden /> : null}
        </button>)}
      </div>
      <Popover open={picker} onOpenChange={next => { setPicker(next); if (!next) setQuery(""); }}>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="rk-mico-edge-add" aria-label={t`Add Mico to dock`} title={t`Add Mico to dock`} />}>
          <Plus size={17} strokeWidth={1.6} aria-hidden />
        </PopoverTrigger>
        {picker ? <PopoverContent side="left" align="center" sideOffset={12} className="w-64 gap-1 p-1.5 [&_button]:font-normal">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t`Micos on this dock`}</p>
          {available.length > 5 ? <Input aria-label={t`Search Micos`} placeholder={t`Search Micos…`} value={query} onChange={e => setQuery(e.target.value)} /> : null}
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {available.filter(bot => bot.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(bot => {
              const selected = prefs.ids.includes(bot.id);
              return <Button key={bot.id} variant="ghost" className="justify-start gap-2" aria-pressed={selected}
                disabled={!selected && pinned.length >= 8} onClick={() => save({ ...prefs, ids: selected ? prefs.ids.filter(id => id !== bot.id) : [...pinned.map(item => item.id), bot.id] })}>
                <BotAvatar identity={bot.id} color={bot.color} size={24} /><span className="min-w-0 flex-1 truncate">{bot.name}</span>
                {selected ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
              </Button>;
            })}
          </div>
          <div className="my-1 border-t border-border" />
          <Button variant="ghost" className="justify-start gap-2" onClick={() => { setPicker(false); onCreate(); }}><Plus size={15} aria-hidden />{t`New Mico`}</Button>
          {error ? <p role="status" className="px-2 py-1 text-xs text-destructive">{error}</p> : null}
        </PopoverContent> : null}
      </Popover>
    </div>
    <button type="button" className="rk-mico-edge-handle" aria-label={t`Move Mico dock`} title={t`Move Mico dock`}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); const rect = dock.current!.getBoundingClientRect(); drag.current = { y: event.clientY, center: rect.y + rect.height / 2 }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const center = Math.max(bodyHeight / 2 + 56, Math.min(height - bodyHeight / 2 - 56, drag.current.center + event.clientY - drag.current.y)); setPrefs(current => ({ ...current, y: center / height * 100 })); }}
      onPointerUp={event => { if (!drag.current) return; drag.current = null; setDragging(false); save(prefs); event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); save({ ...prefs, y: Math.max(10, Math.min(90, prefs.y + (event.key === "ArrowUp" ? -3 : 3))) }); }}>
      <svg viewBox="0 0 42 22" aria-hidden><path d="M8 5 C23 5 32 12 34 20" /></svg>
    </button>
  </aside>;
}
