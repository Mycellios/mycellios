import { useLingui } from "@lingui/react/macro";
import type { MycelliosLinkableProvider, MycelliosSignInMethods } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@mycellios/ui-web";
import { useEffect, useRef, useState } from "react";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import type { IdentityLinkReturn } from "../../lib/identity-link-return";
import { beginIdentityLink, forgetIdentityLink, takeIdentityLinkReturn } from "../../lib/identity-link-return";
import { useSpaceRpc } from "../../lib/space-rpc";

const PROVIDERS: { id: MycelliosLinkableProvider; name: string }[] = [
  { id: "google", name: "Google" },
  { id: "twitter", name: "X" },
];

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function providerName(provider: MycelliosLinkableProvider): string {
  return provider === "twitter" ? "X" : "Google";
}

/**
 * Google and X sign-in for the Mycellios account. Linking leaves for the provider and
 * returns to this section; the last remaining sign-in method can never be unlinked.
 * Deployments without Mycellios sign-in show nothing.
 */
export function SignInMethodsSettings({
  accountId,
  navigate = (url) => window.location.assign(url),
}: {
  accountId: string;
  navigate?: (url: string) => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [methods, setMethods] = useState<MycelliosSignInMethods | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [returned] = useState<IdentityLinkReturn | null>(() => takeIdentityLinkReturn());
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<MycelliosLinkableProvider | null>(null);
  const [unlinking, setUnlinking] = useState<{ id: string; provider: MycelliosLinkableProvider } | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  function couldNotLink(provider: string): string {
    return t`Could not link ${provider}. Try again.`;
  }

  function describe(error: unknown, action: "load" | "link" | "unlink", provider?: string): string {
    switch (errorCode(error)) {
      case "UNAUTHORIZED": return t`Your Mycellios session expired. Sign in again.`;
      case "CONFLICT": return t`Add another sign-in method before unlinking this one.`;
      case "TOO_MANY_REQUESTS": return t`Too many requests. Wait a moment and try again.`;
      default: return action === "load"
        ? t`Could not load your sign-in methods. Try again.`
        : action === "link" ? couldNotLink(provider ?? "") : t`Could not unlink ${provider}. Try again.`;
    }
  }

  useEffect(() => {
    setMethods(null); setLoadError(null);
    const abort = new AbortController();
    void rpc.mycelliosIdentities.list({ expectedUserId: accountId }, { signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) setMethods(result); })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        if (errorCode(error) === "PRECONDITION_FAILED") setHidden(true);
        else setLoadError(describe(error, "load"));
      });
    return () => abort.abort();
    // `describe` reads only translated copy; the list follows the account and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rpc, attempt]);

  async function link(provider: MycelliosLinkableProvider) {
    if (busy) return;
    setBusy(provider); setActionError(null);
    try {
      const state = beginIdentityLink(provider);
      const { url } = await rpc.mycelliosIdentities.link({ expectedUserId: accountId, provider, state });
      navigate(url);
    } catch (error) {
      forgetIdentityLink();
      if (live.current) { setActionError(describe(error, "link", providerName(provider))); setBusy(null); }
    }
  }

  async function unlink(target: { id: string; provider: MycelliosLinkableProvider }) {
    if (busy) return;
    setBusy(target.provider); setActionError(null);
    try {
      await rpc.mycelliosIdentities.unlink({ expectedUserId: accountId, identityId: target.id });
      if (!live.current) return;
      setMethods((current) => current && {
        ...current,
        identities: current.identities.filter((identity) => identity.id !== target.id),
      });
      setUnlinking(null);
    } catch (error) {
      if (live.current) { setActionError(describe(error, "unlink", providerName(target.provider))); setUnlinking(null); }
    } finally {
      if (live.current) setBusy(null);
    }
  }

  if (hidden) return null;
  const rows = methods
    ? PROVIDERS.flatMap((provider) => {
        const identity = methods.identities.find((entry) => entry.provider === provider.id);
        return identity || methods.available[provider.id] ? [{ ...provider, identity }] : [];
      })
    : [];
  if (methods && rows.length === 0 && !returned) return null;
  const onlyMethod = (methods?.identities.length ?? 0) < 2;
  const provider = returned ? providerName(returned.provider) : "";
  const unlinkName = unlinking ? providerName(unlinking.provider) : "";

  return (
    <div className="space-y-2" data-testid="sign-in-methods">
      {returned?.result === "linked" ? (
        <p role="status" className="px-1 text-sm">{t`${provider} is now linked to your account.`}</p>
      ) : returned?.result === "failed" ? (
        <p role="alert" className="px-1 text-sm text-destructive">
          {returned.code === "identity_already_exists"
            ? t`This ${provider} account is already linked to another Mycellios account.`
            : couldNotLink(provider)}
        </p>
      ) : null}
      {loadError ? (
        <div role="alert" className="space-y-2 px-1 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>{t`Retry`}</Button>
        </div>
      ) : methods === null ? (
        <LoadingSkeleton layout="settings" rows={2} label={t`Loading sign-in methods…`} />
      ) : rows.length > 0 ? (
        <SettingsGroup title={t`Sign-in methods`}>
          {rows.map(({ id, name, identity }) => {
            const email = identity?.email;
            return (
            <SettingsRow
              key={id}
              label={name}
              description={identity
                ? email ? t`Linked as ${email}` : t`Linked`
                : t`Not linked`}
              control={identity ? (
                <Button type="button" variant="outline" size="sm" disabled={busy !== null || onlyMethod}
                  title={onlyMethod ? t`This is your only sign-in method.` : undefined}
                  aria-label={t`Unlink ${name}`}
                  onClick={() => setUnlinking({ id: identity.id, provider: id })}>
                  {t`Unlink`}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={busy !== null}
                  aria-label={t`Link ${name}`} onClick={() => void link(id)}>
                  {busy === id ? t`Opening…` : t`Link`}
                </Button>
              )}
            />
            );
          })}
        </SettingsGroup>
      ) : null}
      {actionError ? <p role="alert" className="px-1 text-sm text-destructive">{actionError}</p> : null}
      <AlertDialog open={unlinking !== null} onOpenChange={(open) => { if (!open && busy === null) setUnlinking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`Unlink ${unlinkName}?`}</AlertDialogTitle>
            <AlertDialogDescription>{t`You will no longer be able to sign in with it. You can link it again later.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy !== null} onClick={(event) => { event.preventDefault(); if (unlinking) void unlink(unlinking); }}>
              {busy !== null ? t`Unlinking…` : t`Unlink`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
