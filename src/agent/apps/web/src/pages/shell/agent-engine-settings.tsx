import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@mycellios/contracts";
import { Spinner } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import { ChoiceList, ChoiceRow } from "../onboarding/onboarding-ui";
import { useSpaceRpc } from "../../lib/space-rpc";

type InstalledEngine = Exclude<NonNullable<Bot["agentEngine"]>, "pi">;

export function InstalledAgentOnboarding({
  onSelect,
}: {
  onSelect: (engine: InstalledEngine) => Promise<void>;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [engines, setEngines] = useState<Array<{ id: InstalledEngine; name: string }>>([]);
  const [busy, setBusy] = useState<InstalledEngine | null>(null);
  const [error, setError] = useState("");
  // Agents installed on the computer that runs this server appear without an extra search step.
  useEffect(() => {
    let alive = true;
    void rpc.engines
      .list()
      .then((list) => {
        if (!alive) return;
        setEngines(
          list.filter(
            (engine): engine is typeof engine & { id: InstalledEngine } =>
              (engine.id === "codex" || engine.id === "claude" || engine.id === "opencode") && engine.available,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rpc]);
  async function select(engine: InstalledEngine) {
    setBusy(engine);
    setError("");
    try {
      await onSelect(engine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not change agent engine`);
      setBusy(null);
    }
  }
  if (!engines.length) return null;
  return (
    <section className="mt-6" data-testid="installed-agents">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">
        <Trans>On this computer</Trans>
      </h2>
      <ChoiceList>
        {engines.map((engine) => (
          <ChoiceRow
            key={engine.id}
            title={engine.name}
            aria-label={engine.name}
            disabled={busy !== null}
            busy={busy === engine.id ? <Spinner className="text-muted-foreground" /> : undefined}
            onClick={() => void select(engine.id)}
          />
        ))}
      </ChoiceList>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
