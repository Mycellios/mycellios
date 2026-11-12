import { useLingui } from "@lingui/react/macro";
import { DEFAULT_DESKTOP_COMPANIONS, type Bot, type DesktopCompanionPreferences } from "@rakazo/contracts";
import { BotAvatar, Button, Input, Label, OptionSelect, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState, useRef } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";
import { appPath } from "../../lib/app-path";
import "./island-settings.css";

export function DesktopCompanionsPanel({ kind, bots, onBusyChange, accountId, spaces = [], currentSpaceId }: { kind: "dock" | "island"; bots: Bot[]; onBusyChange?: (busy: boolean) => void; accountId?: string; spaces?: { id: string; name: string }[]; currentSpaceId?: string | null }) {
  const { t } = useLingui(); const id = useId(); const bridge = desktopBridge()?.companions;
  const previewOnly = !bridge;
  const [value, setValue] = useState<DesktopCompanionPreferences | undefined>(() => previewOnly ? structuredClone(DEFAULT_DESKTOP_COMPANIONS) : undefined);
  const lock = useRef(false);
  const [dockSizeDraft, setDockSizeDraft] = useState<number>();
  useEffect(() => setDockSizeDraft(undefined), [value?.dock.size]);
  const [scaleDraft, setScaleDraft] = useState<Partial<Record<"width" | "height", number>>>({});
  useEffect(() => setScaleDraft({}), [value?.island.width, value?.island.height]);
  const [displays, setDisplays] = useState<{ id: number; label: string }[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load() {
    if (!bridge) return;
    setError("");
    try { const [preferences, screens] = await Promise.all([bridge.state(), bridge.displays()]); setValue(preferences); setDisplays(screens); }
    catch { setError(t`Could not load application settings.`); }
  }
  useEffect(() => { let live = true;
    if (bridge) void Promise.all([bridge.state(), bridge.displays()]).then(([preferences, screens]) => {
      if (live) { setValue(preferences); setDisplays(screens); }
    }).catch(() => { if (live) setError(t`Could not load application settings.`); });
    return () => { live = false; };
  }, [bridge]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function save(next: DesktopCompanionPreferences) {
    if (lock.current) return false;
    if (previewOnly) { setValue(next); return true; }
    if (!bridge) return false;
    lock.current = true; setBusy(true); setError("");
    try { setValue(await bridge.save(next)); window.dispatchEvent(new Event("mycellios:companion-preferences")); return true; } catch { setError(t`Could not save this preference.`); return false; } finally { lock.current = false; setBusy(false); }
  }
  if (!bridge && !previewOnly) return <p className="text-sm text-muted-foreground">{t`Restart the updated desktop app to manage computer settings here.`}</p>;
  const shown = value?.[kind].shown === true;
  const toggle = (key: string, title: string, description: string, checked: boolean, change: (v: boolean) => void, disabled = false) =>
    <SettingsRow label={<Label htmlFor={`${id}-${key}`}>{title}</Label>} description={description}
      control={<Switch id={`${id}-${key}`} checked={checked} disabled={busy || disabled} onCheckedChange={change} />} />;
  return <div className="rk-general-settings space-y-6">
    {!value && !error && <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!value && <Button variant="outline" onClick={() => void load()}>{t`Retry`}</Button>}</div>}
    {value && <>
      {previewOnly && <p role="status" className="text-sm text-muted-foreground">{kind === "island" ? t`Interactive preview. Mycellios Desktop places the island above your other applications. Changes here are not saved.` : t`Interactive preview. Use Mycellios Desktop for the dock above other applications. Changes here are not saved.`}</p>}
      <SettingsGroup title={t`Behavior`}>
        {toggle("shown", kind === "dock" ? t`Show the Mico dock` : t`Show status at the top of the screen`,
          kind === "dock" ? t`Open a Mico from any application.` : t`Follow your Micos from a small window at the top of the screen.`, shown,
          checked => void save({ ...value, [kind]: { ...value[kind], shown: checked } }))}
        {kind === "island" ? <>
          {toggle("idle", t`Show when idle`, t`Keep the island visible when no Mico is working.`, value.island.idle,
            idle => void save({ ...value, island: { ...value.island, idle } }), !shown)}
          {toggle("displays", t`Show on additional displays`, t`Follow activity on every connected screen.`, value.island.additionalDisplays,
            additionalDisplays => void save({ ...value, island: { ...value.island, additionalDisplays } }), !shown)}
        </> : <>
          {value.dock.layer && <SettingsRow label={t`Visibility`} description={t`Keep the dock above other apps, or only while Mycellios is active.`} control={<OptionSelect aria-label={t`Visibility`} disabled={busy || !shown} value={value.dock.layer}
            options={[{ value: "always", label: t`Above other apps` }, { value: "app", label: t`With Mycellios active` }]}
            onValueChange={layer => void save({ ...value, dock: { ...value.dock, layer: layer as "always" | "app" } })} />} />}
          <SettingsRow label={t`Open chats in`} control={<OptionSelect
            aria-label={t`Open chats in`} disabled={busy || !shown || (!previewOnly && !bridge?.openChat)}
            value={value.dock.chatAction ?? "main"} className="w-44 max-w-full"
            options={[{ value: "main", label: t`Main window` }, { value: "floating", label: t`Floating windows` }]}
            onValueChange={chatAction => void save({ ...value, dock: { ...value.dock, chatAction: chatAction as "main" | "floating" } })}
          />} />
          <SettingsRow label={t`Screen`} description={t`If disconnected, the dock follows the Mycellios window’s screen.`} control={<OptionSelect aria-label={t`Screen`} disabled={busy || !shown} value={String(value.dock.display)}
            className="w-44 max-w-full" options={[...(value.dock.size ? [{ value: "window", label: t`Follow Mycellios window` }] : []), { value: "primary", label: t`Primary screen` }, ...displays.map(display => ({ value: String(display.id), label: display.label }))]}
            onValueChange={display => void save({ ...value, dock: { ...value.dock, display: display === "primary" || display === "window" ? display : Number(display) } })} />} />
          <SettingsRow label={t`Screen edge`} description={t`Drag the dock handle to move it along this edge.`} control={<OptionSelect aria-label={t`Screen edge`} disabled={busy || !shown} value={value.dock.edge} className="w-44 max-w-full"
            options={[{ value: "left", label: t`Left` }, { value: "right", label: t`Right` }, { value: "bottom", label: t`Bottom` }]}
            onValueChange={edge => void save({ ...value, dock: { ...value.dock, edge: edge as "left" | "right" | "bottom" } })} />} />
          {typeof value.dock.size === "number" && <IslandScale label={t`Dock size`} value={value.dock.size} disabled={busy || !shown} onPreview={setDockSizeDraft} onCommit={size => save({ ...value, dock: { ...value.dock, size } })} />}
          {toggle("hide", t`Hide automatically`, t`Move to the edge until you hover over the dock.`, value.dock.autoHide,
            autoHide => void save({ ...value, dock: { ...value.dock, autoHide } }), !shown)}
          {toggle("strip", t`Show edge strip`, t`Keep a small handle visible when the dock is hidden.`, value.dock.edgeStrip,
            edgeStrip => void save({ ...value, dock: { ...value.dock, edgeStrip } }), !shown || !value.dock.autoHide)}
          {toggle("results", t`Show completed work`, t`Show new results briefly beside the dock, then return to the compact view.`, value.dock.results,
            results => void save({ ...value, dock: { ...value.dock, results } }), !shown || value.dock.edge === "bottom")}
        </>}
      </SettingsGroup>
      {kind === "dock" && <DockPreview bots={bots.filter(bot => !bot.archivedAt && value.dock.agents[bot.id] !== false).slice(0, 4)} edge={value.dock.edge} size={dockSizeDraft ?? value.dock.size ?? 100} />}
      {kind === "island" ? <>
        {value.island.scopes && accountId && <SettingsGroup title={t`Spaces`}>
          <p className="px-4 py-3 text-xs text-muted-foreground">{t`Choose where the island appears. It only shows activity from the selected space.`}</p>
          {(spaces.length ? spaces : [{ id: currentSpaceId ?? "", name: "Mycellios" }]).map(space => {
            const scope = JSON.stringify([accountId, space.id || null]);
            return <SettingsRow key={scope} label={<span className="flex items-center gap-3"><img src={appPath("/mycellios/app-icon-v2-192.png")} alt="" className="size-7 rounded-lg" />{space.name}</span>}
              control={<Switch aria-label={`${t`Show island`}: ${space.name}`} disabled={busy} checked={value.island.scopes[scope] ?? value.island.futureScopes}
                onCheckedChange={checked => void save({ ...value, island: { ...value.island, scopes: { ...value.island.scopes, [scope]: checked } } })} />} />;
          })}
          {toggle("future", t`Show spaces added later`, t`New spaces follow this preference until you choose otherwise.`, value.island.futureScopes, checked => {
            const scopes = { ...value.island.scopes };
            for (const space of spaces.length ? spaces : [{ id: currentSpaceId ?? "" }]) { const key = JSON.stringify([accountId, space.id || null]); scopes[key] ??= value.island.futureScopes; }
            void save({ ...value, island: { ...value.island, scopes, futureScopes: checked } });
          })}
        </SettingsGroup>}
        <SettingsGroup title={t`Size`}>
          <div className="island-previews" aria-label={t`Island size preview`}>
            {(["built-in", "external"] as const).map(screen => <figure key={screen}>
              <div className={`island-preview-screen ${screen}`}><div className="island-preview-pill" style={{ width: `${Math.round(142 * (scaleDraft.width ?? value.island.width) / 100)}px`, height: `${Math.round(28 * (scaleDraft.height ?? value.island.height) / 100)}px` }}>
                <img src={appPath("/mycellios/app-icon-v2-192.png")} alt="Mycellios" /><span aria-hidden>👋</span>
              </div></div><figcaption>{screen === "built-in" ? t`Built-in display` : t`External display`}</figcaption>
            </figure>)}
          </div>
          {(["width", "height"] as const).map(dimension => <IslandScale key={dimension} label={dimension === "width" ? t`Width` : t`Height`} value={value.island[dimension]} disabled={busy}
            onPreview={percent => setScaleDraft(previous => ({ ...previous, [dimension]: percent }))} onCommit={percent => save({ ...value, island: { ...value.island, [dimension]: percent } })} />)}
          <SettingsRow label={t`Default size`} control={<Button variant="outline" size="sm" disabled={busy || value.island.width === 100 && value.island.height === 100}
            onClick={() => void save({ ...value, island: { ...value.island, width: 100, height: 100 } })}>{t`Reset`}</Button>} />
        </SettingsGroup>
      </> : <SettingsGroup title={t`Micos on this dock`}>
        {bots.filter(bot => !bot.archivedAt).map(bot => <SettingsRow key={bot.id}
          label={<Label htmlFor={`${id}-${bot.id}`} className="flex items-center gap-3"><BotAvatar color={bot.color} identity={bot.id} size={28} />{bot.name}</Label>}
          control={<Switch id={`${id}-${bot.id}`} disabled={busy || !shown} checked={value.dock.agents[bot.id] !== false}
            onCheckedChange={checked => void save({ ...value, dock: { ...value.dock, agents: { ...value.dock.agents, [bot.id]: checked } } })} />} />)}
        {!bots.length && <p className="p-4 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>}
      </SettingsGroup>}
    </>}
  </div>;
}

function IslandScale({ label, value, disabled, onCommit, onPreview }: { label: string; value: number; disabled: boolean; onPreview: (value: number) => void; onCommit: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value); const pending = useRef(false); const id = useId();
  useEffect(() => setDraft(value), [value]);
  async function commit() { if (pending.current || disabled || draft === value) return; pending.current = true;
    try { if (!await onCommit(draft)) { setDraft(value); onPreview(value); } } finally { pending.current = false; } }
  return <div className="island-scale"><div><Label htmlFor={id}>{label}</Label><output htmlFor={id}>{draft}%</output></div>
    <Input id={id} aria-label={label} type="range" min={75} max={150} step={1} value={draft} disabled={disabled}
      onChange={event => { const next = Number(event.target.value); setDraft(next); onPreview(next); }} onPointerUp={() => void commit()} onKeyUp={() => void commit()} onBlur={() => void commit()} />
  </div>;
}

function DockPreview({ bots, edge, size }: { bots: Bot[]; edge: "left" | "right" | "bottom"; size: number }) {
  const { t } = useLingui();
  return <div className="mico-dock-preview" aria-label={t`Dock preview`}><span>{t`Mycellios Desktop`}</span>
    <div className={`mico-dock-preview-body ${edge}`} style={{ scale: String(size / 100) }}>
      {bots.map(bot => <span key={bot.id} title={bot.name}><BotAvatar identity={bot.id} color={bot.color} size={28} /></span>)}
      {!bots.length && <span className="text-xs">{t`Choose Micos below`}</span>}
      <span aria-hidden className="mico-dock-preview-grip"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">{[4, 8, 12].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}</svg></span>
    </div></div>;
}
