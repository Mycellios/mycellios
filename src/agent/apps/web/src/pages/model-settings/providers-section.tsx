import { Trans, useLingui } from "@lingui/react/macro";
import { ANTSEED_PROVIDER_ID, MAX_MODEL_CONNECTION_LABEL, OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { matchesSearchQuery } from "@rakazo/core";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ChevronRight, Network, Plus, Search, SlidersHorizontal } from "lucide-react";
import { ProviderLogo } from "../../components/ProviderLogo";
import type { ReactNode, Ref } from "react";
import { useId, useRef, useState } from "react";
import type { ModelCredential } from "../../lib/model-auth";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import type { ConnectableProvider } from "./role-model-picker";
import type { ProviderIntegration } from "./provider-detail";
import type { ProviderRuntime } from "./provider-runtime";

const providerKey = (provider: ConnectableProvider) => `${provider.id}:${provider.baseUrl ?? ""}`;
const rowClass = "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent/50 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50";

/** Every connection the member has, with the way to add another, even for a connected provider. */
export function ProvidersSection({
  credentials,
  providers,
  name: nameOf,
  disabled,
  onAdd,
  onOpen,
  onClose,
  panel,
  panelAt,
  primary,
  primaryConnected = false,
  showDirectory = false,
  runtimes = [],
  runtimeDetails,
  onOpenIntegration,
  integrationTriggers,
}: {
  credentials: ModelCredential[];
  /** Every provider that can be connected, connected ones included. */
  providers: ConnectableProvider[];
  /** A connection's name, such as "OpenAI" or "OpenAI (Work)". */
  name: (credential: ModelCredential) => string;
  disabled?: boolean;
  onAdd: (provider: ConnectableProvider, directoryKey?: string) => void;
  onOpen: (credential: ModelCredential) => void;
  onClose?: () => void;
  /** The connection form, shown under the connection it belongs to or after the list. */
  panel?: ReactNode;
  /** The connection id the form belongs to, or "add" for a new one. */
  panelAt?: string | null;
  /** Built-in account provider, ahead of optional external connections. */
  primary?: ReactNode;
  primaryConnected?: boolean;
  showDirectory?: boolean;
  runtimes?: readonly ProviderRuntime[];
  runtimeDetails?: (runtime: ProviderRuntime) => ReactNode;
  onOpenIntegration?: (id: ProviderIntegration) => void;
  integrationTriggers?: Partial<Record<ProviderIntegration, Ref<HTMLButtonElement>>>;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [openRuntime, setOpenRuntime] = useState<string | null>(null);
  const matches = (...labels: string[]) => !showDirectory || !query.trim() || matchesSearchQuery(query, ...labels);
  const isCustom = (provider: ConnectableProvider) => provider.id === OPENAI_COMPATIBLE_PROVIDER_ID && !provider.baseUrl;
  const antseedCredentials = credentials.filter((credential) => credential.provider === ANTSEED_PROVIDER_ID);
  const antseedConnected = antseedCredentials.some((credential) => credential.hasKey);
  const genericCredentials = onOpenIntegration ? credentials.filter((credential) => credential.provider !== ANTSEED_PROVIDER_ID) : credentials;
  const connectedIds = new Set(credentials.map((credential) => credential.provider));
  const available = showDirectory ? providers.filter((provider) =>
    (!onOpenIntegration || provider.id !== ANTSEED_PROVIDER_ID) &&
    (matches(provider.name, provider.id, isCustom(provider) ? t`Custom provider` : "") || panelAt === `new:${providerKey(provider)}`) &&
    (provider.baseUrl || isCustom(provider) || !connectedIds.has(provider.id)),
  ) : [];
  const visibleCredentials = genericCredentials.filter((credential) => matches(nameOf(credential), credential.provider) || panelAt === credential.id);
  const visibleRuntimes = runtimes.filter((runtime) =>
    (runtime.id === "codex" || runtime.id === "claude") && matches(runtime.name, runtime.id),
  );
  const integrationRow = (id: ProviderIntegration, name: string, status: string, icon: ReactNode) => (
    <li data-testid={`${id}-provider`}>
      <button ref={integrationTriggers?.[id]} type="button" className={rowClass} disabled={disabled} onClick={() => onOpenIntegration?.(id)}>
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">{status}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
      </button>
    </li>
  );
  // Go and Zen are connections in the provider directory. An installed OpenCode
  // executable is an implementation detail, not a second connection to choose.
  const antseedRow = onOpenIntegration && matches("AntSeed", ...antseedCredentials.map(nameOf)) ? integrationRow(
    "antseed", "AntSeed", antseedConnected ? t`Connected` : t`Not connected`,
    <Network aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
  ) : null;
  const showPrimary = Boolean(primary && matches("Mycellios"));
  function runtimeRow(runtime: ProviderRuntime) {
    const expanded = openRuntime === runtime.id;
    return <li key={runtime.id}>
      <button type="button" className={rowClass} aria-expanded={expanded} disabled={disabled}
        onClick={() => setOpenRuntime(expanded ? null : runtime.id)}>
        <ProviderLogo name={runtime.name} providerId={runtime.id} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{runtime.name}</span>
          <span className="block text-xs text-muted-foreground">
            {runtime.available ? t`Available on this server` : runtime.canInstall ? t`Download available` : t`Not installed`}
          </span>
        </span>
        <ChevronRight aria-hidden className={`size-4 shrink-0 text-muted-foreground ${expanded ? "rotate-90" : "rtl:rotate-180"}`} />
      </button>
      {expanded ? <div className="px-3 pb-3">{runtimeDetails?.(runtime)}</div> : null}
    </li>;
  }
  return (
    <section className="mb-8" data-testid="model-providers">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-medium text-foreground">
          {showDirectory ? t`Connected providers` : t`Providers`}
        </h3>
        {showDirectory ? (
          <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            className="w-full ps-8"
            aria-label={t`Search providers`}
            placeholder={t`Search providers`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          /></div>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {showPrimary && (!showDirectory || primaryConnected) ? primary : null}
        {visibleCredentials
          // Saving a key reorders the account's connections; this list stays put.
          .sort((left, right) => nameOf(left).localeCompare(nameOf(right)))
          .map((credential) => (
            <li key={credential.id} data-testid={`model-provider-${credential.id}`}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(credential)}
                aria-expanded={panelAt === credential.id}
                className={rowClass}
              >
                <ProviderLogo name={nameOf(credential)} providerId={credential.provider} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{nameOf(credential)}</span>
                  {showDirectory ? <span className="block text-xs text-muted-foreground">{t`Connected`}</span> : null}
                </span>
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${panelAt === credential.id ? "rotate-90" : ""}`}
                  aria-hidden
                />
              </button>
              {panelAt === credential.id ? <div className="px-3 pb-3">{panel}</div> : null}
            </li>
          ))}
        {antseedConnected ? antseedRow : null}
        {visibleRuntimes.filter((runtime) => runtime.available).map(runtimeRow)}
        {!showDirectory || !query.trim() ? <li>
          <AddProvider providers={providers} disabled={disabled} onPick={onAdd} />
        </li> : null}
        {showDirectory && !(showPrimary && primaryConnected) &&
          !(antseedRow && antseedConnected) &&
          !visibleCredentials.length && !visibleRuntimes.some((runtime) => runtime.available) ?
          <li className="px-3 py-2 text-sm text-muted-foreground">{t`No results`}</li> : null}
      </ul>
      {panelAt === "add" ? panel : null}
      {showDirectory ? (
        <div className="mt-6">
          <h3 className="mb-2.5 text-[15px] font-medium text-foreground">{t`Other providers`}</h3>
          {available.length || (showPrimary && !primaryConnected) ||
            (antseedRow && !antseedConnected) || visibleRuntimes.some((runtime) => !runtime.available) ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {showPrimary && !primaryConnected ? primary : null}
              {!antseedConnected ? antseedRow : null}
              {visibleRuntimes.filter((runtime) => !runtime.available).map(runtimeRow)}
              {available.map((provider) => {
                const key = providerKey(provider);
                const expanded = panelAt === `new:${key}`;
                const custom = isCustom(provider);
                return <li key={key}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-expanded={expanded}
                    className={rowClass}
                    onClick={() => expanded ? onClose?.() : onAdd(provider, key)}
                  >
                    {custom ? <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      : <ProviderLogo name={provider.name} providerId={provider.id} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{custom ? t`Custom provider` : provider.name}</span>
                      <span className="block text-xs text-muted-foreground">{custom ? t`Connect your own model endpoint` : t`Not connected`}</span>
                    </span>
                    <ChevronRight className={`size-4 shrink-0 text-muted-foreground ${expanded ? "rotate-90" : "rtl:rotate-180"}`} aria-hidden />
                  </button>
                  {expanded ? <div className="px-3 pb-3">{panel}</div> : null}
                </li>;
              })}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t`No results`}</p>}
        </div>
      ) : null}
    </section>
  );
}

/** A connection's editable name, saved on its own. */
export function ConnectionNameField({
  credential,
  onRenamed,
}: {
  credential: ModelCredential;
  onRenamed: () => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState(credential.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  return (
    <form
      className="mb-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || saving || trimmed === credential.label) return;
        setSaving(true);
        setError(null);
        rpc.models
          .rename({ credentialId: credential.id, label: trimmed })
          .then(onRenamed, (err: unknown) =>
            setError(errorText(err, t`Could not rename connection`)),
          )
          .finally(() => setSaving(false));
      }}
    >
      <label htmlFor={nameId} className="block text-[13.5px] text-muted-foreground">
        <Trans>Name</Trans>
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id={nameId}
          maxLength={MAX_MODEL_CONNECTION_LABEL}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 text-foreground"
        />
        {trimmed && trimmed !== credential.label ? (
          <Button type="submit" variant="secondary" className="h-10" disabled={saving}>
            {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[13.5px] text-destructive">{error}</p> : null}
    </form>
  );
}

function AddProvider({
  providers,
  disabled,
  onPick,
}: {
  providers: ConnectableProvider[];
  disabled?: boolean;
  onPick: (provider: ConnectableProvider) => void;
}) {
  const { t } = useLingui();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matching = providers.filter((provider) => provider.name.toLowerCase().includes(needle));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setQuery("");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-b-xl px-3 py-3 text-start text-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" aria-hidden />
            <Trans>Add provider</Trans>
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        initialFocus={searchRef}
        className="w-[min(360px,var(--available-width))] gap-0 overflow-hidden p-0 motion-reduce:animate-none"
      >
        <Command label={t`Add provider`} shouldFilter={false} loop>
          <CommandInput
            ref={searchRef}
            value={query}
            onValueChange={setQuery}
            aria-label={t`Add provider`}
            placeholder={t`Search`}
          />
          <CommandList className="rk-scroll max-h-80">
            <CommandEmpty>
              <Trans>No results</Trans>
            </CommandEmpty>
            <CommandGroup>
              {matching.map((provider) => (
                <CommandItem
                  key={`${provider.id}:${provider.baseUrl ?? ""}`}
                  value={`${provider.id}:${provider.baseUrl ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onPick(provider);
                  }}
                >
                  <span className="min-w-0 truncate">{provider.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
