import { Trans, useLingui } from "@lingui/react/macro";
import type { SpaceMemoryConfig } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Field,
  FieldLabel,
  OptionSelect,
  Spinner,
  Toggle,
} from "@rakazo/ui-web";
import { XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { SettingsLabel } from "../components/SettingsRows";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { SpaceMemorySection } from "./KnowledgeSection";
import {
  defaultMemoryProviderSettings,
  MEMORY_PROVIDER_SETTINGS,
  type MemoryProviderConnectionDraft,
  memoryProviderSettings,
} from "./memory-providers/registry";

function ScopePicker({
  value,
  disabled,
  onChange,
}: {
  value: "isolated" | "shared";
  disabled: boolean;
  onChange: (scope: "isolated" | "shared") => void;
}) {
  const labelId = useId();
  const { t } = useLingui();
  return (
    <Field aria-labelledby={labelId}>
      <SettingsLabel
        name={t`Default scope`}
        help={t`Isolated keeps each agent's memory separate. Shared lets agents in this space use shared facts.`}
      >
        <FieldLabel id={labelId}>
          <Trans>Default scope</Trans>
        </FieldLabel>
      </SettingsLabel>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["isolated", "shared"] as const).map((option) => (
          <Toggle
            key={option}
            pressed={value === option}
            disabled={disabled}
            onPressedChange={() => onChange(option)}
            className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
          >
            {option === "isolated" ? <Trans>Isolated</Trans> : <Trans>Shared</Trans>}
          </Toggle>
        ))}
      </div>
    </Field>
  );
}

export function MemorySettingsOverlay({
  onClose,
  config,
  onConfigChange,
  embedded = false,
  onBusyChange,
  onFormStateChange,
}: {
  onClose: () => void;
  config: SpaceMemoryConfig | null | undefined;
  onConfigChange: (config: SpaceMemoryConfig | null) => void;
  /** Render panel body only for the shared Settings shell. */
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onFormStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const providerSelectId = useId();
  const defaultRegistration = defaultMemoryProviderSettings();
  const [selectedProvider, setSelectedProvider] = useState(
    config?.provider ?? defaultRegistration.id,
  );
  const [defaultScope, setDefaultScope] = useState<"isolated" | "shared">(
    config?.defaultMemoryScope ?? "isolated",
  );
  const [pending, setPending] = useState<"connect" | "disconnect" | "scope" | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setSelectedProvider(config.provider);
      setDefaultScope(config.defaultMemoryScope);
      return;
    }
    if (config === null && !memoryProviderSettings(selectedProvider)) {
      setSelectedProvider(defaultRegistration.id);
    }
  }, [config, defaultRegistration.id, selectedProvider]);

  const registration = memoryProviderSettings(config?.provider ?? selectedProvider);
  const busy = pending !== null;
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onFormStateChange?.({ busy, dirty });
  }, [onFormStateChange, busy, dirty]);
  useEffect(() => () => onFormStateChange?.({ busy: false, dirty: false }), [onFormStateChange]);

  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  function markPending(next: "connect" | "disconnect" | "scope" | null) {
    setPending(next);
    onBusyChange?.(next !== null);
  }

  async function connect(draft: MemoryProviderConnectionDraft) {
    if (!registration) return false;
    setError(null);
    markPending("connect");
    try {
      const next = await rpc.memory.connectProvider({
        provider: registration.id,
        ...draft,
        defaultMemoryScope: defaultScope,
      });
      onConfigChange(next);
      setDirty(false);
      return true;
    } catch (err) {
      setError(errorText(err, t`Could not connect ${registration.name}`));
      return false;
    } finally {
      markPending(null);
    }
  }

  async function disconnect() {
    setError(null);
    markPending("disconnect");
    try {
      await rpc.memory.disconnectProvider();
      setAddingProvider(false);
      onConfigChange(null);
      setDirty(false);
    } catch (err) {
      setError(errorText(err, t`Could not disconnect memory provider`));
    } finally {
      markPending(null);
    }
  }

  async function updateDefaultScope(scope: "isolated" | "shared") {
    if (scope === defaultScope) return;
    setError(null);
    markPending("scope");
    try {
      const next = await rpc.memory.setDefaultScope({ defaultMemoryScope: scope });
      onConfigChange(next);
      setDirty(false);
    } catch (err) {
      setError(errorText(err, t`Could not update the default memory scope`));
    } finally {
      markPending(null);
    }
  }

  const body = (
    <>
      {!embedded ? (
        <div className="flex items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <div>
            <DialogTitle className="text-heading2 font-medium text-foreground">
              <Trans>Memory</Trans>
            </DialogTitle>
          </div>
          <DialogClose
            aria-label={t`Close memory settings`}
            disabled={busy}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <XIcon />
          </DialogClose>
        </div>
      ) : null}

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
        <div className="min-w-0 max-w-xl space-y-5">
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

          <SpaceMemorySection />

          {config === undefined ? (
            <p className="text-[13px] text-muted-foreground">
              <Spinner aria-label={t`Loading memory settings…`} />
            </p>
          ) : config ? (
            <section className="rounded-xl border border-border px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-heading3 font-medium text-foreground">
                  {registration?.name ?? config.provider}
                </h3>
                <span className="text-[13px] text-success">
                  <Trans>Connected</Trans>
                </span>
              </div>
              <p className="mt-1 break-words text-[13px] text-muted-foreground">
                {registration?.connectedLabel(config) ?? config.provider}
              </p>
              <div className="mt-4">
                <ScopePicker
                  value={defaultScope}
                  disabled={busy}
                  onChange={(scope) => void updateDefaultScope(scope)}
                />
              </div>
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
                className="mt-5"
              >
                {pending === "disconnect" ? (
                  <Trans>Disconnecting…</Trans>
                ) : (
                  <Trans>Disconnect</Trans>
                )}
              </Button>
            </section>
          ) : !addingProvider ? (
            <Button
              variant="outline"
              type="button"
              onClick={() => setAddingProvider(true)}
              className="rounded-full"
            >
              <Trans>Connect memory provider</Trans>
            </Button>
          ) : registration ? (
            <section className="rounded-xl border border-border px-4 py-4">
              <h3 className="text-heading3 font-medium text-foreground">
                <SettingsLabel
                  name={t`Memory provider`}
                  help={t`An optional service that helps agents find saved information by meaning. Connecting it can send memory content to that provider.`}
                >
                  <span id={providerSelectId}>
                    <Trans>Provider</Trans>
                  </span>
                </SettingsLabel>
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                <Trans>Lets bots save and recall facts by meaning, alongside MEMORY.md.</Trans>
              </p>
              {MEMORY_PROVIDER_SETTINGS.length > 1 ? (
                <div className="mt-3">
                  <OptionSelect
                    aria-label={t`Memory provider`}
                    className="w-full"
                    value={selectedProvider}
                    disabled={busy}
                    onValueChange={setSelectedProvider}
                    options={MEMORY_PROVIDER_SETTINGS.map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                    }))}
                  />
                </div>
              ) : (
                <p className="mt-3 text-[14px] text-foreground">{registration.name}</p>
              )}

              <div className="mt-4">
                <ScopePicker value={defaultScope} disabled={busy} onChange={setDefaultScope} />
              </div>

              <registration.SettingsForm busy={busy} onConnect={connect} />
            </section>
          ) : (
            <p className="text-[13px] text-destructive">
              <Trans>The selected memory provider is not available in this build.</Trans>
            </p>
          )}
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div
        data-testid="memory-settings"
        onInputCapture={() => setDirty(true)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {body}
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (busy) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(760px,calc(100%-2rem))] w-[560px] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[min(760px,calc(100%-5rem))] sm:max-w-[calc(100%-5rem)]"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
