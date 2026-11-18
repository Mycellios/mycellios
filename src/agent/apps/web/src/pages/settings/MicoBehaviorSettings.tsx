import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { DEFAULT_MEMORY_REVIEW_POLICY, effectiveMicoSettings, MICO_ACCOUNT_INSTRUCTIONS_MAX_LENGTH, type Bot, type MicoBehaviorKey, type MicoSettingsState, type MicoSettingsUpdate } from "@rakazo/contracts";
import { BotAvatar, Button, Input, OptionSelect, Switch, Textarea } from "@rakazo/ui-web";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceRpc } from "../../lib/space-rpc";
import { desktopBridge } from "../../lib/desktop";
import type { RpcClient } from "../../lib/rpc";

export function MicoBehaviorSettings({ bots, onBusyChange, onDirtyChange }: { bots: Bot[]; onBusyChange: (value: boolean) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useLingui(), client = useSpaceRpc();
  const active = useRef(client); active.current = client;
  const [loaded, setLoaded] = useState<{ client: RpcClient; state: MicoSettingsState } | null>(null);
  const [view, setView] = useState<MicoBehaviorKey | null>(null);
  const [search, setSearch] = useState(""), [error, setError] = useState("");
  const [saving, setSaving] = useState(false), lock = useRef(false);
  const [memoryUsage,setMemoryUsage]=useState<Awaited<ReturnType<RpcClient["memory"]["reviewStatus"]>>|null>(null);
  useEffect(()=>{let gone=false;setMemoryUsage(null);if(client.memory?.reviewStatus)void client.memory.reviewStatus().then(value=>{if(!gone)setMemoryUsage(value);},()=>{});return()=>{gone=true;};},[client,loaded?.state.revision]);
  const [hostBusy, setHostBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const state = loaded?.client === client ? loaded.state : null;
  // An unsaved edit of the account instructions; null while showing the saved text.
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);
  const savedInstructions = state?.defaults.accountInstructions ?? "";
  const instructionsDirty = state !== null && instructionsDraft !== null && instructionsDraft !== savedInstructions;
  const reportDirty = useRef(onDirtyChange); reportDirty.current = onDirtyChange;
  useEffect(() => { reportDirty.current?.(instructionsDirty); }, [instructionsDirty]);
  useEffect(() => () => reportDirty.current?.(false), []);
  useEffect(() => { onBusyChange(saving || hostBusy); return () => onBusyChange(false); }, [saving, hostBusy, onBusyChange]);
  useEffect(() => {
    let gone = false; setView(null); setSearch(""); setError(""); setInstructionsDraft(null);
    void client.preferences.micos().then(state => { if (!gone) setLoaded({ client, state }); }, () => { if (!gone) setError(t`Could not load Mico preferences.`); });
    return () => { gone = true; };
  }, [client, retry]);
  const settings: { key: MicoBehaviorKey; title: string; description: string }[] = [
    { key: "localScripts", title: t`Local scripts`, description: t`Allow scripts on an authorized computer to send messages, run routines, answer questions and allow or deny individual approval requests.` },
    { key: "agentNewChat", title: t`Mico starts new chats`, description: t`In a long personal chat, the Mico can save handoff notes and start fresh context after finishing its task. History is kept.` },
    { key: "showPlan", title: t`Show a plan before long tasks`, description: t`Ask the Mico to share a short plan before a long task. Simple replies stay direct. This does not grant permission to act.` },
  ];
  const modes = [{ value: "inherit", label: t`Use default` }, { value: "on", label: t`Enabled` }, { value: "off", label: t`Disabled` }];
  const rows = bots.filter(bot => state?.bots.some(item => item.id === bot.id));
  const total = rows.length;
  async function save(change: Omit<Extract<MicoSettingsUpdate, { kind: "defaults" }>, "revision"> | Omit<Extract<MicoSettingsUpdate, { kind: "bot" }>, "revision"> | Omit<Extract<MicoSettingsUpdate, { kind: "all" }>, "revision">) {
    if (!state || lock.current) return false;
    const source = client; lock.current = true; setSaving(true); setError("");
    try {
      const next = await source.preferences.updateMicos({ ...change, revision: state.revision });
      if (active.current === source) setLoaded({ client: source, state: next });
      return active.current === source;
    } catch {
      if (active.current === source) {
        setError(t`Could not save. Preferences may have changed elsewhere. Review them and try again.`);
        try { const next = await source.preferences.micos(); if (active.current === source) setLoaded({ client: source, state: next }); } catch { if (active.current === source) setLoaded(null); }
      }
      return false;
    } finally { lock.current = false; setSaving(false); }
  }
  const chosen = settings.find(item => item.key === view);
  return <div className="space-y-6" data-testid="mico-behavior-settings">
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!state && <Button variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>{t`Retry`}</Button>}</div>}
    {!state ? !error && <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p> : chosen ? <>
      <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setView(null); setSearch(""); }}>{t`Back to Micos`}</Button>
      <SettingsGroup title={t`Default`}><SettingsRow label={chosen.title} description={chosen.description}
        control={<Switch aria-label={chosen.title} checked={state.defaults[chosen.key]} disabled={saving} onCheckedChange={enabled => void save({ kind: "defaults", patch: { [chosen.key]: enabled } })} />} /></SettingsGroup>
      <p className="text-sm text-muted-foreground">{t`New Micos and Micos using the default follow this value. Defaults apply to your account; Apply to all affects only your Micos in this space.`}</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">{t`Micos`}</h3>
        <OptionSelect aria-label={t`Apply to all`} value="" disabled={saving || !rows.length}
          options={[{ value: "", label: t`Apply to all` }, ...modes]} onValueChange={value => { if (value) void save({ kind: "all", key: chosen.key, value: value === "inherit" ? null : value === "on" }); }} /></div>
      {rows.length > 5 && <Input aria-label={t`Search Micos`} placeholder={t`Search Micos…`} value={search} onChange={event => setSearch(event.target.value)} />}
      <SettingsGroup>{rows.filter(bot => bot.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(bot => {
        const preferences = state.bots.find(row => row.id === bot.id)!.preferences;
        const override = preferences[chosen.key];
        return <SettingsRow key={bot.id} label={<span className="flex items-center gap-3"><BotAvatar color={bot.color} size={28} /><span className="break-words">{bot.name}</span></span>}
          control={<OptionSelect aria-label={`${chosen.title} · ${bot.name}`} value={override === undefined ? "inherit" : override ? "on" : "off"} disabled={saving}
            options={[{ value: "inherit", label: state.defaults[chosen.key] ? t`Default (Enabled)` : t`Default (Disabled)` }, ...modes.slice(1)]}
            onValueChange={value => void save({ kind: "bot", botId: bot.id, key: chosen.key, value: value === "inherit" ? null : value === "on" })} />} />;
      })}{!rows.length && <p className="px-4 py-3 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>}</SettingsGroup>
      {chosen.key === "localScripts" && <LocalScriptsSettings scope={client} onBusyChange={setHostBusy} />}
    </> : <>
      <SettingsGroup title={t`Conversation`}><SettingsRow label={t`Response style`}
        description={t`Natural shares a brief first step. Classic goes straight to the result. Both keep replies short unless you ask for detail.`}
        control={<OptionSelect aria-label={t`Response style`} value={state.defaults.responseStyle ?? "natural"} disabled={saving}
          options={[{ value: "natural", label: t`Natural` }, { value: "classic", label: t`Classic` }]}
          onValueChange={value => { if (value === "natural" || value === "classic") void save({ kind: "defaults", patch: { responseStyle: value } }); }} />} /></SettingsGroup>
      <AccountInstructions value={instructionsDraft ?? savedInstructions} dirty={instructionsDirty} saving={saving}
        onChange={setInstructionsDraft} onDiscard={() => setInstructionsDraft(null)}
        onSave={async () => {
          const accountInstructions = instructionsDraft ?? savedInstructions;
          if (await save({ kind: "defaults", patch: { accountInstructions } })) setInstructionsDraft(current => current === accountInstructions ? null : current);
        }} />
      <SettingsGroup title={t`Local memory`}>
        {memoryUsage?<SettingsRow label={t`Reserved today`} description={t`Daily budget resets at 00:00 UTC.`}
          control={<span className="text-sm tabular-nums">{new Intl.NumberFormat(undefined,{maximumFractionDigits:6}).format(memoryUsage.reservedMicrounits/1_000_000)} {t`Credits`}{memoryUsage.pending ? ` · ${memoryUsage.pending} ${t`Pending reviews`}`:""}</span>} />:null}
        <SettingsRow label={t`Automatic memory review`} description={t`Learn from completed conversations in the background. Uses a model with a bounded Credit quote; otherwise waits.`}
          control={<Switch aria-label={t`Automatic memory review`} checked={(state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY).enabled} disabled={saving}
            onCheckedChange={enabled=>void save({kind:"defaults",patch:{memoryReview:{...(state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY),enabled}}})} />} />
        <SettingsRow label={t`Daily limit per space`} description={t`Maximum reserved Credits each day. Pending reviews count toward the limit and are never sent again.`}
          control={<OptionSelect aria-label={t`Daily limit per space`} value={String((state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY).dailyLimitMicrounits)} disabled={saving}
            options={[{value:"0",label:t`No spending`},{value:"1000",label:"0.001 Credits"},{value:"10000",label:"0.01 Credits"},{value:"50000",label:"0.05 Credits"}]}
            onValueChange={value=>void save({kind:"defaults",patch:{memoryReview:{...(state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY),dailyLimitMicrounits:Number(value)}}})} />} />
        <SettingsRow label={t`Review frequency`} description={t`Also reviews after 15 minutes of inactivity when there are at least three new messages from you.`}
          control={<OptionSelect aria-label={t`Review frequency`} value={String((state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY).interval)} disabled={saving}
            options={[{value:"10",label:t`10 turns`},{value:"20",label:t`20 turns`},{value:"40",label:t`40 turns`}]}
            onValueChange={value=>void save({kind:"defaults",patch:{memoryReview:{...(state.defaults.memoryReview??DEFAULT_MEMORY_REVIEW_POLICY),interval:Number(value) as 10|20|40}}})} />} />
      </SettingsGroup>
      <SettingsGroup title={t`Defaults`}>{settings.map(setting => {
        const count = rows.filter(bot => effectiveMicoSettings(state.defaults, state.bots.find(item => item.id === bot.id)?.preferences)[setting.key]).length;
        return <SettingsRow key={setting.key} label={setting.title} description={state.defaults[setting.key] ? t`Default: Enabled` : t`Default: Disabled`}
          control={<Button variant="ghost" size="sm" disabled={saving} onClick={() => setView(setting.key)}>{t`Enabled for ${count} of ${total}`}<span aria-hidden="true" className="ml-2">›</span></Button>} />;
      })}</SettingsGroup>
      <SettingsGroup title={t`Git commits`}><SettingsRow label={t`Mention Mycellios in commits`} description={t`When you authorize a commit, ask the Mico to add Mycellios as a co-author. You remain the author.`}
        control={<Switch aria-label={t`Mention Mycellios in commits`} checked={state.defaults.gitCoauthor} disabled={saving} onCheckedChange={gitCoauthor => void save({ kind: "defaults", patch: { gitCoauthor } })} />} /></SettingsGroup>
    </>}
  </div>;
}

/** One owner-written text for all Micos. The parent keeps the draft across subviews and other saves. */
function AccountInstructions({ value, dirty, saving, onChange, onDiscard, onSave }: { value: string; dirty: boolean; saving: boolean; onChange: (text: string) => void; onDiscard: () => void; onSave: () => Promise<void> }) {
  const { t } = useLingui();
  return <SettingsGroup title={t`Instructions for all Micos`}>
    <div className="space-y-3 px-4 py-3">
      <p className="text-sm text-muted-foreground">{t`Added to every conversation with your Micos, for example the language to reply in or habits like planning first. A Mico's own instructions take precedence when they conflict.`}</p>
      <Textarea aria-label={t`Instructions for all Micos`} value={value} maxLength={MICO_ACCOUNT_INSTRUCTIONS_MAX_LENGTH} rows={5} disabled={saving}
        placeholder={t`Always reply in English. Before a long task, share a short plan.`} onChange={event => onChange(event.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{value.length} / {MICO_ACCOUNT_INSTRUCTIONS_MAX_LENGTH}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={saving || !dirty} onClick={onDiscard}>{t`Discard`}</Button>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void onSave()}>{t`Save`}</Button>
        </div>
      </div>
    </div>
  </SettingsGroup>;
}

function LocalScriptsSettings({ scope, onBusyChange }: { scope: RpcClient; onBusyChange: (value: boolean) => void }) {
  const { t } = useLingui(), bridge = desktopBridge()?.localScripts;
  const [loaded, setLoaded] = useState<{ scope: RpcClient; state: Awaited<ReturnType<NonNullable<typeof bridge>["state"]>> } | null>(null);
  const state = loaded?.scope === scope ? loaded.state : null;
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef(scope); active.current = scope;
  useEffect(() => { let gone = false; setError(""); if (bridge) void bridge.state().then(state => { if (!gone) setLoaded({ scope, state }); }, () => { if (!gone) setError(t`Could not load local script settings.`); }); return () => { gone = true; }; }, [scope, bridge]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const lock = useRef(false);
  async function configure(patch: { enabled?: boolean; requestsPerHour?: number }) {
    if (!bridge || lock.current) return; lock.current = true; setBusy(true); setError(""); const source = scope;
    try { const state = await bridge.configure(patch); if (active.current === source) setLoaded({ scope: source, state }); }
    catch { if (active.current === source) setError(t`Could not save local script settings.`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <SettingsGroup title={t`This computer`}>
    <SettingsRow label={t`Allow local scripts on this computer`} description={t`Requires Mycellios Desktop, a signed-in session and permission for each Mico. The local access key stays in a private file on this computer.`}
      control={<Switch aria-label={t`Allow local scripts on this computer`} checked={state?.enabled ?? false} disabled={!state || busy} onCheckedChange={enabled => void configure({ enabled })} />} />
    <SettingsRow label={t`Requests per hour`} description={t`Maximum requests each Mico can receive from local scripts on this computer, across messages, routines and answers.`}
      control={<OptionSelect aria-label={t`Requests per hour`} value={String(state?.requestsPerHour ?? 30)} disabled={!state || busy} options={[10, 30, 60, 120].map(value => ({ value: String(value), label: t`${value} per hour` }))} onValueChange={value => void configure({ requestsPerHour: Number(value) })} />} />
    {state?.enabled && <p className="break-all px-4 pb-3 text-xs text-muted-foreground">{t`Script connection file:`} <code>{state.configPath}</code></p>}
    {!bridge && <p className="px-4 pb-3 text-sm text-muted-foreground">{t`Open Mycellios Desktop to enable scripts on a computer. Account preferences above can be saved here.`}</p>}
    {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error}</p>}
  </SettingsGroup>;
}
