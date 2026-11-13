import { Trans, useLingui } from "@lingui/react/macro";
import type { ChatModelChoice } from "@rakazo/core";
import { groupModelChoices, MODEL_SEARCH_THRESHOLD } from "@rakazo/core";
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
} from "@rakazo/ui-web";
import { ChevronDownIcon, Circle, CircleCheck, Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  catalogProviders,
  providerIds,
  onExplore,
  initialProvider,
  onProviderChange,
  providerContent,
}: {
  id: string;
  choices: readonly ChatModelChoice[];
  value: string;
  onChange: (key: string) => void;
  inline?: boolean;
  defaultKey?: string;
  currentProvider?: string;
  heading?: string;
  onManage?: () => void;
  catalogProviders?: readonly string[];
  providerIds?: Readonly<Record<string, string>>;
  onExplore?: (provider: string) => void;
  initialProvider?: string | null;
  onProviderChange?: (provider: string) => void;
  providerContent?: (provider: string) => ReactNode;
}) {
  const { t } = useLingui();
  const imagesHintId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const providers = [...new Set([...(catalogProviders ?? []), ...choices.flatMap((choice) => choice.providerLabel ? [choice.providerLabel] : [])])];
  const [provider, setProvider] = useState(() =>
    initialProvider ?? choices.find((choice) => choice.key === (value || defaultKey))?.providerLabel ?? null,
  );
  const activeProvider = provider && providers.includes(provider) ? provider : providers[0];
  const selectedProviderContent = inline && activeProvider ? providerContent?.(activeProvider) : null;
  const inheritedProvider = choices.find(choice => choice.key === defaultKey)?.providerLabel;
  const sections = useMemo(() => groupModelChoices(
    inline && activeProvider ? choices.filter((choice) => choice.providerLabel ? choice.providerLabel === activeProvider : !defaultKey || !inheritedProvider || activeProvider === inheritedProvider) : choices,
    query,
  ), [choices, inline, activeProvider, inheritedProvider, defaultKey, query]);
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

  const options = (
    <Command
      id={inline ? id : undefined}
      shouldFilter={false}
      className="h-auto min-h-0 max-h-(--available-height) rounded-none bg-popover *:data-[slot=command-input-wrapper]:shrink-0"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t`Search`}
        aria-label={t`Search models`}
      />
      <CommandList className="min-h-0 max-h-80 flex-1 overflow-y-auto">
        <CommandEmpty>
          <Trans>No matching models</Trans>
        </CommandEmpty>
        {sections.map((section) => (
          <CommandGroup key={section.key} heading={inline && section.heading === activeProvider ? undefined : section.heading}>
            {section.data.map((choice) => (
              <CommandItem
                key={choice.key}
                aria-label={choice.label}
                title={inline ? choice.label : undefined}
                // cmdk falls back to the row's text for an empty value.
                value={choice.key || "space-default"}
                data-checked={choice.key === value}
                className={inline
                  ? "min-h-9 rounded-md px-2.5 py-1.5 text-sm [&>svg:last-child]:hidden"
                  : undefined}
                aria-describedby={choice.images === false ? imagesHintId : undefined}
                onSelect={() => {
                  onChange(choice.key);
                  openChange(false);
                }}
              >
                {inline ? (choice.key === value
                  ? <CircleCheck aria-hidden className="shrink-0 text-foreground" />
                  : <Circle aria-hidden className="shrink-0 text-muted-foreground/70" />) : null}
                <span className="min-w-0 flex-1 truncate">
                  {choice.title ?? choice.label}
                </span>
                {inline && choice.key && choice.key === defaultKey ? (
                  <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] text-muted-foreground">{t`Default`}</span>
                ) : null}
                {choice.images === false ? (
                  <span className="shrink-0 text-muted-foreground">
                    <TextOnlyMark />
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );

  if (inline) {
    return (
      <div className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)]">
        {imagesHint}
        {providers.length || onManage ? (
          <div className="flex w-14 flex-col items-center gap-2 border-e border-border bg-background px-1 py-3" role="group" aria-label={t`Providers`}>
            {providers.map((name) => (
              <Button key={name} type="button" size="sm" variant={activeProvider === name ? "secondary" : "ghost"}
                className="h-10 w-10 shrink-0 rounded-lg p-0"
                aria-pressed={activeProvider === name} aria-label={name} title={name}
                onClick={() => { setProvider(name); onProviderChange?.(name); setQuery(""); }}>
                <ProviderLogo name={name} providerId={providerIds?.[name]} />
              </Button>
            ))}
            {onManage ? (
              <Button type="button" size="icon-sm" variant="ghost" className="h-10 w-10 rounded-lg" aria-label={t`Manage models`} title={t`Manage models`} onClick={onManage}>
                <Plus aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="min-w-0 px-3 py-3">
          <p className="mb-1.5 truncate px-1 text-sm font-semibold">{heading ?? activeProvider ?? t`Model`}</p>
          {currentProvider ? (
            <p className="mb-1 truncate px-1 text-xs text-muted-foreground" title={currentProvider}>
              {currentProvider === activeProvider ? t`Provider for this Mico` : t`Choose a model to use this provider`}
            </p>
          ) : null}
          {heading && activeProvider ? <p className="mb-1 truncate px-1 text-xs text-muted-foreground">{activeProvider}</p> : null}
          {selectedProviderContent ?? options}
          {!selectedProviderContent && activeProvider && catalogProviders?.includes(activeProvider) && onExplore ? (
            <Button type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start gap-2" onClick={() => onExplore(activeProvider)}>
              <Search aria-hidden />{t`Explore catalog`}
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
