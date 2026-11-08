import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export type ProviderIntegration = "opencode" | "antseed";

export function ProviderDetail({ integration, name, description, status, connected, icon, disabled, onBack, children }: {
  integration: ProviderIntegration;
  name: string;
  description: string;
  status: string;
  connected: boolean;
  icon: ReactNode;
  disabled?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section className="space-y-6" data-testid={`${integration}-provider-detail`}>
      <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={disabled}>
        <ArrowLeft aria-hidden className="rtl:rotate-180" /> {t`Providers`}
      </Button>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-muted/40">{icon}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 ref={heading} tabIndex={-1} className="text-heading3 font-medium">{name}</h3>
            <span role="status" className={`rounded-full px-2 py-0.5 text-xs ${connected ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{status}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
