import { Button } from "@rakazo/ui-web";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import "./store-app-header.css";

export function StoreAppHeader({ title, subtitle, onBack, children, className = "" }: {
  title: string; subtitle?: string; onBack: () => void; children?: ReactNode; className?: string;
}) {
  return <header className={`hifa-app-header ${className}`}>
    <Button type="button" variant="ghost" size="icon" className="hifa-app-header-back"
      onClick={onBack} aria-label="Volver a Hifa Store" title="Volver a Hifa Store">
      <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
    </Button>
    <div className="hifa-app-header-identity">
      <h1 title={title}>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="hifa-app-header-actions">{children}</div>}
  </header>;
}
