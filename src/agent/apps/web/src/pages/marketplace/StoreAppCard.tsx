import { Button } from "@rakazo/ui-web";
import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import "./store-app-card.css";

/** Shared geometry for every Hifa Store app, regardless of where it runs. */
export function StoreAppCard({ title, description, cover, metadata, onOpen, openLabel,
  disabled = false, titleActions }: {
  title: string; description: string; icon: ReactNode; cover: ReactNode; metadata: ReactNode;
  onOpen: () => void; openLabel: string; disabled?: boolean; titleActions?: ReactNode;
}) {
  const titleId = useId();
  return <article className="hifa-app-card" aria-labelledby={titleId}>
    <div className="hifa-app-card-cover">
      {cover}
      <Button type="button" variant="ghost" className="hifa-app-card-cover-open" tabIndex={-1} style={{ background: "transparent" }}
        aria-label={openLabel} disabled={disabled} onClick={onOpen} />
    </div>
    <div className="hifa-app-card-body">
      <div className="hifa-app-card-heading">
        <h2 id={titleId} title={title}>{title}</h2>
        {titleActions && <div className="hifa-app-card-title-actions">{titleActions}</div>}
      </div>
      <p className="hifa-app-card-description" title={description}>{description}</p>
      <div className="hifa-app-card-footer">
        <span className="hifa-app-card-meta">{metadata}</span>
        <Button type="button" variant="ghost" size="icon" className="hifa-app-card-open" aria-label={openLabel}
          title={openLabel} disabled={disabled} onClick={onOpen}>
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>
    </div>
  </article>;
}
