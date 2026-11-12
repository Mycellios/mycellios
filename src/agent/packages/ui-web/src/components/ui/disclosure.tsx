import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { cn } from "@rakazo/ui-web/lib/utils";
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { createContext, useContext } from "react";

const SettingsVisibility = createContext(false);
/** Settings expose their sections; chat/tool disclosures retain their normal behavior. */
export function ExpandedSettings({ children }: { children: React.ReactNode }) {
  return <SettingsVisibility.Provider value>{children}</SettingsVisibility.Provider>;
}
export function useSettingsSectionsVisible() { return useContext(SettingsVisibility); }

/** A shared animated fold-out that preserves its children's state while closed. */
function Disclosure({
  summary,
  summaryClassName,
  contentClassName,
  className,
  children,
  alwaysVisible = false,
  ...props
}: Omit<React.ComponentProps<typeof Collapsible>, "children" | "className"> & {
  summary: React.ReactNode;
  summaryClassName?: string;
  contentClassName?: string;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
  alwaysVisible?: boolean;
}) {
  const visible = useSettingsSectionsVisible() || alwaysVisible;
  if (visible) return <section data-slot="settings-section" id={props.id} data-testid={props["data-testid"]} className={className}>
    <h3 className={cn("mb-2 text-sm font-medium text-start", summaryClassName)}>{summary}</h3>
    <div className={contentClassName}>{children}</div>
  </section>;
  return (
    <Collapsible data-slot="disclosure" className={cn("group/disclosure", className)} {...props}>
      <CollapsibleTrigger
        className={cn(
          "flex w-fit cursor-pointer items-center gap-1.5 rounded-md text-start outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
          summaryClassName,
        )}
      >
        {summary}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/disclosure:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound className={contentClassName}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export { Disclosure };
