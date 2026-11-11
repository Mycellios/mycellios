import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { authClient } from "../lib/auth";
import { fetchAuthCapabilities, type AuthCapabilities } from "../lib/auth-capabilities";
import { fetchAccountSecurity } from "../lib/account-security";
import { runSsoFlow } from "../lib/sso-flow";
import { authErrorText } from "../lib/user-error";
import { PasskeySignIn } from "./PasskeySignIn";

/** Renew a session through normal sign-in, without signing out or ending other devices. */
export function SessionConfirmation({ accountId, onConfirmed }: { accountId: string; onConfirmed: () => Promise<void> }) {
  const { t } = useLingui();
  const id = useId();
  const identity = authClient.useSession().data?.user;
  const [open, setOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<AuthCapabilities>();
  const [security, setSecurity] = useState<Awaited<ReturnType<typeof fetchAccountSecurity>>>();
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setPassword(""); setCode(""); setSent(false); return; }
    let live = true;
    setError(null);
    void Promise.all([fetchAuthCapabilities(), fetchAccountSecurity()]).then(([value, account]) => { if (live) { setCapabilities(value); setSecurity(account); } })
      .catch(() => { if (live) setError(t`Could not load sign-in options`); });
    return () => { live = false; };
  }, [open, attempt]);
  async function confirmed() {
    const current = await authClient.getSession({ query: { disableCookieCache: true } });
    if (current.error || !current.data) throw new Error(t`Could not continue`);
    if (current.data.user.id !== accountId) throw new Error(t`The account changed. Close settings and try again.`);
    setOpen(false); setPassword(""); setCode("");
    await onConfirmed();
  }
  async function run(action: () => Promise<void>) {
    if (pending || identity?.id !== accountId) return;
    setPending(true); setError(null);
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t`Could not continue`); }
    finally { setPending(false); }
  }
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t`Sign in again`}</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t`Confirm your account`}</DialogTitle>
          <DialogDescription>{t`Sign in again to manage your phones. Your conversations stay in your account.`}</DialogDescription>
        </DialogHeader>
        {!capabilities && !error && <p role="status">{t`Loading…`}</p>}
        {!capabilities && error && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t`Retry`}</Button>}
        {security?.ssoLinked && capabilities?.sso?.availability === "available" && <Button disabled={pending} onClick={() => void run(async () => {
          const result = await runSsoFlow((disableRedirect, callbackURL) => authClient.signIn.social({
            disableRedirect, provider: "oidc", additionalData: { reauthenticate: true },
            callbackURL: callbackURL(window.location.href), errorCallbackURL: callbackURL(window.location.href),
          }), [window.location.href]);
          if (result.error) throw new Error(authErrorText(result.error, t`Could not continue`));
          await confirmed();
        })}>{t`Continue with your account`}</Button>}
        {security?.hasPassword && capabilities?.passwordAuth && <form className="space-y-3" onSubmit={event => {
          event.preventDefault(); void run(async () => {
            const result = await authClient.signIn.email({ email: identity!.email, password });
            if (result.error) throw new Error(authErrorText(result.error, t`Could not continue`));
            await confirmed();
          });
        }}>
          <Label htmlFor={id}>{t`Current password`}</Label>
          <Input id={id} type="password" autoComplete="current-password" value={password} disabled={pending} onChange={e => setPassword(e.target.value)} />
          <Button type="submit" disabled={pending || !password}>{t`Confirm`}</Button>
        </form>}
        {capabilities?.emailCode && <div className="space-y-3">
          {!sent ? <Button variant="outline" disabled={pending} onClick={() => void run(async () => {
            const result = await authClient.emailOtp.sendVerificationOtp({ email: identity!.email, type: "sign-in" });
            if (result.error) throw new Error(authErrorText(result.error, t`Could not continue`));
            setSent(true);
          })}>{t`Send sign-in code`}</Button> : <form className="space-y-3" onSubmit={event => {
            event.preventDefault(); void run(async () => {
              const result = await authClient.signIn.emailOtp({ email: identity!.email, otp: code });
              if (result.error) throw new Error(authErrorText(result.error, t`Could not continue`));
              await confirmed();
            });
          }}>
            <Label htmlFor={id + "-code"}>{t`Sign-in code`}</Label>
            <Input id={id + "-code"} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} disabled={pending} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" disabled={pending || code.length !== 6}>{t`Confirm`}</Button>
          </form>}
        </div>}
        {capabilities?.passkeyRpId && <PasskeySignIn disabled={pending} onSignedIn={() => void run(confirmed)} onError={setError} />}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
