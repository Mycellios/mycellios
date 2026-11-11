import { useLingui } from "@lingui/react/macro";
import type { Bot, DesktopCompanionPreferences } from "@rakazo/contracts";
import { BotAvatar, Button, Label, OptionSelect, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";

export function DesktopCompanionsPanel({ kind, bots, onBusyChange }: { kind: "dock" | "island"; bots: Bot[]; onBusyChange?: (busy: boolean) => void }) {
  const { t } = useLingui(); const id = useId(); const bridge = desktopBridge()?.companions;
  const [value, setValue] = useState<DesktopCompanionPreferences>();
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
    if (!bridge || busy) return; setBusy(true); setError("");
    try { setValue(await bridge.save(next)); } catch { setError(t`Could not save this preference.`); } finally { setBusy(false); }
  }
  if (!bridge) return <p className="text-sm text-muted-foreground">{t`Restart the updated desktop app to manage computer settings here.`}</p>;
  const shown = value?.[kind].shown === true;
  const toggle = (key: string, title: string, description: string, checked: boolean, change: (v: boolean) => void, disabled = false) =>
    <SettingsRow label={<Label htmlFor={`${id}-${key}`}>{title}</Label>} description={description}
      control={<Switch id={`${id}-${key}`} checked={checked} disabled={busy || disabled} onCheckedChange={change} />} />;
  return <div className="rk-general-settings space-y-6">
    {!value && !error && <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!value && <Button variant="outline" onClick={() => void load()}>{t`Retry`}</Button>}</div>}
    {value && <>
      <SettingsGroup title={kind === "dock" ? t`Mico dock` : t`Dynamic Island`}>
        {toggle("shown", kind === "dock" ? t`Show the Mico dock` : t`Show Dynamic Island`,
          kind === "dock" ? t`Open a Mico from any application.` : t`Follow your Micos from a small window at the top of the screen.`, shown,
          checked => void save({ ...value, [kind]: { ...value[kind], shown: checked } }))}
        {kind === "island" ? <>
          {toggle("idle", t`Show when idle`, t`Keep the island visible when no Mico is working.`, value.island.idle,
            idle => void save({ ...value, island: { ...value.island, idle } }), !shown)}
          {toggle("displays", t`Show on additional displays`, t`Follow activity on every connected screen.`, value.island.additionalDisplays,
            additionalDisplays => void save({ ...value, island: { ...value.island, additionalDisplays } }), !shown)}
        </> : <>
          <SettingsRow label={t`Open chats in`} control={<OptionSelect
            aria-label={t`Open chats in`} disabled={busy || !shown || !bridge.openChat}
            value={value.dock.chatAction ?? "main"} className="w-44 max-w-full"
            options={[{ value: "main", label: t`Main window` }, { value: "floating", label: t`Floating windows` }]}
            onValueChange={chatAction => void save({ ...value, dock: { ...value.dock, chatAction: chatAction as "main" | "floating" } })}
          />} />
          <SettingsRow label={t`Screen`} control={<OptionSelect aria-label={t`Screen`} disabled={busy || !shown} value={String(value.dock.display)}
            className="w-44 max-w-full" options={[{ value: "primary", label: t`Primary screen` }, ...displays.map(display => ({ value: String(display.id), label: display.label }))]}
            onValueChange={display => void save({ ...value, dock: { ...value.dock, display: display === "primary" ? display : Number(display) } })} />} />
          <SettingsRow label={t`Position`} control={<OptionSelect aria-label={t`Position`} disabled={busy || !shown} value={value.dock.edge} className="w-44 max-w-full"
            options={[{ value: "left", label: t`Left` }, { value: "right", label: t`Right` }, { value: "bottom", label: t`Bottom` }]}
            onValueChange={edge => void save({ ...value, dock: { ...value.dock, edge: edge as "left" | "right" | "bottom" } })} />} />
          {toggle("hide", t`Hide automatically`, t`Move to the edge until you hover over the dock.`, value.dock.autoHide,
            autoHide => void save({ ...value, dock: { ...value.dock, autoHide } }), !shown)}
          {toggle("strip", t`Show edge strip`, t`Keep a small handle visible when the dock is hidden.`, value.dock.edgeStrip,
            edgeStrip => void save({ ...value, dock: { ...value.dock, edgeStrip } }), !shown || !value.dock.autoHide)}
          {toggle("results", t`Show results`, t`Show a short preview beside each Mico.`, value.dock.results,
            results => void save({ ...value, dock: { ...value.dock, results } }), !shown || value.dock.edge === "bottom")}
        </>}
      </SettingsGroup>
      {kind === "island" ? <SettingsGroup title={t`Size`}>
        {(["width", "height"] as const).map(dimension => <SettingsRow key={dimension} label={dimension === "width" ? t`Width` : t`Height`}
          control={<OptionSelect aria-label={dimension === "width" ? t`Width` : t`Height`} disabled={busy || !shown} value={String(value.island[dimension])}
            className="w-44 max-w-full" options={[75, 90, 100, 110, 125, 150].map(percent => ({ value: String(percent), label: `${percent} %` }))}
            onValueChange={percent => void save({ ...value, island: { ...value.island, [dimension]: Number(percent) } })} />} />)}
        <SettingsRow label={t`Default size`} control={<Button variant="outline" size="sm" disabled={busy || !shown}
          onClick={() => void save({ ...value, island: { ...value.island, width: 100, height: 100 } })}>{t`Reset`}</Button>} />
      </SettingsGroup> : <SettingsGroup title={t`Micos on this dock`}>
        {bots.filter(bot => !bot.archivedAt).map(bot => <SettingsRow key={bot.id}
          label={<Label htmlFor={`${id}-${bot.id}`} className="flex items-center gap-3"><BotAvatar color={bot.color} size={28} />{bot.name}</Label>}
          control={<Switch id={`${id}-${bot.id}`} disabled={busy || !shown} checked={value.dock.agents[bot.id] !== false}
            onCheckedChange={checked => void save({ ...value, dock: { ...value.dock, agents: { ...value.dock.agents, [bot.id]: checked } } })} />} />)}
        {!bots.length && <p className="p-4 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>}
      </SettingsGroup>}
    </>}
  </div>;
}
