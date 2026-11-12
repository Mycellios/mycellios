import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { CircleAlert, CircleCheck, LoaderCircle, MousePointer2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ComputersUnavailableHint } from "../../components/ComputersUnavailableHint";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";
import { refreshSandboxFromServer, sandboxProviderLabel } from "../../lib/computer-sandbox";
import "./computer-use-settings.css";

type Phase = "checking" | "configured" | "unavailable" | "unknown" | "error";
export function computerSetupPhase(provider: string | null | undefined): Exclude<Phase, "checking" | "error"> {
  if (provider === "none" || provider === "") return "unavailable";
  return ["docker", "desktop", "e2b", "daytona", "boat"].includes(provider ?? "") ? "configured" : "unknown";
}

export function ComputerSettingsPanel({ sandboxProvider, onSandboxProviderChange, onRecoveryDismissed, showTechnicalDetails = false }: {
  sandboxProvider?: string | null;
  showTechnicalDetails?: boolean;
  onSandboxProviderChange?: (provider: string) => void;
  onRecoveryDismissed?: () => void;
}) {
  const { t } = useLingui();
  const [phase, setPhase] = useState<Phase>("checking");
  const [provider, setProvider] = useState<string | null>(null);
  const request = useRef(0), locked = useRef(false);
  const callbacks = useRef({ onSandboxProviderChange, onRecoveryDismissed });
  callbacks.current = { onSandboxProviderChange, onRecoveryDismissed };
  const native = !!desktopBridge()?.computer;
  async function check(manual = false) {
    if (locked.current) return;
    locked.current = true; const id = ++request.current; setPhase("checking"); setProvider(null);
    try {
      const result = await refreshSandboxFromServer();
      if (id !== request.current) return;
      const next = computerSetupPhase(result.sandboxProvider);
      setProvider(result.sandboxProvider); setPhase(next);
      if (manual && next === "configured" && result.sandboxProvider !== sandboxProvider) callbacks.current.onSandboxProviderChange?.(result.sandboxProvider);
    } catch {
      if (id === request.current) { setPhase("error"); setProvider(null); }
    } finally { if (id === request.current) locked.current = false; }
  }
  useEffect(() => {
    void check();
    return () => { request.current++; locked.current = false; };
  }, [sandboxProvider]);
  useEffect(() => () => callbacks.current.onRecoveryDismissed?.(), []);
  const title = phase === "checking" ? t`Checking computer setup…` : phase === "configured" ? t`The work environment is configured` : phase === "unavailable" ? t`Computer tools need setup` : phase === "error" ? t`Could not verify computer setup` : t`Computer access is not confirmed`;
  const description = phase === "configured" ? t`The server reports a configured environment for your Micos. Screen access and each Mico’s connection are checked separately.`
    : phase === "unavailable" ? t`Chat and connected apps still work. Configure a work environment to use computer tools.`
    : phase === "checking" ? t`Checking the server connection and the environment reported for your account.`
    : phase === "error" ? t`Check your connection and try again. A previous status does not confirm current access.`
    : t`The server has not reported a supported work environment. No access is assumed.`;
  const Icon = phase === "checking" ? LoaderCircle : phase === "configured" ? CircleCheck : CircleAlert;
  return <div data-testid="computers-setup-settings" className="rk-general-settings space-y-6">
    <div className="computer-use-status" data-phase={phase} role="status" aria-live="polite" aria-busy={phase === "checking"}>
      <Icon aria-hidden className={phase === "checking" ? "animate-spin" : undefined} size={18} />
      <div><p className="font-medium">{title}</p><p>{description}</p></div>
    </div>
    <SettingsGroup title={t`Access and connection`}>
      <SettingsRow label={t`This device`} description={native ? t`Local computer access is authorized when you connect a Mico in Desktop. This check does not grant new permissions.` : t`You are using the web app. This page does not grant access to applications or files on this device.`}
        control={<span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><MousePointer2 aria-hidden size={15} />{native ? t`Mycellios Desktop` : t`Web app`}</span>} />
      <SettingsRow label={t`Mico work environment`} description={t`Choose each Mico’s computer from its chat tools. A configured environment does not confirm a screen connection.`}
        control={<span className="text-sm text-muted-foreground">{provider && phase !== "checking" ? provider === "none" || provider === "" ? t`Not configured` : provider === "fake" ? t`Test environment` : sandboxProviderLabel(provider) : t`Not confirmed`}</span>} />
      <SettingsRow label={t`Check connection`} description={t`Refresh the status without restarting tasks or changing permissions.`} control={<Button variant="outline" size="sm" disabled={phase === "checking"} onClick={() => void check(true)}>{phase === "checking" ? t`Checking…` : t`Check again`}</Button>} />
    </SettingsGroup>
    {phase === "unavailable" && showTechnicalDetails && <ComputersUnavailableHint sandboxProvider={provider} showRetry={false} showTechnicalDetails className="text-sm text-muted-foreground" />}
  </div>;
}
