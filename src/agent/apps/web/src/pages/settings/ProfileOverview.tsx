import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import type { Bot, UsageDashboard } from "@rakazo/contracts";
import { BotAvatar, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { Download, Pencil, Share2 } from "lucide-react";
import { useSpaceRpc } from "../../lib/space-rpc";
import type { RpcClient } from "../../lib/rpc";
import { localTimezone } from "../../lib/local-timezone";
import { civilDate } from "../schedule/calendar-dates";
import { providerColor, providerName } from "../usage/usage-chart";
import { profileActivity, profileRange, profileShareSvg } from "./profile-activity";
import "./profile.css";

export function ProfileOverview({ name, accountId, bots, timezone, onEdit, disabled = false }: {
  name: string; accountId: string; bots: Bot[]; timezone?: string | null; onEdit: () => void; disabled?: boolean;
}) {
  const { t, i18n } = useLingui(), client = useSpaceRpc(), zone = timezone || localTimezone();
  const displayName = name.trim() || t`You`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = `${accountId}:${zone}`;
  const live = useRef({ client, scope }); live.current = { client, scope };
  const [loaded, setLoaded] = useState<{ client: RpcClient; scope: string; report: UsageDashboard; today: string } | null>(null);
  const [failure, setFailure] = useState<{ client: RpcClient; scope: string } | null>(null);
  const [attempt, setAttempt] = useState(0), [share, setShare] = useState<{ client: RpcClient; scope: string; url: string } | null>(null);
  const [sharing, setSharing] = useState(false), [shareError, setShareError] = useState("");
  const [selectedDay, setSelectedDay] = useState(""), [focusedDay, setFocusedDay] = useState("");
  const visible = loaded?.client === client && loaded.scope === scope ? loaded : null;
  const failed = failure?.client === client && failure.scope === scope;
  const shared = share?.client === client && share.scope === scope ? share : null;
  const heatScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = heatScroll.current;
    if (!element) return;
    const showRecent = () => { element.scrollLeft = element.scrollWidth; };
    showRecent();
    // The settings container can finish resizing after the report arrives.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(showRecent); observer.observe(element);
    return () => observer.disconnect();
  }, [visible?.client, visible?.scope, visible?.today]);
  useEffect(() => {
    let gone = false, timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const range = profileRange(new Date(), zone), report = await client.usage.dashboard(range.input);
        if (!gone) { setLoaded({ client, scope, report, today: range.today }); setFailure(null); }
      } catch { if (!gone) setFailure({ client, scope }); }
      if (!gone) timer = setTimeout(load, 30000);
    }
    if (accountId) void load();
    return () => { gone = true; clearTimeout(timer); };
  }, [client, scope, attempt, accountId, zone]);
  useEffect(() => { setShare(null); setShareError(""); setSelectedDay(""); setFocusedDay(""); }, [client, scope]);
  useEffect(() => () => { if (share) URL.revokeObjectURL(share.url); }, [share]);
  const number = (value: number) => new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 2 }).format(value);
  const date = (day: string) => new Intl.DateTimeFormat(i18n.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(civilDate(day));
  const stats = visible ? profileActivity(visible.report, visible.today) : null;
  const activeDays = stats?.activeDays ?? 0;
  const report = visible?.report;
  const none = t`No activity yet`;
  const dayCount = (count: number) => count === 1 ? t`1 day` : t`${count} days`;
  const tiles = stats && report ? [
    { label: t`Tokens`, value: stats.partial ? stats.tokens ? `≥ ${number(stats.tokens)}` : "—" : number(stats.tokens), detail: t`Past year` },
    { label: t`Record day`, value: stats.peak ? number(stats.peak.tokens) : "—", detail: stats.peak ? date(stats.peak.date) : none },
    { label: t`Messages`, value: number(report.userMessages), detail: t`Past year` },
    { label: t`Current streak`, value: dayCount(stats.current), detail: stats.currentStart ? date(stats.currentStart) : none },
    { label: t`Longest streak`, value: dayCount(stats.longest), detail: stats.longestStart ? `${date(stats.longestStart)} – ${date(stats.longestEnd)}` : none },
  ] : [];
  const shareLock = useRef(false);
  async function prepareShare() {
    if (!stats || !visible || shareLock.current) return;
    const captured = live.current; shareLock.current = true; setSharing(true); setShareError("");
    try {
      const svg = profileShareSvg({ name: displayName, title: t`My year with Mycellios`, subtitle: `${date(stats.days[0]!.date)} – ${date(visible.today)}`, metrics: tiles, days: stats.cells, partial: stats.partial ? t`Partial recorded usage` : t`Recorded activity in this space` });
      const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      let blob: Blob;
      try {
        const image = new Image(); image.src = source; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 680;
        const context = canvas.getContext("2d"); if (!context) throw new Error("No canvas");
        context.drawImage(image, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No image")), "image/png"));
      } finally { URL.revokeObjectURL(source); }
      if (mounted.current && live.current.client === captured.client && live.current.scope === captured.scope) setShare({ ...captured, url: URL.createObjectURL(blob) });
    } catch { if (mounted.current && live.current.client === captured.client && live.current.scope === captured.scope) setShareError(t`Could not prepare the image. Try again.`); }
    finally { shareLock.current = false; setSharing(false); }
  }
  return <section className="rk-profile-overview" data-testid="profile-overview">
    <header className="rk-profile-heading"><div className="rk-profile-identity"><span className="rk-profile-initials" aria-hidden="true">{displayName.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase()}</span><h2>{displayName}</h2></div>
      <div className="rk-profile-actions"><Button variant="outline" size="sm" disabled={!stats || sharing || disabled} onClick={() => void prepareShare()}><Share2 size={15} />{sharing ? t`Preparing…` : t`Share activity`}</Button><Button variant="outline" size="sm" disabled={disabled} onClick={onEdit}><Pencil size={15} />{t`Edit profile`}</Button></div></header>
    {shareError && <p role="alert" className="text-sm text-destructive">{shareError}</p>}
    {!stats && !failed && <p role="status" className="text-sm text-muted-foreground">{t`Loading your activity…`}</p>}
    {failed && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p>{visible ? t`Could not refresh. Showing the last loaded report.` : t`Could not load your activity.`}</p><Button variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>{t`Retry`}</Button></div>}
    {stats && report && <>
      <dl className="rk-profile-tiles">{tiles.map(tile => <div className="rk-profile-tile" key={tile.label}><dt>{tile.label}</dt><dd><strong>{tile.value}</strong><span>{tile.detail}</span></dd></div>)}</dl>
      <section className="rk-profile-section"><h3>{t`Activity in this space`}</h3><p className="rk-profile-caption">{t`${activeDays} active days in the past year`} · {zone}</p>
        <p className="rk-profile-caption">{t`Your account's recorded AI calls in this space, across devices. Tokens include cache usage.`}</p>
        {stats.partial && <p className="rk-profile-caption" role="status">{t`Some usage is missing. Token totals, rankings and costs show the recorded portion.`}</p>}
        <div className="rk-profile-calendar"><div ref={heatScroll} className="rk-profile-heat-scroll"><div className="rk-profile-months" aria-hidden="true" style={{ "--weeks": stats.cells.length / 7 } as CSSProperties}>{stats.cells.map((day, i) => day && (day.date.endsWith("-01") || i === stats.cells.findIndex(Boolean)) ? <span key={day.date} style={{ gridColumn: Math.floor(i / 7) + 1 }}>{new Intl.DateTimeFormat(i18n.locale, { month: "short", timeZone: "UTC" }).format(civilDate(day.date))}</span> : null)}</div>
          <div className="rk-profile-heat" role="group" aria-label={t`Activity calendar`} style={{ "--weeks": stats.cells.length / 7 } as CSSProperties}>{stats.cells.map((day, i) => {
            const level = !day?.active ? 0 : day.tokens === 0 ? 1 : Math.min(4, Math.max(1, Math.ceil(day.tokens / Math.max(1, stats.peak?.tokens ?? 1) * 4)));
            const label = day ? `${date(day.date)} · ${number(day.tokens)} ${t`tokens`}${day.partial ? ` · ${t`Partial`}` : ""}` : "";
            return day ? <button type="button" key={day.date} className="rk-profile-cell" tabIndex={day.date === (focusedDay || visible!.today) ? 0 : -1} data-level={level} data-partial={day.partial || undefined} title={label} aria-label={label}
              onFocus={() => { setFocusedDay(day.date); setSelectedDay(label); }}
              onKeyDown={event => { const offset: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }; if (event.key in offset) { event.preventDefault(); const target = event.currentTarget.parentElement?.children[i + offset[event.key]!] as HTMLButtonElement | undefined; target?.focus(); } }}
              onClick={event => { event.currentTarget.focus(); setSelectedDay(label); }} /> : <span key={`pad-${i}`} />;
          })}</div></div><div className="rk-profile-legend" aria-hidden="true"><span>{t`Less`}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} className="rk-profile-cell" />)}<span>{t`More`}</span></div><p className="rk-profile-day" role="status">{selectedDay}</p></div>
      </section>
      <div className="rk-profile-columns"><section className="rk-profile-section"><h3>{t`Statistics`}</h3><dl className="rk-profile-facts">
        <div><dt>{t`Most used provider`}</dt><dd>{stats.providers[0] ? `${providerName(stats.providers[0].id)} · ${percent(stats.providers[0].knownProcessed, stats.tokens)}` : "—"}</dd></div>
        <div><dt>{t`Main model`}</dt><dd>{stats.models[0]?.model ?? "—"}</dd></div>
        <div><dt>{t`Most active weekday`}</dt><dd>{stats.busiest === null ? "—" : new Intl.DateTimeFormat(i18n.locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + stats.busiest)))}</dd></div>
        <div><dt>{t`Estimated cost`}</dt><dd>{report.totals.costUsd === null && !report.totals.knownUsd ? "—" : `${report.totals.costUsd === null ? "≥ " : ""}${new Intl.NumberFormat(i18n.locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(report.totals.costUsd ?? report.totals.knownUsd)}`}</dd></div>
      </dl></section><section className="rk-profile-section"><h3>{t`Most active Micos`}</h3><ol className="rk-profile-ranking">{stats.agents.slice(0, 4).map(row => <li key={row.id}><BotAvatar color={bots.find(bot => bot.id === row.botId)?.color ?? "green"} size={24} /><span>{row.name || t`Deleted Mico`}</span><strong>{number(row.knownProcessed)}</strong></li>)}{!stats.agents.length && <li>{none}</li>}</ol></section></div>
      <section className="rk-profile-section"><h3>{t`Model usage`}</h3><ul className="rk-profile-models">{stats.models.map(row => <li key={row.id}><span title={`${providerName(row.provider)} · ${row.model}`}>{row.model}</span><span className="rk-profile-track" aria-hidden="true"><i style={{ width: percent(row.knownProcessed, stats.tokens), backgroundColor: providerColor(row.provider) }} /></span><strong>{percent(row.knownProcessed, stats.tokens)}</strong></li>)}{!stats.models.length && <li>{none}</li>}</ul></section>
    </>}
    <Dialog open={Boolean(shared)} onOpenChange={open => { if (!open) setShare(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{t`Share your activity`}</DialogTitle><DialogDescription>{t`Review this image before downloading. It contains your display name and these totals, with no email, conversations or account identifiers. Nothing is published automatically.`}</DialogDescription></DialogHeader>{shared && <><img src={shared.url} alt={t`Your Mycellios activity summary`} className="w-full rounded-xl" /><Button onClick={() => { const anchor = document.createElement("a"); anchor.href = shared.url; anchor.download = "mycellios-activity.png"; anchor.click(); }}><Download size={16} />{t`Download image`}</Button></>}</DialogContent></Dialog>
  </section>;
  function percent(value: number, total: number) { return new Intl.NumberFormat(i18n.locale, { style: "percent", maximumFractionDigits: 0 }).format(total ? value / total : 0); }
}
