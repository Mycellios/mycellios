import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

type SettingHelp = { label: string; description: string };

/** Keep the help button outside the field label so opening help never toggles it. */
export function SettingsLabel({
  children,
  name,
  help,
}: {
  children: ReactNode;
  name: string;
  help: string;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
      <span className="min-w-0">{children}</span>
      <InfoTooltip label={name} icon="info">{help}</InfoTooltip>
    </span>
  );
}

/** A titled list of settings rows sharing one bordered surface. */
export function SettingsGroup({
  title,
  children,
  "data-testid": testId,
}: {
  title?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section data-testid={testId} data-slot="settings-group">
      {title ? (
        <h3 className="mb-2 px-1 text-[14px] font-medium text-foreground">{title}</h3>
      ) : null}
      <div data-slot="settings-group-content" className="divide-y divide-border rounded-xl border border-border">{children}</div>
    </section>
  );
}

/** One setting: label then control, side by side when they fit, optional detail below. */
export function SettingsRow({
  label,
  control,
  children,
  help,
  description,
}: {
  label: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  help?: SettingHelp;
  description?: ReactNode;
}) {
  return (
    <div className="rk-settings-row px-4 py-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2 break-words text-[14px] text-foreground">
          <div className="min-w-0">{label}{description ? <p className="rk-settings-description mt-1 text-[13px] leading-[1.4] text-muted-foreground">{description}</p> : null}</div>
          {help && <InfoTooltip label={help.label} icon="info">{help.description}</InfoTooltip>}
        </div>
        {control ? (
          <div className="flex max-w-full min-w-0 items-center gap-2">{control}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
