import { Trans, useLingui } from "@lingui/react/macro";
import type { TailnetConnection } from "@rakazo/contracts";
import { Button, Field, FieldLabel, Input, Toggle } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

export function TailscaleConnections({ onOpenMcp }: { onOpenMcp?: () => void }) {
  const scope = useSpaceQueries();
  return <ScopedTailscaleConnections key={JSON.stringify(scope.bots.list.key())} onOpenMcp={onOpenMcp} />;
}

function ScopedTailscaleConnections({ onOpenMcp }: { onOpenMcp?: () => void }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const cache = useQueryClient();
  const key = [...queries.bots.list.key(), "tailscale-connections"];
  const networks = useQuery({ queryKey: key, queryFn: () => rpc.tailscale.list(), refetchInterval: 5000 });
  const bots = useQuery(queries.bots.list.queryOptions());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [kind, setKind] = useState<"personal" | "company">("personal");
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  async function perform(action: () => Promise<unknown>) {
    if (pending) return;
    setPending(true); setError(null);
    try { await action(); }
    catch (cause) { setError(errorText(cause, t`Could not update Tailscale. Try again.`)); }
    finally { await cache.invalidateQueries({ queryKey: key }); setPending(false); }
  }
  const stateLabel = (row: TailnetConnection) => ({
    connected: t`Connected`, disconnected: t`Disconnected`, needs_auth: t`Sign in required`,
    needs_approval: t`Waiting for Tailscale device approval`, unavailable: t`Unavailable`,
    wrong_tailnet: t`Signed in to a different network. Disconnect and connect again.`,
  })[row.status];
  function botChoices(ids: string[], change: (ids: string[]) => void) {
    return <div className="space-y-2">{ids.length === 0 ? <p className="text-sm text-muted-foreground"><Trans>No Mico has network access yet.</Trans></p> : null}<div className="flex flex-wrap gap-2" role="group" aria-label={t`Authorized Micos`}>
      {(bots.data ?? []).map(bot => <Toggle key={bot.id} pressed={ids.includes(bot.id)} disabled={pending}
        onPressedChange={checked => change(checked ? [...ids, bot.id] : ids.filter(id => id !== bot.id))}>
        {bot.name}
      </Toggle>)}
      {bots.data?.length === 0 ? <p className="text-sm text-muted-foreground"><Trans>Create a Mico before granting network access.</Trans></p> : null}
    </div></div>;
  }
  return <section className="mb-6 space-y-3" aria-label="Tailscale" data-testid="tailscale-connections">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-medium">Tailscale</h2>
        <p className="text-sm text-muted-foreground"><Trans>Connect a private network, then assign its MCP servers to your Micos.</Trans></p></div>
      <Button variant="secondary" size="sm" disabled={!networks.data?.available || pending}
        onClick={() => setOpen(value => !value)} aria-expanded={open}><Trans>Add network</Trans></Button>
    </div>
    {networks.isPending ? <p role="status" className="text-sm text-muted-foreground"><Trans>Loading networks…</Trans></p> : null}
    {networks.isError ? <Button variant="link" onClick={() => void networks.refetch()}><Trans>Could not load networks. Retry</Trans></Button> : null}
    {networks.data && !networks.data.available ? <p className="text-sm text-muted-foreground"><Trans>Tailscale is not available on this server yet.</Trans></p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {open ? <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={event => {
      event.preventDefault(); void perform(async () => {
        await rpc.tailscale.create({ name, dnsSuffix: suffix, kind, allowedBotIds: selected });
        setName(""); setSuffix(""); setSelected([]); setOpen(false);
      });
    }}>
      <Field><FieldLabel htmlFor={`${formId}-name`}><Trans>Network name</Trans></FieldLabel>
        <Input id={`${formId}-name`} value={name} onChange={event => setName(event.target.value)} required maxLength={120} disabled={pending} /></Field>
      <Field><FieldLabel htmlFor={`${formId}-suffix`}><Trans>Tailscale DNS suffix</Trans></FieldLabel>
        <Input id={`${formId}-suffix`} value={suffix} onChange={event => setSuffix(event.target.value.toLowerCase().trim())}
          placeholder="tail12345.ts.net" required maxLength={70} disabled={pending} />
        <p className="text-sm text-muted-foreground"><Trans>Find the network suffix in Tailscale DNS settings. Sign in to this same network when connecting.</Trans></p></Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t`Network type`}>
        <Toggle pressed={kind === "personal"} disabled={pending} onPressedChange={() => setKind("personal")}><Trans>Personal</Trans></Toggle>
        <Toggle pressed={kind === "company"} disabled={pending} onPressedChange={() => setKind("company")}><Trans>Company</Trans></Toggle>
      </div>
      {kind === "company" ? <div className="space-y-2">
        <p className="text-sm text-muted-foreground"><Trans>A Space administrator must enable this company network. Each member signs in with their own Tailscale account.</Trans></p>
        {networks.data?.admin ? <Button type="button" variant="secondary" disabled={!suffix || pending}
          onClick={() => void perform(() => rpc.tailscale.company({ dnsSuffix: suffix, enabled: true }))}><Trans>Enable company network</Trans></Button> : null}
      </div> : null}
      <p className="text-sm font-medium"><Trans>Authorized Micos</Trans></p>
      {botChoices(selected, setSelected)}
      <p className="text-sm text-muted-foreground"><Trans>Only selected Micos can use this network. Each Mico also needs its own MCP server and tool permissions.</Trans></p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || !name || !suffix}><Trans>Save network</Trans></Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}><Trans>Cancel</Trans></Button></div>
    </form> : null}
    {(networks.data?.connections ?? []).map(row => <div key={row.id} className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">
        <h3 className="text-sm font-medium break-words">{row.name}</h3>
        <p className="text-sm text-muted-foreground break-all">{row.dnsSuffix} · {row.kind === "company" ? t`Company` : t`Personal`}</p>
        <p className="text-sm" role="status">{stateLabel(row)}</p>
      </div><div className="flex flex-wrap gap-2">
        {row.status !== "connected" ? <Button variant="secondary" size="sm" disabled={pending || !networks.data?.available}
          onClick={() => void perform(() => rpc.tailscale.connect({ id: row.id }))}><Trans>Connect</Trans></Button> : null}
        <Button variant="ghost" size="sm" disabled={pending || !networks.data?.available}
          onClick={() => void perform(() => rpc.tailscale.disconnect({ id: row.id }))}><Trans>Disconnect</Trans></Button>
      </div></div>
      {row.authUrl ? <a className="text-sm underline underline-offset-4" href={row.authUrl} target="_blank" rel="noopener noreferrer"><Trans>Sign in to Tailscale</Trans></a> : null}
      <p className="text-sm font-medium"><Trans>Authorized Micos</Trans></p>
      {botChoices(drafts[row.id] ?? row.allowedBotIds, ids => setDrafts(current => ({ ...current, [row.id]: ids })))}
      {drafts[row.id] ? <Button size="sm" disabled={pending} onClick={() => void perform(async () => {
        await rpc.tailscale.grant({ id: row.id, allowedBotIds: drafts[row.id] ?? [] });
        setDrafts(current => { const copy = { ...current }; delete copy[row.id]; return copy; });
      })}><Trans>Save Mico access</Trans></Button> : null}
      {onOpenMcp ? <Button variant="link" size="sm" onClick={onOpenMcp}><Trans>Manage MCP servers</Trans></Button> : null}
    </div>)}
    {networks.data?.admin ? networks.data.companyNetworks.map(policy => <div key={policy.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="break-all">{policy.dnsSuffix} · {policy.enabled ? t`Enabled for this Space` : t`Disabled for this Space`}</span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void perform(() => rpc.tailscale.company({ dnsSuffix: policy.dnsSuffix, enabled: !policy.enabled }))}>
        {policy.enabled ? t`Disable company access` : t`Enable company access`}</Button>
    </div>) : null}
  </section>;
}
