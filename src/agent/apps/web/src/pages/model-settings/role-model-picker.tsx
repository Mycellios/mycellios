import { Trans, useLingui } from "@lingui/react/macro";
import { isOpenAiCompatibleProvider, productBrand } from "@rakazo/contracts";
import { filterModelCatalog } from "@rakazo/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelCatalogEntry } from "../../lib/model-auth";

/** `baseUrl` presets an OpenAI-compatible server, such as Ollama Cloud. */
export type ConnectableProvider = { id: string; name: string; baseUrl?: string };

/** A model on one connection; `providerName` is that connection's name. */
export type RoleModelOption = ModelCatalogEntry & { credentialId?: string };

const optionValue = (option: RoleModelOption) =>
  `${option.provider}:${option.id}:${option.credentialId ?? ""}`;

/**
 * One picker for every model a role can use: connected models pick directly, and
 * providers that still need a connection hand off to the connect dialog.
 */
export function RoleModelPicker({
  trigger,
  label,
  options,
  providers,
  defaultOption,
  disabled,
  onPick,
  onConnect,
  reopen,
  onReopened,
  loading = false,
  catalogError,
  onOpenChange,
}: {
  trigger: ReactElement;
  label: string;
  options: RoleModelOption[];
  providers: ConnectableProvider[];
  /** The deployment's model, offered to clear the slot back to it. */
  defaultOption?: string;
  disabled?: boolean;
  onPick: (option: RoleModelOption | null) => void;
  onConnect: (provider: ConnectableProvider) => void;
  /** Opens the picker searching for `query`, e.g. a provider that just connected. */
  reopen?: { query: string; key: number };
  /**
   * Called when a picker opened by `reopen` closes. Until then the request stands, so a row
   * that is replaced while its picker is open (a reload settling) reopens in its new row.
   */
  onReopened?: () => void;
  loading?: boolean;
  catalogError?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const grouped = new Map<string, RoleModelOption[]>();
    for (const option of filterModelCatalog(options, query) as RoleModelOption[]) {
      const name = option.providerName ?? option.provider;
      grouped.set(name, [...(grouped.get(name) ?? []), option]);
    }
    return [...grouped].sort(([left], [right]) => Number(right === productBrand.shortName) - Number(left === productBrand.shortName));
  }, [options, query]);
  const needle = query.trim().toLowerCase();
  const exactOptions: RoleModelOption[] = [];
  if (query.trim()) {
    const seen = new Set<string>();
    for (const connection of options) {
      if (connection.providerName === productBrand.shortName || !isOpenAiCompatibleProvider(connection.provider) || !connection.credentialId || seen.has(connection.credentialId)) continue;
      seen.add(connection.credentialId);
      if (options.some(option => option.credentialId === connection.credentialId && option.id === query.trim())) continue;
      exactOptions.push({ ...connection, id: query.trim(), label: query.trim() });
    }
  }
  const matchingProviders = providers.filter((provider) =>
    provider.name.toLowerCase().includes(needle),
  );
  const values = [
    ...(defaultOption && !needle ? ["default"] : []),
    ...groups.flatMap(([, entries]) => entries.map(optionValue)),
    ...exactOptions.map(option => `exact:${optionValue(option)}`),
    ...matchingProviders.map((provider) => `connect:${provider.id}:${provider.baseUrl ?? ""}`),
  ];
  // The first row is active whenever the list changes, so Enter always picks something.
  const [activeValue, setActiveValue] = useState("");
  const firstValue = values[0] ?? "";
  useEffect(() => {
    setActiveValue(firstValue);
  }, [firstValue]);
  const fromReopen = useRef(false);
  const close = () => {
    setOpen(false);
    onOpenChange?.(false);
    if (!fromReopen.current) return;
    fromReopen.current = false;
    reopened.current?.();
  };
  // Keyed on the request, so later renders of the same request do not reopen it.
  const reopenKey = reopen?.key;
  const reopenQuery = useRef(reopen?.query);
  reopenQuery.current = reopen?.query;
  const reopened = useRef(onReopened);
  reopened.current = onReopened;
  const openChanged = useRef(onOpenChange);
  openChanged.current = onOpenChange;
  useEffect(() => {
    if (reopenKey === undefined) return;
    setQuery(reopenQuery.current ?? "");
    setOpen(true);
    openChanged.current?.(true);
    fromReopen.current = true;
  }, [reopenKey]);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) return close();
        setQuery("");
        setOpen(true);
        onOpenChange?.(true);
      }}
    >
      <PopoverTrigger render={trigger} aria-label={label} disabled={disabled} />
      <PopoverContent
        align="start"
        sideOffset={6}
        initialFocus={searchRef}
        className="w-[min(360px,var(--available-width))] gap-0 overflow-hidden p-0 motion-reduce:animate-none"
      >
        <Command
          ref={(command) => {
            if (!command || !searchRef.current) return;
            // cmdk can keep a stale selected item when the controlled value changes before
            // filtered rows commit, so the input names the committed active row itself.
            const active = [...command.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
              (item) => item.dataset.value === activeValue,
            );
            if (active) searchRef.current.setAttribute("aria-activedescendant", active.id);
            else searchRef.current.removeAttribute("aria-activedescendant");
          }}
          label={t`Search models`}
          shouldFilter={false}
          loop
          value={activeValue}
          onValueChange={setActiveValue}
        >
          <CommandInput
            ref={searchRef}
            value={query}
            onValueChange={setQuery}
            aria-label={t`Search models`}
            placeholder={t`Search`}
          />
          <CommandList label={t`Model options`} className="rk-scroll max-h-80">
            {loading ? <div role="status" className="px-3 py-3 text-sm text-muted-foreground"><Trans>Loading models…</Trans></div> : <CommandEmpty>
              <Trans>No matching models</Trans>
            </CommandEmpty>}
            {catalogError ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{catalogError}</p> : null}
            {defaultOption && !needle ? (
              <CommandGroup>
                <CommandItem
                  value="default"
                  onSelect={() => {
                    onPick(null);
                    close();
                  }}
                >
                  <span className="min-w-0 truncate">{defaultOption}</span>
                  <CommandShortcut className="text-[13px] tracking-normal">
                    <Trans>Default</Trans>
                  </CommandShortcut>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map(([name, entries]) => (
              <CommandGroup key={name} heading={name}>
                {entries.map((option) => (
                  <CommandItem
                    key={optionValue(option)}
                    value={optionValue(option)}
                    onSelect={() => {
                      onPick(option);
                      close();
                    }}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {exactOptions.length ? <CommandGroup heading={t`Exact model ID`}>
              {exactOptions.map(option => <CommandItem
                key={`exact:${optionValue(option)}`}
                value={`exact:${optionValue(option)}`}
                onSelect={() => { onPick(option); close(); }}
              >
                <span className="min-w-0 break-all">{t`Use exact ID: ${option.id}`}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.providerName}</span>
              </CommandItem>)}
            </CommandGroup> : null}
            {matchingProviders.length && groups.length ? <CommandSeparator /> : null}
            {matchingProviders.length ? (
              <CommandGroup>
                {matchingProviders.map((provider) => (
                  <CommandItem
                    key={`${provider.id}:${provider.baseUrl ?? ""}`}
                    value={`connect:${provider.id}:${provider.baseUrl ?? ""}`}
                    onSelect={() => {
                      close();
                      onConnect(provider);
                    }}
                  >
                    <span className="min-w-0 truncate">{provider.name}</span>
                    <CommandShortcut className="text-[13px] tracking-normal">
                      <Trans>Connect</Trans>
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
