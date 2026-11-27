import { Trans, useLingui } from "@lingui/react/macro";
import type { ChatModelChoice } from "@mycellios/core";
import { groupModelChoices, MODEL_SEARCH_THRESHOLD } from "@mycellios/core";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mycellios/ui-web";
import { Check, ChevronDownIcon, Circle, Monitor, Plus } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { TextOnlyMark } from "../../components/TextOnlyMark";
import { ProviderLogo } from "../../components/ProviderLogo";

/** A chat's model: a themed select, with search once there are too many choices to scan. */

export function ChatModelPicker({
  id,
  choices,
  value,
  onChange,
  inline = false,
  defaultKey,
  currentProvider,
  heading,
  onManage,
  providerIds,
  initialProvider,
  onProviderChange,
  modelOrigins,
  freeModels,
  recommendedModels,
  providerContent,
  mycelliosCatalogReady = true,
  catalogProviders,
  onExplore,
}: {
  id: string;
  /** unavailableLabel replaces the generic Unavailable when the reason is known. */
  choices: readonly (ChatModelChoice & { unavailable?: boolean; unavailableLabel?: string })[];
  value: string;
  onChange: (key: string) => void;
  inline?: boolean;
  defaultKey?: string;
  currentProvider?: string;
  heading?: string;
  onManage?: () => void;
  providerIds?: Readonly<Record<string, string>>;
  initialProvider?: string | null;
  onProviderChange?: (provider: string) => void;
  modelOrigins?: Readonly<Record<string, "network" | "antseed">>;
  /** AntSeed models with an exact-zero price; they lead the AntSeed group. */
  freeModels?: ReadonlySet<string>;
  /** Models the account catalog recommends; they lead their group. */
  recommendedModels?: ReadonlySet<string>;
  providerContent?: (provider: string) => ReactNode;
  mycelliosCatalogReady?: boolean;
  catalogProviders?: readonly string[];
  onExplore?: (provider: string) => void;
}) {
  const { t } = useLingui();
  const imagesHintId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [olderOpen, setOlderOpen] = useState<ReadonlySet<string>>(() => new Set());
  const providers = [...new Set([...Object.keys(providerIds ?? {}), ...choices.flatMap((choice) => choice.providerLabel ? [choice.providerLabel] : [])])];
  const [provider, setProvider] = useState(() =>
    initialProvider ?? choices.find((choice) => choice.key === (value || defaultKey))?.providerLabel ?? null,
  );
  const activeProvider = provider && providers.includes(provider) ? provider : providers[0];
  /** Agent programs on the Mico's PC are offered as native-<engine> providers. */
  const nativeProviders = new Set(choices.filter(choice => choice.provider?.startsWith("native-") && choice.providerLabel).map(choice => choice.providerLabel!));
  const isNativeProvider = (name: string) => nativeProviders.has(name) || providerIds?.[name]?.startsWith("native-") === true;
  const unavailableKeys = new Map(choices.filter(choice => choice.unavailable).map(choice => [choice.key, choice.unavailableLabel] as const));
  const inheritedProvider = choices.find(choice => choice.key === defaultKey)?.providerLabel;
  const grouped = useMemo(() => groupModelChoices(
    inline && activeProvider ? choices.filter((choice) => choice.providerLabel ? choice.providerLabel === activeProvider : !defaultKey || !inheritedProvider || activeProvider === inheritedProvider) : choices,
    query,
  ), [choices, inline, activeProvider, inheritedProvider, defaultKey, query]);
  const networkHeading = t`Mycellios network`;
  const antseedHeading = "AntSeed";
  const showNetworkSection = inline && activeProvider === "Mycellios" && modelOrigins !== undefined;
  const antseedChoices = showNetworkSection ? grouped.flatMap(section => section.data.filter(choice => modelOrigins[choice.key] === "antseed")) : [];
  const keepNetworkSection = showNetworkSection && !query.trim();
  const sections = showNetworkSection
    ? [
      { key: "mycellios-network", heading: networkHeading, data: grouped.flatMap(section => section.data.filter(choice => modelOrigins[choice.key] === "network")) },
      // Free AntSeed models get their own heading, so people find them without reading prices.
      // The recommended free route leads, so it is not lost among dozens of free sellers.
      { key: "mycellios-antseed-free", heading: `${antseedHeading} · ${t`Free`}`, data: antseedChoices.filter(choice => freeModels?.has(choice.key))
        .sort((a, b) => Number(Boolean(recommendedModels?.has(b.key))) - Number(Boolean(recommendedModels?.has(a.key)))) },
      { key: "mycellios-antseed", heading: antseedHeading, data: antseedChoices.filter(choice => !freeModels?.has(choice.key)) },
      ...grouped.map(section => ({ ...section, data: section.data.filter(choice => !modelOrigins[choice.key]) })),
    ].filter(section => section.data.length || keepNetworkSection && section.key === "mycellios-network")
    : grouped;
  const selected = choices.find((choice) => choice.key === value) ?? choices[0];
  const textOnly = selected?.images === false;
  const imagesHint = <span id={imagesHintId} hidden>{t`Can't read images`}</span>;

  if (!inline && choices.length <= MODEL_SEARCH_THRESHOLD) {
    return (
      <Select value={value} onValueChange={(key) => { if (key !== null) onChange(key); }}>
        {imagesHint}
        <SelectTrigger
          id={id}
          className="mt-2 w-full"
          aria-describedby={textOnly ? imagesHintId : undefined}
        >
          <SelectValue>{selected?.label}</SelectValue>
          {textOnly ? <span className="text-muted-foreground"><TextOnlyMark /></span> : null}
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>
            {choices.map((choice) => (
              <SelectItem key={choice.key} value={choice.key}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  // Older models fold under one row per section; a search and the current choice show them.
  const searching = query.trim() !== "";
  const folded = (choice: ChatModelChoice) =>
    !searching && choice.listing === "older" && choice.key !== value;
  function olderCount(data: readonly ChatModelChoice[]) {
    return data.filter(folded).length;
  }
  function visibleChoices(section: string, data: readonly ChatModelChoice[]) {
    return olderOpen.has(section) ? data : data.filter((choice) => !folded(choice));
  }
  function toggleOlder(section: string) {
    setOlderOpen((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  const options = (
    <Command
      id={inline ? id : undefined}
      shouldFilter={false}
      className={`h-auto min-h-0 max-h-(--available-height) rounded-none bg-popover *:data-[slot=command-input-wrapper]:shrink-0 ${inline ? "*:data-[slot=command-input-wrapper]:p-0 [&_[data-slot=input-group]]:h-8! [&_[data-slot=input-group]]:rounded-md! [&_[data-slot=input-group]]:border-0! [&_[data-slot=input-group]]:bg-muted/50! [&_[data-slot=input-group-addon]]:hidden [&_[data-slot=command-input]]:px-2.5" : ""}`}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t`Search models`}
        aria-label={t`Search models`}
      />
      <CommandList className="min-h-0 max-h-80 flex-1 overflow-y-auto">
        {!keepNetworkSection ? <CommandEmpty>
          <Trans>No matching models</Trans>
        </CommandEmpty> : null}
        {sections.map((section) => (
          <CommandGroup key={section.key} forceMount={keepNetworkSection && section.key === "mycellios-network"}
            className={inline ? "p-0 pt-1" : undefined} heading={inline && section.heading === activeProvider ? undefined : section.heading}>
            {section.key === "mycellios-network" && section.data.length === 0 && mycelliosCatalogReady ? (
              <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">{t`No chat models available right now.`}</p>
            ) : null}
            {visibleChoices(section.key, section.data).map((choice) => (
              <CommandItem
                key={choice.key}
                aria-label={choice.label}
                title={inline ? choice.label : undefined}
                // cmdk falls back to the row's text for an empty value.
                value={choice.key || "space-default"}
                data-checked={choice.key === value}
                disabled={unavailableKeys.has(choice.key)}
                className={inline
                  ? "min-h-7 gap-2 rounded-md px-2.5 py-1 text-sm [&>svg:last-child]:hidden"
                  : undefined}
                aria-describedby={choice.images === false ? imagesHintId : undefined}
                onSelect={() => {
                  onChange(choice.key);
                  openChange(false);
                }}
              >
                {inline ? (choice.key === value
                  ? <Check aria-hidden className="size-3.5 shrink-0 rounded-full bg-foreground p-0.5 text-background!" />
                  : <Circle aria-hidden className="size-3.5 shrink-0 text-muted-foreground/50" />) : null}
                <span className={`min-w-0 truncate ${inline ? "" : "flex-1"}`}>
                  {choice.title ?? choice.label}
                </span>
                {inline && choice.key && choice.key === defaultKey ? (
                  <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] text-muted-foreground">{t`Default`}</span>
                ) : null}
                {choice.listing === "new" ? (
                  <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] text-muted-foreground">{t`New`}</span>
                ) : null}
                {unavailableKeys.has(choice.key) ? <span className="shrink-0 text-xs text-muted-foreground">{unavailableKeys.get(choice.key) ?? t`Unavailable`}</span> : null}
                {choice.images === false ? (
                  <span className="shrink-0 text-muted-foreground">
                    <TextOnlyMark />
                  </span>
                ) : null}
              </CommandItem>
            ))}
            {olderCount(section.data) > 0 ? (
              <CommandItem
                value={`older-models:${section.key}`}
                aria-label={t`Older models`}
                aria-expanded={olderOpen.has(section.key)}
                className={inline
                  ? "min-h-7 gap-2 rounded-md px-2.5 py-1 text-sm text-muted-foreground [&>svg:last-child]:hidden"
                  : "text-muted-foreground"}
                onSelect={() => toggleOlder(section.key)}
              >
                <ChevronDownIcon
                  aria-hidden
                  className={`size-3.5 shrink-0 transition-transform ${olderOpen.has(section.key) ? "" : "-rotate-90"}`}
                />
                <span className="min-w-0 flex-1 truncate">{t`Older models`}</span>
                {olderOpen.has(section.key) ? null : (
                  <span className="shrink-0 text-xs">{olderCount(section.data)}</span>
                )}
              </CommandItem>
            ) : null}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );

  if (inline) {
    return (
      <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)]">
        {imagesHint}
        {providers.length || onManage ? (
          <div className="flex w-11 flex-col items-center gap-1 border-e border-border bg-muted/30 px-1 py-2" role="group" aria-label={t`Providers`}>
            {/* Connections first, then the agent programs installed on this PC (Claude Code, Codex,
                OpenCode), set apart and marked: they share logos with the API connections. */}
            {[providers.filter(name => !isNativeProvider(name)), providers.filter(isNativeProvider)].map((group, index) =>
              group.length ? <div key={index} className={`flex flex-col items-center gap-1 ${index ? "mt-1 border-t border-border pt-2" : ""}`}>
                {group.map((name) => {
                  const native = index === 1;
                  // The accessible name stays the provider; the tooltip and the mark say it runs on this PC.
                  return <Button key={name} type="button" size="sm" variant={activeProvider === name ? "secondary" : "ghost"}
                    className="relative h-8 w-8 shrink-0 rounded-md p-0"
                    aria-pressed={activeProvider === name} aria-label={name} title={native ? `${name} · ${t`This PC`}` : name}
                    onClick={() => { setProvider(name); onProviderChange?.(name); setQuery(""); }}>
                    <ProviderLogo name={name} providerId={providerIds?.[name]} />
                    {native ? <Monitor aria-hidden size={10} strokeWidth={2.4} className="absolute -end-0.5 -bottom-0.5 rounded-sm bg-background p-px text-muted-foreground" /> : null}
                  </Button>;
                })}
              </div> : null)}
            {onManage ? (
              <Button type="button" size="icon-sm" variant="ghost" className="h-8 w-8 rounded-md text-muted-foreground" aria-label={t`Manage providers`} title={t`Manage providers`} onClick={onManage}>
                <Plus size={16} aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="min-w-0 px-2 py-2">
          <p className="mb-1.5 truncate px-2.5 text-sm font-semibold">{heading ?? activeProvider ?? t`Model`}</p>
          {currentProvider ? (
            <p className="mb-1 truncate px-1 text-xs text-muted-foreground" title={currentProvider}>
              {currentProvider === activeProvider ? t`Provider for this Mico` : t`Choose a model to use this provider`}
            </p>
          ) : null}
          {heading && activeProvider ? <p className="mb-1 truncate px-1 text-xs text-muted-foreground">{activeProvider}</p> : null}
          {providerContent?.(activeProvider ?? "") ?? options}
          {activeProvider && catalogProviders?.includes(activeProvider) && onExplore ? (
            <Button type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start gap-2" onClick={() => onExplore(activeProvider)}>
              {t`Explore catalog`}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      {imagesHint}
      <PopoverTrigger
        id={id}
        aria-describedby={textOnly ? imagesHintId : undefined}
        className="mt-2 flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2.5 pl-2.5 text-start text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {textOnly ? <TextOnlyMark /> : null}
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </span>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="start"
          side="bottom"
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          className="w-(--anchor-width) max-h-(--available-height) gap-0 overflow-hidden bg-popover p-0 opacity-100 animate-none! backdrop-filter-none"
        >
          {options}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
