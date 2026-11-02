import { Trans, useLingui } from "@lingui/react/macro";
import { filterModelCatalog } from "@rakazo/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TextOnlyMark } from "../../components/TextOnlyMark";
import type { ModelCatalogEntry } from "../../lib/model-auth";
import { modelDisplayName } from "./model-display-name";

function optionValue(option: ModelCatalogEntry) {
  return `${option.provider}:${option.id}`;
}

export function ModelPicker({
  options,
  value,
  onChange,
  provider,
  disabled,
  label,
  placeholder,
  allowCustom = false,
  loading = false,
}: {
  options: ModelCatalogEntry[];
  value: string;
  onChange: (value: string, option: ModelCatalogEntry) => void;
  provider?: string;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  allowCustom?: boolean;
  loading?: boolean;
}) {
  const { t } = useLingui();
  const searchRef = useRef<HTMLInputElement>(null);
  const imagesHintId = useId();
  const selectedIndex = Math.max(
    placeholder || allowCustom ? -1 : 0,
    options.findIndex(
      (option) => option.id === value && (provider === undefined || option.provider === provider),
    ),
  );
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState(selected ? optionValue(selected) : "");
  useEffect(() => {
    setOpen(false);
  }, [selected?.provider, selectedIndex, value, disabled]);

  const filteredOptions = useMemo(() => filterModelCatalog(options, query), [options, query]);
  const exactId = query.trim();
  const customValue = `custom:${exactId}`;
  const customOption = allowCustom && exactId && !options.some(option => option.id === exactId)
    ? { id: exactId, provider: provider ?? "openai-compatible", label: exactId, billing: "" }
    : null;
  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    for (const option of filteredOptions) {
      const name = option.providerName ?? option.provider;
      const entries = grouped.get(name);
      if (entries) entries.push(option);
      else grouped.set(name, [option]);
    }
    return [...grouped].map(([name, entries]) => ({ name, entries }));
  }, [filteredOptions]);

  // Keep the filtered rows in place through the closing animation.
  function changeOpen(next: boolean) {
    if (disabled && next) return;
    if (next && !open) {
      setQuery("");
      setActiveValue(selected ? optionValue(selected) : "");
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <div className="mt-2">
        <span id={imagesHintId} hidden>{t`Can't read images`}</span>
        <PopoverTrigger
          disabled={disabled}
          role="combobox"
          aria-label={label ?? t`Model`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-busy={loading}
          aria-describedby={selected?.images === false ? imagesHintId : undefined}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-start text-[15px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              changeOpen(true);
              if (event.key === "ArrowUp" && options.length) {
                setActiveValue(optionValue(options[options.length - 1]!));
              }
            }
          }}
        >
          <span className="min-w-0 truncate">{selected ? modelDisplayName(selected.id, selected.label) : allowCustom && value ? value : loading ? t`Loading models…` : placeholder}</span>
          <span className="ml-3 flex shrink-0 items-center gap-2 text-muted-foreground">
            {loading ? <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
            {selected?.images === false ? <TextOnlyMark /> : null}
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          initialFocus={searchRef}
          className="w-(--anchor-width) gap-0 overflow-hidden p-0 motion-reduce:animate-none"
        >
          <Command
            ref={(command) => {
              if (!command || !searchRef.current) return;
              // cmdk can retain a stale selectedItemId when a controlled value changes
              // before filtered items commit. Associate its committed row with the input.
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
              onValueChange={(next) => {
                setQuery(next);
                const first = filterModelCatalog(options, next)[0];
                setActiveValue(first ? optionValue(first) : allowCustom && next.trim() ? `custom:${next.trim()}` : "");
              }}
              aria-label={t`Search models`}
              placeholder={allowCustom ? t`Search or enter an exact model ID` : t`Search`}
            />
            <CommandList label={t`Model options`} className="rk-scroll max-h-64">
              {loading ? <div role="status" className="px-3 py-3 text-sm text-muted-foreground">{t`Loading models…`}</div> : <CommandEmpty>
                <Trans>No matching models</Trans>
              </CommandEmpty>}
              {groups.map((group) => (
                <CommandGroup key={group.name} heading={groups.length > 1 ? group.name : undefined}>
                  {group.entries.map((option) => (
                    <CommandItem
                      key={optionValue(option)}
                      value={optionValue(option)}
                      data-checked={
                        option.id === value &&
                        (provider === undefined || option.provider === provider)
                      }
                      aria-describedby={option.images === false ? imagesHintId : undefined}
                      onSelect={() => {
                        onChange(option.id, option);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 truncate">{modelDisplayName(option.id, option.label)}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px] leading-[1.5] text-muted-foreground">
                        {option.images === false ? <TextOnlyMark /> : null}
                        {option.billing.toLowerCase().includes("free") ? t`Free` : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {customOption && <CommandGroup heading={t`Exact model ID`}>
                <CommandItem value={customValue} onSelect={() => {
                  onChange(customOption.id, customOption);
                  setOpen(false);
                }}>
                  <span className="min-w-0 break-all">{t`Use exact ID: ${customOption.id}`}</span>
                </CommandItem>
              </CommandGroup>}
            </CommandList>
          </Command>
        </PopoverContent>
      </div>
    </Popover>
  );
}
