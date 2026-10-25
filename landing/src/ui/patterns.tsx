import { Button as UiButton, Card as UiCard, Disclosure as UiDisclosure, DisclosureSummary as UiDisclosureSummary, Heading as UiHeading, Text as UiText } from "./primitives";
import { useRef, useState } from "react";
import type * as React from "react";
import { Activity, Check, ChevronDown, Cpu, LoaderCircle, Radio } from "lucide-react";

interface AppSelectOption {
  value: string;
  label: string;
}

export function AppSelect({ ariaLabel, value, options, onChange, placeholder = "Select an option" }: { ariaLabel: string; value: string; options: AppSelectOption[]; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];

  function moveSelection(direction: -1 | 1) {
    if (options.length === 0) return;
    const nextIndex = (selectedIndex + direction + options.length) % options.length;
    const next = options[nextIndex];
    if (next) onChange(next.value);
  }

  return <div className={`app-select${open ? " open" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <UiButton
      ref={triggerRef}
      type="button"
      className="app-select-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={options.length === 0}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); moveSelection(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); moveSelection(-1); }
      }}
    >
      <span>{selected?.label ?? placeholder}</span><ChevronDown size={16} />
    </UiButton>
    {open && <div className="app-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option) => <UiButton
        key={option.value}
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? "selected" : ""}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
      ><span>{option.label}</span>{option.value === value && <Check size={15} />}</UiButton>)}
    </div>}
  </div>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <UiButton type="button" className="toggle-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span>{label}</span><i aria-hidden="true" /></UiButton>;
}
export function PageTitle({ eyebrow, title, copy, actions }: { eyebrow?: string; title: string; copy?: string; actions?: React.ReactNode }) {
  void eyebrow;
  void copy;
  return <div className="panel-page-title"><div><UiHeading as="h1">{title}</UiHeading></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function PanelDisclosure({ icon: Icon, title, children, defaultOpen = false }: { icon: typeof Activity; eyebrow?: string; title: string; summary?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return <UiDisclosure className="panel-disclosure minimal-disclosure" open={defaultOpen}>
    <UiDisclosureSummary>
      <i className="panel-disclosure-icon"><Icon size={18} /></i>
      <span><strong>{title}</strong></span>
      <ChevronDown className="panel-disclosure-chevron" size={18} aria-hidden="true" />
    </UiDisclosureSummary>
    <div className="panel-disclosure-body">{children}</div>
  </UiDisclosure>;
}

export function Stat({ icon: Icon, label, value, detail, tone = "blue" }: { icon: typeof Radio; label: string; value: string; detail: string; tone?: "blue" | "purple" }) { return <UiCard className={`panel-stat ${tone}`}><div><Icon /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small><i className="stat-accent" /></UiCard>; }
export function CapacityMetric({ icon: Icon, label, value, detail }: { icon: typeof Cpu; label: string; value: string; detail: string }) { return <div className="global-capacity-metric"><i><Icon /></i><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></div>; }
export function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
export function Empty({ icon: Icon, title, copy }: { icon: typeof Activity; title: string; copy: string }) { return <div className="panel-empty"><Icon /><strong>{title}</strong><UiText>{copy}</UiText></div>; }
export function PanelLoading() { return <div className="panel-loading" role="status" aria-live="polite" aria-atomic="true"><LoaderCircle className="spin" /><strong>Connecting to mycellios</strong><span>Loading the configured network snapshot…</span></div>; }

export function SummaryStrip({ items, label = "Summary" }: { items: Array<{ label: string; value: React.ReactNode }>; label?: string }) {
  return <dl className="ui-summary-strip" aria-label={label} style={{ "--summary-columns": Math.min(4, items.length) } as React.CSSProperties}>
    {items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
  </dl>;
}
