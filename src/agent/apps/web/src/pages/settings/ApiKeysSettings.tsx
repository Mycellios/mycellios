import { useLingui } from "@lingui/react/macro";
import type { MycelliosApiKey } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Input,
} from "@mycellios/ui-web";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceRpc } from "../../lib/space-rpc";

type Created = { id: string; name: string; secret: string };

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Copies a value and reports the result next to the button; the value is never logged. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useLingui();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState("copied"); }
    catch { setState("failed"); }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2_500);
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-live="polite">
      {state === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      {state === "copied" ? t`Copied` : state === "failed" ? t`Select and copy it manually` : label}
    </Button>
  );
}

export function ApiKeysSettingsPanel({ accountId }: { accountId?: string }) {
  const { t, i18n } = useLingui();
  const rpc = useSpaceRpc();
  const [keys, setKeys] = useState<MycelliosApiKey[] | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [revoking, setRevoking] = useState<MycelliosApiKey | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  function describe(error: unknown, action: "load" | "create" | "revoke"): string {
    switch (errorCode(error)) {
      case "UNAUTHORIZED": return t`Your Mycellios session expired. Sign in again to manage API keys.`;
      case "PRECONDITION_FAILED": return t`API keys are available when you sign in with your Mycellios account.`;
      case "CONFLICT": return t`You have reached the limit of active keys. Revoke one before creating another.`;
      case "FORBIDDEN": return action === "revoke"
        ? t`Mycellios Agent uses this key for your Credits, so it cannot be revoked here.`
        : t`This account cannot manage API keys.`;
      case "TOO_MANY_REQUESTS": return t`Too many requests. Wait a moment and try again.`;
      default: return action === "load"
        ? t`Could not load your API keys. Try again.`
        : action === "create" ? t`Could not create the key. Try again.` : t`Could not revoke the key. Try again.`;
    }
  }

  useEffect(() => {
    setKeys(null); setLoadError(null);
    if (!accountId) { setLoadError(t`API keys are available when you sign in with your Mycellios account.`); return; }
    const abort = new AbortController();
    void rpc.mycelliosApiKeys.list({ expectedUserId: accountId }, { signal: abort.signal })
      .then((result) => { if (abort.signal.aborted) return; setKeys(result.keys); setApiBaseUrl(result.apiBaseUrl); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setLoadError(describe(error, "load")); });
    return () => abort.abort();
    // `describe` reads only translated copy; the list follows account and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rpc, attempt]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!accountId || !trimmed || busy) return;
    setBusy("create"); setActionError(null); setCreated(null);
    try {
      const result = await rpc.mycelliosApiKeys.create({ expectedUserId: accountId, name: trimmed });
      if (!live.current) return;
      setCreated({ id: result.key.id, name: result.key.name, secret: result.secret });
      setKeys((current) => [result.key, ...(current ?? []).filter((key) => key.id !== result.key.id)]);
      setName("");
    } catch (error) {
      if (live.current) setActionError(describe(error, "create"));
    } finally {
      if (live.current) setBusy(null);
    }
  }

  async function revoke(key: MycelliosApiKey) {
    if (!accountId || busy || key.usedByAgent) return;
    setBusy("revoke"); setActionError(null);
    try {
      await rpc.mycelliosApiKeys.revoke({ expectedUserId: accountId, keyId: key.id });
      if (!live.current) return;
      setKeys((current) => (current ?? []).filter((entry) => entry.id !== key.id));
      setCreated((current) => (current?.id === key.id ? null : current));
      setRevoking(null);
    } catch (error) {
      if (live.current) { setActionError(describe(error, "revoke")); setRevoking(null); }
    } finally {
      if (live.current) setBusy(null);
    }
  }

  const date = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(i18n.locale, { dateStyle: "medium" });
  };
  const activeKeys = (keys ?? []).filter((key) => !key.revokedAt);

  return (
    <div className="rk-general-settings space-y-6" data-testid="api-keys-settings">
      <p className="px-1 text-sm text-muted-foreground">
        {t`Use a key to call Mycellios models from your own apps and scripts with any OpenAI-compatible client. Requests made with a key count against this account.`}
      </p>
      {loadError ? (
        <div role="alert" className="space-y-2 px-1 text-sm text-destructive">
          <p>{loadError}</p>
          {accountId ? <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>{t`Retry`}</Button> : null}
        </div>
      ) : keys === null ? (
        <LoadingSkeleton layout="settings" rows={3} label={t`Loading API keys…`} />
      ) : (
        <>
          {apiBaseUrl ? (
            <SettingsGroup>
              <SettingsRow
                label={t`API base URL`}
                description={<code className="break-all text-[13px]">{apiBaseUrl}</code>}
                control={<CopyButton value={apiBaseUrl} label={t`Copy URL`} />}
              />
            </SettingsGroup>
          ) : null}
          {created ? (
            <section role="status" className="space-y-3 rounded-xl border border-border bg-muted p-4" aria-label={t`New key`}>
              <p className="text-sm font-medium">{t`Copy your new key now. You will not be able to see it again.`}</p>
              <Input readOnly value={created.secret} aria-label={t`New key for ${created.name}`} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                <CopyButton value={created.secret} label={t`Copy key`} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>{t`Done`}</Button>
              </div>
            </section>
          ) : null}
          <form className="flex flex-wrap items-center gap-2 px-1" onSubmit={(event) => void create(event)}>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
              placeholder={t`Key name, for example My app`} aria-label={t`Key name`} className="min-w-0 flex-1 basis-56" />
            <Button type="submit" size="sm" disabled={!name.trim() || busy !== null}>
              <Plus aria-hidden size={14} />{busy === "create" ? t`Creating…` : t`Create key`}
            </Button>
          </form>
          {actionError ? <p role="alert" className="px-1 text-sm text-destructive">{actionError}</p> : null}
          {activeKeys.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">{t`You have no API keys yet.`}</p>
          ) : (
            <SettingsGroup title={t`Your keys`}>
              {activeKeys.map((key) => {
                const createdOn = date(key.createdAt);
                const usedOn = date(key.lastUsedAt);
                return (
                  <SettingsRow
                    key={key.id}
                    label={<span className="inline-flex min-w-0 flex-wrap items-center gap-2"><KeyRound aria-hidden size={14} className="shrink-0 text-muted-foreground" /><span className="break-words">{key.name}</span>{key.usedByAgent ? <Badge variant="secondary">{t`Used by Mycellios Agent`}</Badge> : null}</span>}
                    description={<>
                      <code className="text-[12px]">{key.prefix}…</code>
                      {" · "}{createdOn ? t`Created ${createdOn}` : t`Creation date unavailable`}
                      {" · "}{usedOn ? t`Last used ${usedOn}` : t`Never used`}
                      {key.usedByAgent ? <span className="block">{t`Mycellios Agent uses this key to pay for your Micos with Credits. It cannot be revoked here.`}</span> : null}
                    </>}
                    control={key.usedByAgent ? null : (
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => setRevoking(key)} aria-label={t`Revoke ${key.name}`}>
                        <Trash2 aria-hidden size={14} />{t`Revoke`}
                      </Button>
                    )}
                  />
                );
              })}
            </SettingsGroup>
          )}
        </>
      )}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => { if (!open && busy !== "revoke") setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`Revoke ${revoking?.name ?? ""}?`}</AlertDialogTitle>
            <AlertDialogDescription>{t`Apps that use this key will stop working immediately. This cannot be undone.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "revoke"}>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy === "revoke"} onClick={(event) => { event.preventDefault(); if (revoking) void revoke(revoking); }}>
              {busy === "revoke" ? t`Revoking…` : t`Revoke key`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
