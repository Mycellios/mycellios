import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button, Disclosure, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useId, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";

type InstalledEngine = Exclude<NonNullable<Bot["agentEngine"]>, "pi">;

export function AgentEngineSettings({
  bot,
  onSave,
}: {
  bot: Bot;
  onSave: (patch: { agentEngine: NonNullable<Bot["agentEngine"]> }) => Promise<void>;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const id = useId();
  const [choices, setChoices] = useState<
    Array<{ id: NonNullable<Bot["agentEngine"]>; name: string; available: boolean }>
  >([]);
  const [value, setValue] = useState(bot.agentEngine ?? "pi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(open: boolean) {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      setChoices(await rpc.engines.list());
    } catch {
      setError(t`Could not check agent engines`);
    } finally {
      setBusy(false);
    }
  }
  async function save(agentEngine: NonNullable<Bot["agentEngine"]>) {
    setBusy(true);
    setError("");
    try {
      await onSave({ agentEngine });
      setValue(agentEngine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not change agent engine`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Disclosure summary={t`Agent engine`} onOpenChange={(open) => void load(open)}>
      <div className="space-y-2 py-3">
        <label htmlFor={id} className="text-sm">
          <Trans>Engine on the server computer</Trans>
        </label>
        <NativeSelect
          id={id}
          value={value}
          disabled={busy || !choices.length}
          onChange={(event) => void save(event.target.value as NonNullable<Bot["agentEngine"]>)}
        >
          {choices.length ? (
            choices.map((choice) => (
              <NativeSelectOption key={choice.id} value={choice.id} disabled={!choice.available}>
                {choice.name}
                {choice.available ? "" : t` (not installed)`}
              </NativeSelectOption>
            ))
          ) : (
            <NativeSelectOption value={value}>{value}</NativeSelectOption>
          )}
        </NativeSelect>
        {value !== "pi" ? (
          <p className="text-sm text-muted-foreground">
            {value === "opencode"
              ? t`Uses OpenCode in an isolated profile without your local sign-in.`
              : t`Uses this engine’s local sign-in and default model.`}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Disclosure>
  );
}

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
      const found = (await rpc.engines.list()).filter(
        (engine): engine is typeof engine & { id: InstalledEngine } =>
          engine.id !== "pi" && engine.available,
      );
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
