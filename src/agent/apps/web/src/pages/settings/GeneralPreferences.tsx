import { useLingui } from "@lingui/react/macro";
import type { DesktopBehaviorSettings } from "@rakazo/contracts";
import { Label, OptionSelect, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";
import { CHAT_COLORS, CODE_FONTS, INTERFACE_FONTS, setGeneralPreferences, useGeneralPreferences, type GeneralPreferences } from "../../lib/general-preferences";

function ColorChoice({ label, value, onChange, swatches = false }: { label: string; value: string; onChange: (color: string) => void; swatches?: boolean }) {
  const { t } = useLingui();
  const names = [t`Rose`, t`Peach`, t`Gold`, t`Green`, t`Blue`, t`Purple`, t`Pink`, t`Sand`, t`Grey`, t`White`];
  return swatches ? <div role="group" aria-label={label} className="rk-settings-swatches">
    {["default", ...CHAT_COLORS].map((color, i) => <button key={color} type="button"
      aria-label={i === 0 ? t`Default` : names[i - 1]} aria-pressed={value === color}
      title={i === 0 ? t`Default` : names[i - 1]} onClick={() => onChange(color)}
      style={color === "default" ? undefined : { "--swatch-color": color } as React.CSSProperties}>
      <span className={color === "default" ? "rk-settings-swatch-default" : ""} />
    </button>)}
  </div> : <OptionSelect aria-label={label} value={value} className="w-44 max-w-full"
    options={[{ value: "default", label: t`Default` }, ...CHAT_COLORS.map((color, i) => ({ value: color, label: names[i]! }))]}
    onValueChange={onChange} />;
}

export function AppearanceExtras() {
  const { t } = useLingui();
  const value = useGeneralPreferences();
  const [error, setError] = useState("");
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => { let active = true;
    void desktopBridge()?.settings?.fonts?.().then(list => { if (active) setFonts(list); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [scheme, setScheme] = useState(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  function save(patch: Partial<GeneralPreferences>) {
    try { setGeneralPreferences(patch); setError(""); } catch { setError(t`Could not save this preference.`); }
  }
  const backgroundKey = scheme === "dark" ? "chatBackgroundDark" : "chatBackgroundLight";
  return <>
    <SettingsRow label={t`Logo color`} description={t`Personalize the Mycellios logo on this device.`}
      control={<ColorChoice label={t`Logo color`} value={value.logoColor} swatches onChange={logoColor => save({ logoColor })} />} />
    <SettingsRow label={t`Chat color`} description={t`Tints your message bubbles on this device.`}
      control={<ColorChoice label={t`Chat color`} value={value.chatColor} onChange={chatColor => save({ chatColor })} />} />
    <SettingsRow label={t`Chat background`} description={t`Each theme remembers its own background. Text stays readable.`}
      control={<ColorChoice label={t`Chat background`} value={value[backgroundKey]} onChange={color => save({ [backgroundKey]: color })} />} />
    <SettingsRow label={t`Interface font`} description={t`The font used for menus and messages.`}
      control={<OptionSelect aria-label={t`Interface font`} value={value.interfaceFont} className="w-44 max-w-full"
        options={[...new Set([...INTERFACE_FONTS, ...fonts, value.interfaceFont])].map(font => ({ value: font, label: font === "system-ui" ? t`System default` : font }))}
        onValueChange={interfaceFont => save({ interfaceFont })} />} />
    <SettingsRow label={t`Code font`} description={t`The font used in code blocks and the terminal.`}
      control={<OptionSelect aria-label={t`Code font`} value={value.codeFont} className="w-44 max-w-full"
        options={[...new Set([...CODE_FONTS, ...fonts, value.codeFont])].map(font => ({ value: font, label: font === "monospace" ? t`System default` : font }))}
        onValueChange={codeFont => save({ codeFont })} />} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
  </>;
}

export function ConversationExtras() {
  const { t } = useLingui(); const id = useId();
  const value = useGeneralPreferences(); const [error, setError] = useState("");
  return <>
    <SettingsRow label={t`Chat order`} description={t`Choose how conversations are shown. Automatic orders keep your saved manual order.`}
      control={<OptionSelect aria-label={t`Chat order`} value={value.sidebarChatOrder} className="w-44 max-w-full"
        options={[{ value: "manual", label: t`Manual` }, { value: "unread-group", label: t`Group unread` }, { value: "unread-first", label: t`Unread first` }]}
        onValueChange={sidebarChatOrder => { try { setGeneralPreferences({ sidebarChatOrder: sidebarChatOrder as GeneralPreferences["sidebarChatOrder"] }); setError(""); } catch { setError(t`Could not save this preference.`); } }} />} />

    <SettingsRow label={<Label htmlFor={id}>{t`Compact message actions`}</Label>}
      description={t`Shows React, Reply and More beside a message, with the time between messages. Turn off to show actions and time below every message.`}
      control={<Switch id={id} checked={value.compactMessageActions} onCheckedChange={compactMessageActions => {
        try { setGeneralPreferences({ compactMessageActions }); setError(""); } catch { setError(t`Could not save this preference.`); }
      }} />} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
  </>;
}

export function DevicePrivacySettings() {
  const { t } = useLingui(); const id = useId(); const value = useGeneralPreferences(); const [error, setError] = useState("");
  return <SettingsGroup title={t`Privacy`}>
    <SettingsRow label={<Label htmlFor={id}>{t`Help improve Mycellios`}</Label>}
      description={t`Share which app screens you use from this device. This optional report contains no messages, prompts or credentials.`}
      control={<Switch id={id} checked={value.productAnalytics} onCheckedChange={productAnalytics => {
        try { setGeneralPreferences({ productAnalytics }); setError(""); } catch { setError(t`Could not save this preference.`); }
      }} />} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
  </SettingsGroup>;
}

export function AppBehaviorPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { t } = useLingui(); const id = useId();
  const bridge = desktopBridge()?.settings;
  const general = useGeneralPreferences();
  const [value, setValue] = useState<DesktopBehaviorSettings>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true;
    if (bridge) void bridge.state().then(v => { if (active) setValue(v); }).catch(() => { if (active) setError(t`Could not load application settings.`); });
    return () => { active = false; };
  }, [bridge]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function save(patch: Partial<DesktopBehaviorSettings>) {
    if (!bridge || busy) return;
    setBusy(true); setError("");
    try { setValue(await bridge.update(patch)); } catch { setError(t`Could not save this preference.`); } finally { setBusy(false); }
  }
  return <SettingsGroup title={t`Application behavior`}>
    {bridge && !value && !error && <p role="status" className="p-4 text-sm text-muted-foreground">{t`Loading…`}</p>}
    {value && <>
      {value.launchAtLogin !== null && <SettingsRow label={<Label htmlFor={`${id}-login`}>{t`Open Mycellios at login`}</Label>}
        description={t`Open the application when you sign in on this computer.`}
        control={<Switch id={`${id}-login`} disabled={busy} checked={value.launchAtLogin} onCheckedChange={launchAtLogin => void save({ launchAtLogin })} />} />}
      <SettingsRow label={<Label htmlFor={`${id}-background`}>{t`Keep Mycellios running in the background`}</Label>}
        description={t`Keep tasks active when you close the window. Use Quit to exit completely.`}
        control={<Switch id={`${id}-background`} disabled={busy} checked={value.keepRunningInBackground} onCheckedChange={keepRunningInBackground => void save({ keepRunningInBackground })} />} />
      {value.keepAwake !== null && <>
        <SettingsRow label={<Label htmlFor={`${id}-awake`}>{t`Keep the computer awake`}</Label>}
          description={t`Run routines on time while plugged in. The screen can turn off.`}
          control={<Switch id={`${id}-awake`} disabled={busy} checked={value.keepAwake} onCheckedChange={keepAwake => void save({ keepAwake })} />} />
        <SettingsRow label={<Label htmlFor={`${id}-battery`}>{t`Also on battery`}</Label>} description={t`Keep the computer awake on battery too. This uses more power.`}
          control={<Switch id={`${id}-battery`} disabled={busy || !value.keepAwake} checked={value.keepAwakeOnBattery} onCheckedChange={keepAwakeOnBattery => void save({ keepAwakeOnBattery })} />} />
      </>}
      <SettingsRow label={t`Open external links in`} description={t`Where links from chats and settings open.`}
        control={<OptionSelect aria-label={t`Open external links in`} value={value.externalLinkTarget} disabled={busy} className="w-44 max-w-full"
          options={[{ value: "system", label: t`Default browser` }, { value: "app", label: t`Mycellios window` }]}
          onValueChange={v => void save({ externalLinkTarget: v as "system" | "app" })} />} />
    </>}
    <SettingsRow label={<Label htmlFor={`${id}-restore`}>{t`Restore the last workspace on startup`}</Label>}
      description={t`Reopen the space and conversation you used last. Explicit chat links always take priority.`}
      control={<Switch id={`${id}-restore`} checked={general.restoreLastWorkspace} onCheckedChange={restoreLastWorkspace => {
        try { setGeneralPreferences({ restoreLastWorkspace }); setError(""); } catch { setError(t`Could not save this preference.`); }
      }} />} />
    {!bridge && desktopBridge() && <p className="px-4 py-3 text-sm text-muted-foreground">{t`Restart the updated desktop app to manage computer settings here.`}</p>}
    {error && <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>}
  </SettingsGroup>;
}
