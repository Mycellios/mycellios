import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";

type InstalledEngine = Exclude<NonNullable<Bot["agentEngine"]>, "pi">;

export function InstalledAgentOnboarding({
  onSelect,
}: {
  onSelect: (engine: InstalledEngine) => Promise<void>;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [engines, setEngines] = useState<Array<{ id: InstalledEngine; name: string }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function find() {
    setBusy(true);
    setError("");
    try {
      const available = (await rpc.engines.list()).filter(
        (engine): engine is typeof engine & { id: InstalledEngine } =>
          (engine.id === "codex" || engine.id === "claude") && engine.available,
      );
      const found = available;
      setEngines(found);
      if (!found.length)
        setError(t`Install and sign in to an agent on the computer running this server first.`);
    } catch {
      setError(t`Could not check agent engines`);
    } finally {
      setBusy(false);
    }
  }
  async function select(engine: InstalledEngine) {
    setBusy(true);
    setError("");
    try {
      await onSelect(engine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not change agent engine`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-2">
      <Button variant="ghost" disabled={busy} onClick={() => void find()}>
        <Trans>Use an installed agent</Trans>
      </Button>
      <div className="flex flex-wrap gap-2">
        {engines.map((engine) => (
          <Button
            key={engine.id}
            variant="outline"
            disabled={busy}
            onClick={() => void select(engine.id)}
          >
            {engine.name}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
