import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { authClient } from "../../lib/auth";
import { SessionConfirmation } from "../../components/SessionConfirmation";

type Session = Omit<NonNullable<Awaited<ReturnType<typeof authClient.listSessions>>["data"]>[number], "token">;
function needsConfirmation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "SESSION_NOT_FRESH");
}

export function mobileDeviceName(userAgent: string | null | undefined) {
  if (/iPad/i.test(userAgent ?? "")) return "iPad";
  if (/iPhone|iPod/i.test(userAgent ?? "")) return "iPhone";
  if (/Android/i.test(userAgent ?? "")) return "Android";
  return null;
}

export function MobileSessions({ accountId }: { accountId?: string }) {
  const { t, i18n } = useLingui();
  const [sessions, setSessions] = useState<Session[]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const identity = authClient.useSession().data?.user.id;
  async function load() {
    if (loading || removing || !accountId || identity !== accountId) return;
    setLoading(true);
    setError("");
    try {
      const response = await authClient.listSessions();
      if (needsConfirmation(response.error)) { setConfirmation(true); setSessions(undefined); return; }
      if (response.error || !response.data) throw new Error("Sessions unavailable");
      setConfirmation(false);
      setSessions(response.data.filter(session => mobileDeviceName(session.userAgent)));
    } catch {
      setError(t`Could not load your phones. Try again.`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    setSessions(undefined);
    setSelected(null);
    setError("");
    if (!accountId || accountId !== identity) return;
    setLoading(true);
    void authClient.listSessions().then(response => {
      if (!live) return;
      if (needsConfirmation(response.error)) { setConfirmation(true); setSessions(undefined); return; }
      if (response.error || !response.data) throw new Error("Sessions unavailable");
      setConfirmation(false);
      setSessions(response.data.filter(session => mobileDeviceName(session.userAgent)));
    }).catch(() => {
      if (live) setError(t`Could not load your phones. Try again.`);
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [accountId, identity]);
  async function disconnect() {
    if (!selected || removing || !accountId || identity !== accountId) return;
    const target = selected;
    setRemoving(true);
    setError("");
    try {
      const response = await authClient.$fetch<{ status: boolean }>("/revoke-owned-session", { method: "POST", body: { sessionId: target.id } });
      if (needsConfirmation(response.error)) { setConfirmation(true); setSessions(undefined); setSelected(null); return; }
      if (response.error) throw new Error("Could not disconnect");
      setSessions(current => current?.filter(session => session.id !== target.id));
      setSelected(null);
    } catch {
      setError(t`Could not disconnect the phone. Try again.`);
    } finally {
      setRemoving(false);
    }
  }
  if (!accountId || identity !== accountId) return null;
  return <>
    <SettingsGroup title={t`Your phones`}>
      <SettingsRow label={t`Signed-in phones`} description={t`Sign in on your phone using the link above. Your conversations appear with the same account.`}
        control={<Button size="sm" variant="outline" disabled={loading || removing} onClick={() => void load()}>{t`Refresh`}</Button>} />
      {confirmation && <SettingsRow label={t`Confirm your account`} description={t`Sign in again to manage your phones. Your conversations stay in your account.`}
        control={<SessionConfirmation accountId={accountId} onConfirmed={load} />} />}
      {loading && !sessions && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t`Loading…`}</p>}
      {sessions?.map(session => <SettingsRow key={session.id}
        label={mobileDeviceName(session.userAgent)}
        description={t`Last activity · ${new Date(session.updatedAt).toLocaleString(i18n.locale)}`}
        control={<Button size="sm" variant="outline" disabled={removing} onClick={() => setSelected(session)}>{t`Disconnect`}</Button>} />)}
      {sessions?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{t`No phones are signed in yet.`}</p>}
      {error && <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>}
    </SettingsGroup>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !removing) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t`Disconnect this phone?`}</DialogTitle>
          <DialogDescription>{t`The phone will need to sign in again. Your conversations stay in your account.`}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={removing} onClick={() => setSelected(null)}>{t`Cancel`}</Button>
          <Button variant="destructive" disabled={removing} onClick={() => void disconnect()}>{t`Disconnect`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
