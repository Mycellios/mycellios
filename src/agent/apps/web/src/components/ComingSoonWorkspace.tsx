import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { ArrowLeft, Menu, type LucideIcon } from "lucide-react";
import { desktopDragClass } from "../lib/desktop";

export function ComingSoonWorkspace({ title, icon: Icon, testId, onExit, onNavigation }: {
  title: string;
  icon: LucideIcon;
  testId: string;
  onExit: () => void;
  onNavigation?: () => void;
}) {
  const { t } = useLingui();
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={title} data-testid={testId}>
    <header data-testid="conversation-header" className={`${desktopDragClass()} flex h-[51px] shrink-0 items-center gap-2 border-b border-border px-3 text-sm`}>
      {onNavigation ? <Button variant="ghost" size="icon-sm" className="app-no-drag md:hidden" aria-label={t`Open navigation`} onClick={onNavigation}><Menu size={17} aria-hidden="true" /></Button> : null}
      <span>{title}</span>
      <Button variant="ghost" size="sm" className="app-no-drag ms-auto gap-2 font-normal" onClick={onExit}><ArrowLeft size={14} aria-hidden="true" />{t`Back to chat`}</Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-8 text-center">
      <Icon size={28} strokeWidth={1.4} className="text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-1 text-2xl font-medium">{title}</h1>
      <p className="text-sm">{t`Coming soon`}</p>
    </div>
  </section>;
}
