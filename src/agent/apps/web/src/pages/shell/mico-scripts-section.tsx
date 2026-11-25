import { useLingui } from "@lingui/react/macro";
import { MICO_SCRIPT_REQUESTS_PER_HOUR_CHOICES, MICO_SCRIPT_TOKENS_MAX } from "@mycellios/contracts";
import { Button, Input, NativeSelect, NativeSelectOption, Switch } from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { downloadArtifactBytes } from "../../lib/artifact-open";
import { useCopyText } from "../../lib/copy-text";
import { useBoundSpaceId, useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

export function MicoScriptsSection({ botId }: { botId: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const spaceId = useBoundSpaceId();
  const settings = useQuery({
    queryKey: ["mico-script-settings", spaceId, botId],
    queryFn: () => rpc.micoScripts.get({ botId }),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopyText();
  if (!settings.data || settings.error) return null;
  const { enabled, requestsPerHour, tokens } = settings.data;
  const command = `node mycellios-cli.mjs list ${botId}`;

  async function save(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      await action();
      await settings.refetch();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return <SettingsGroup label={t`Mico Scripts`}>
    <SettingsRow label={t`Allow scripts to call this Mico`} control={
      <Switch checked={enabled} disabled={busy} aria-label={t`Allow scripts to call this Mico`}
        onCheckedChange={(next) => void save(() => rpc.micoScripts.configure({
          botId, enabled: next, requestsPerHour,
        }))} />
    } />
    {enabled ? <>
      <SettingsRow label={t`Requests per hour`} control={
        <NativeSelect size="sm" value={requestsPerHour} disabled={busy} aria-label={t`Requests per hour`}
          onChange={(event) => {
            const limit = Number(event.target.value);
            void save(() => rpc.micoScripts.configure({ botId, enabled, requestsPerHour: limit }));
          }}>
          {MICO_SCRIPT_REQUESTS_PER_HOUR_CHOICES.map((limit) => <NativeSelectOption key={limit} value={limit}>{limit}</NativeSelectOption>)}
        </NativeSelect>
      } />
      <SettingsRow label={t`Command-line tool`} description={t`Use Node.js 22 or later. Set MYCELLIOS_TOKEN or MYCELLIOS_TOKEN_FILE before running the command.`}
        control={<Button size="sm" variant="outline" onClick={() => {
          void import("../../../../../scripts/mycellios-cli.mjs?raw").then(({ default: source }) => {
            downloadArtifactBytes("mycellios-cli.mjs", "text/javascript", new TextEncoder().encode(source));
          }).catch((cause) => setError(errorText(cause)));
        }}>{t`Download CLI`}</Button>} />
      <p className="break-all px-3 py-2 text-sm"><code>{command}</code></p>
      <SettingsRow label={t`Script tokens`} description={t`Script runs use this Mico’s normal billing and approval rules.`}
        control={<Button size="sm" disabled={busy || tokens.length >= MICO_SCRIPT_TOKENS_MAX}
          onClick={() => void save(async () => setSecret((await rpc.micoScripts.issue({ botId })).token))}>
          {t`Create token`}
        </Button>} />
      {secret ? <div className="space-y-2 p-3">
        <p className="text-sm">{t`Copy this token now. It is shown only once.`}</p>
        <div className="flex flex-wrap gap-2">
          <Input readOnly autoComplete="off" spellCheck={false} value={secret} aria-label={t`New script token`} />
          <Button size="sm" onClick={() => void copy(secret)}>{copied ? t`Copied` : t`Copy token`}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>{t`Hide token`}</Button>
        </div>
      </div> : null}
    </> : null}
    {tokens.map((token) => <SettingsRow key={token.id} label={token.hint}
      control={<Button size="sm" variant="outline" disabled={busy}
        onClick={() => void save(() => rpc.micoScripts.revoke({ botId, tokenId: token.id }))}>{t`Revoke`}</Button>} />)}
    {error ? <p role="alert" className="p-3 text-sm text-destructive">{error}</p> : null}
  </SettingsGroup>;
}
