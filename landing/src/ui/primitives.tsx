import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";
import "./ui.css";

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "navigation";
export type ControlSize = "sm" | "md" | "lg" | "xl";

function buttonVariant(className = ""): ButtonVariant {
  if (/danger|destructive|delete|revoke/.test(className)) return "danger";
  if (/primary|submit|launch|send|contribute-start|connect-primary|hero-cta|download-card-action/.test(className)) return "primary";
  if (/secondary/.test(className)) return "secondary";
  return "ghost";
}

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
};
export function Button({ className, variant = buttonVariant(className), size = "md", loading = false, disabled, children, ...props }: ButtonProps) {
  return <button {...props} className={classes("ui-button", className)} data-ui="button" data-variant={variant} data-size={size} disabled={disabled || loading} aria-busy={loading || props["aria-busy"]}>
    {loading && <span className="ui-spinner" aria-hidden="true" />}{children}
  </button>;
}
export function IconButton({ size = "md", ...props }: ButtonProps & { "aria-label": string }) {
  return <Button {...props} size={size} data-icon-only="true" />;
}

export type LinkProps = ComponentPropsWithRef<"a"> & { variant?: ButtonVariant; size?: ControlSize };
export function Link({ className, variant, size = "md", ...props }: LinkProps) {
  const action = variant ?? (/button|btn|cta|download-card-action|connect-primary-action/.test(className ?? "") ? buttonVariant(className) : undefined);
  return <a {...props} className={classes(action ? "ui-button ui-link" : "ui-link", className)} data-ui="link" data-variant={action} data-size={size} />;
}
export function Input({ className, type = "text", ...props }: ComponentPropsWithRef<"input">) {
  return <input {...props} type={type} className={classes("ui-input", className)} data-ui="input" data-control={type} />;
}
export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={classes("ui-textarea", className)} data-ui="textarea" />;
}
export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return <select {...props} className={classes("ui-select", className)} data-ui="select" />;
}
export function FieldLabel({ className, ...props }: ComponentPropsWithRef<"label">) {
  return <label {...props} className={classes("ui-label", className)} data-ui="label" />;
}
export function Form({ className, ...props }: ComponentPropsWithRef<"form">) {
  return <form {...props} className={classes("ui-form", className)} data-ui="form" />;
}
export function Card({ className, ...props }: ComponentPropsWithRef<"article">) {
  return <article {...props} className={classes("ui-card", className)} data-ui="card" />;
}
export function Heading({ as: Tag = "h2", className, ...props }: ComponentPropsWithRef<"h2"> & { as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" }) {
  return <Tag {...props} className={classes("ui-heading", className)} data-ui="heading" />;
}
export function Text({ as: Tag = "p", className, ...props }: ComponentPropsWithRef<"p"> & { as?: "p" | "span" | "small" }) {
  const TagName = Tag as ElementType;
  return <TagName {...props} className={classes("ui-text", className)} data-ui="text" />;
}
export function Badge({ tone = "neutral", className, ...props }: ComponentPropsWithRef<"span"> & { tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span {...props} className={classes("ui-badge", className)} data-ui="badge" data-tone={tone} />;
}
export function DialogPanel({ as: Tag = "section", className, ...props }: ComponentPropsWithRef<"section"> & { as?: "section" | "aside" | "div" }) {
  const TagName = Tag as ElementType;
  return <TagName {...props} className={classes("ui-dialog", className)} data-ui="dialog" />;
}
export function Separator(props: ComponentPropsWithRef<"hr">) { return <hr {...props} data-ui="separator" />; }
export function Disclosure(props: ComponentPropsWithRef<"details">) { return <details {...props} data-ui="disclosure" />; }
export function DisclosureSummary(props: ComponentPropsWithRef<"summary">) { return <summary {...props} data-ui="disclosure-summary" />; }

function tablePart<Tag extends ElementType>(tag: Tag, name: string) {
  const Component = (props: ComponentPropsWithRef<Tag>) => {
    const TagName = tag as ElementType;
    return <TagName {...props} data-ui={name} />;
  };
  Component.displayName = name;
  return Component;
}
export const Table = tablePart("table", "table");
export const TableHead = tablePart("thead", "table-head");
export const TableBody = tablePart("tbody", "table-body");
export const TableRow = tablePart("tr", "table-row");
export const TableHeader = tablePart("th", "table-header");
export const TableCell = tablePart("td", "table-cell");

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="ui-field"><FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>{children}{hint && <Text as="small" id={`${htmlFor}-hint`}>{hint}</Text>}{error && <Text as="small" id={`${htmlFor}-error`} role="alert">{error}</Text>}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="ui-empty-state"><Heading>{title}</Heading><Text>{children}</Text>{action}</div>;
}
export function Alert({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "danger" | "success"; children: ReactNode }) {
  return <div className="ui-alert" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}
