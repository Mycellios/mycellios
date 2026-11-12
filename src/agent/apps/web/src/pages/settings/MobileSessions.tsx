import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { authClient } from "../../lib/auth";
import { Smartphone, RefreshCw, Plus } from "lucide-react";
import "./mobile-connection.css";
import { SessionConfirmation } from "../../components/SessionConfirmation";

type Session = Omit<NonNullable<Awaited<ReturnType<typeof authClient.listSessions>>["data"]>[number], "token">;
function needsConfirmation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "SESSION_NOT_FRESH");
}

export function mobileDeviceName(userAgent: string | null | undefined) {
  if (/iPad|Macintosh.*Mobile/i.test(userAgent ?? "")) return "iPad";
  if (/iPhone|iPod/i.test(userAgent ?? "")) return "iPhone";
  if (/Android/i.test(userAgent ?? "")) {
    const model = /Android[^;)]*;\s*(?:[a-z]{2}(?:[-_][A-Z]{2})?;\s*)?([^;)]+?)(?:\s+Build\/|\))/i.exec(userAgent ?? "")?.[1]?.trim();
    return model && !/^(K|wv|Mobile|Android)$/i.test(model) ? model.slice(0, 60) : "Android";
  }
  return null;
}

export function MobileSessions({ accountId, allDevices = false, onAddPhone, permanentLink, watch = false, connectionLabel }: { accountId?: string; allDevices?: boolean; onAddPhone?: () => void; permanentLink?: ReactNode; watch?: boolean; connectionLabel?: string }) {
  const { t, i18n } = useLingui();
  const [sessions, setSessions] = useState<Session[]>();
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const authSession = authClient.useSession().data;
  const identity = authSession?.user.id;
  const currentSession = authSession?.session?.id;
  const generation = useRef(0), reading = useRef(false), deleting = useRef(false);
  const scope = JSON.stringify([accountId ?? null, identity ?? null, allDevices]);
  const activeScope = useRef(scope); activeScope.current = scope;
  const ownedSessions = loadedScope === scope ? sessions : undefined;
  const ownedSelected = loadedScope === scope ? selected : null;
  const visibleSessions = (data: NonNullable<Awaited<ReturnType<typeof authClient.listSessions>>["data"]>) => data
    .filter((session: Session) => allDevices || mobileDeviceName(session.userAgent))
    .map(({ token: _token, ...session }: Session & { token?: string }) => session);
  const deviceName = (userAgent: string | null | undefined) => mobileDeviceName(userAgent) ?? (/Windows/i.test(userAgent ?? "") ? "Windows" : /Mac/i.test(userAgent ?? "") ? "macOS" : /Linux/i.test(userAgent ?? "") ? "Linux" : t`Browser`);
  async function load() {
    if (reading.current || deleting.current || !accountId || identity !== accountId) return;
    const expectedScope = scope, id = ++generation.current; reading.current = true;
    setLoading(true); setError("");
    try {
      const response = await authClient.listSessions();
      if (id !== generation.current || activeScope.current !== expectedScope) return;
      if (needsConfirmation(response.error)) { setConfirmation(true); setSessions(undefined); return; }
      if (response.error || !response.data) throw new Error("Sessions unavailable");
      setConfirmation(false); setLoadedScope(expectedScope); setSessions(visibleSessions(response.data));
    } catch {
      if (id === generation.current && activeScope.current === expectedScope) setError(allDevices ? t`Could not load account sessions. Try again.` : t`Could not load your phones. Try again.`);
    } finally {
      if (id === generation.current) { reading.current = false; setLoading(false); }
    }
  }
  const reload = useRef(load); reload.current = load;
  useEffect(() => {
    generation.current++; reading.current = false; deleting.current = false;
    setSessions(undefined); setLoadedScope(""); setSelected(null); setError(""); setConfirmation(false); setRemoving(false); setLoading(false);
    void reload.current();
    const focus = () => { if (document.visibilityState !== "hidden") void reload.current(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { generation.current++; reading.current = false; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [accountId, identity, allDevices]);
  useEffect(() => {
    if (!watch || confirmation) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void reload.current(); }, 5000);
    return () => window.clearInterval(timer);
  }, [watch, confirmation]);
  async function disconnect() {
    if (!ownedSelected || deleting.current || !accountId || identity !== accountId || activeScope.current !== scope) return;
    const target = ownedSelected, expectedScope = scope, id = ++generation.current; deleting.current = true; reading.current = false; setLoading(false);
    setRemoving(true);
    setError("");
    try {
      const response = await authClient.$fetch<{ status: boolean }>("/revoke-owned-session", { method: "POST", body: { sessionId: target.id } });
      if (activeScope.current !== expectedScope || generation.current !== id) return;
      if (needsConfirmation(response.error)) { setConfirmation(true); setSessions(undefined); setSelected(null); return; }
      if (response.error || !response.data?.status) throw new Error("Could not disconnect");
      setSessions(current => current?.filter(session => session.id !== target.id));
      setSelected(null);
    } catch {
      if (activeScope.current === expectedScope && generation.current === id) setError(allDevices ? t`Could not disconnect this session. Try again.` : t`Could not disconnect the phone. Try again.`);
    } finally {
      if (activeScope.current === expectedScope && generation.current === id) { deleting.current = false; setRemoving(false); }
    }
  }
  if (!accountId || identity !== accountId) return null;
  return <>
    {!allDevices ? <section data-slot="settings-section" className="space-y-4">
      <div className="mobile-connection-heading"><div><h3>{t`Your phones`}</h3><p>{t`Phones signed in to this Mycellios account.`}</p></div>
        <div className="mobile-connection-actions">{connectionLabel && <span className="text-xs text-muted-foreground">{connectionLabel}</span>}
          <Button variant="ghost" size="sm" aria-label={t`Refresh phones`} disabled={loading || removing} onClick={() => void load()}><RefreshCw aria-hidden size={15} /></Button>
          {onAddPhone && <Button size="sm" onClick={onAddPhone}><Plus aria-hidden size={14} />{t`Add phone`}</Button>}</div></div>
      {confirmation && <div className="mobile-connection-notice"><p><strong className="block text-foreground">{t`Confirm your account`}</strong>{t`Sign in again to manage your phones. Your conversations stay in your account.`}</p><SessionConfirmation accountId={accountId} onConfirmed={load} /></div>}
      {loading && !ownedSessions && <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p>}
      <div className="mobile-device-grid">
        {ownedSessions?.map(session => <article key={session.id} className="mobile-device-card">
          <div className="mobile-device-icon"><Smartphone aria-hidden size={19} /></div><div className="mobile-device-copy"><h4>{mobileDeviceName(session.userAgent)}</h4>
            <p>{/Android/i.test(session.userAgent ?? "") ? "Android" : "iOS"} · {t`Last activity · ${new Date(session.updatedAt).toLocaleString(i18n.locale)}`}</p>
            <span>{session.id === currentSession ? t`This phone` : t`Account session`}</span></div>
          <Button variant="ghost" size="sm" disabled={removing} onClick={() => setSelected(session)}>{t`Disconnect`}</Button>
        </article>)}
        {permanentLink}
      </div>
      {ownedSessions?.length === 0 && <p className="text-sm text-muted-foreground">{t`No phones are signed in yet.`}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm text-muted-foreground">{t`Disconnecting revokes access to this account. A phone may keep its current screen visible until it refreshes or returns from the background.`}</p>
    </section> : <>
    <SettingsGroup title={allDevices ? t`Account sessions` : t`Your phones`}>
      <SettingsRow label={allDevices ? t`Signed-in devices` : t`Signed-in phones`} description={allDevices ? t`Sessions stay active until you sign out or disconnect them. Disconnecting ends remote actions for that session.` : t`Sign in on your phone using the link above. Your conversations appear with the same account.`}
        control={<Button size="sm" variant="outline" disabled={loading || removing} onClick={() => void load()}>{t`Refresh`}</Button>} />
      {confirmation && <SettingsRow label={t`Confirm your account`} description={allDevices ? t`Sign in again to manage account sessions.` : t`Sign in again to manage your phones. Your conversations stay in your account.`}
        control={<SessionConfirmation accountId={accountId} onConfirmed={load} />} />}
      {loading && !ownedSessions && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t`Loading…`}</p>}
      {ownedSessions?.map(session => <SettingsRow key={session.id}
        label={allDevices ? deviceName(session.userAgent) : mobileDeviceName(session.userAgent)}
        description={t`Last activity · ${new Date(session.updatedAt).toLocaleString(i18n.locale)}`}
        control={<Button size="sm" variant="outline" disabled={removing || (allDevices && session.id === currentSession)} onClick={() => setSelected(session)}>{allDevices && session.id === currentSession ? t`This session` : t`Disconnect`}</Button>} />)}
      {ownedSessions?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{allDevices ? t`No active sessions.` : t`No phones are signed in yet.`}</p>}
      {error && <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>}
    </SettingsGroup>
    </>}
    <Dialog open={Boolean(ownedSelected)} onOpenChange={open => { if (!open && !removing) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{allDevices ? t`Disconnect this session?` : t`Disconnect this phone?`}</DialogTitle>
          <DialogDescription>{allDevices ? t`This device will need to sign in again. Your conversations stay in your account.` : t`The phone will need to sign in again. Your conversations stay in your account.`}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={removing} onClick={() => setSelected(null)}>{t`Cancel`}</Button>
          <Button variant="destructive" disabled={removing} onClick={() => void disconnect()}>{t`Disconnect`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
