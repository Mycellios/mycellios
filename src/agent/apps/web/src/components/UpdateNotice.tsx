import { Clock3, Download, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode, Ref } from "react";
import "./update-notice.css";

/** One compact notice; native and browser controllers retain ownership of updates. */
export function UpdateNotice({ label, action, actionLabel, onAction, busy = false, disabled = false,
  progress, progressLabel, ready = false, failed = false, deferred = false, actionRef,
}: {
  label: string; action: ReactNode; actionLabel: string; onAction: () => void;
  busy?: boolean; disabled?: boolean; progress?: number | null; progressLabel?: string;
  ready?: boolean; failed?: boolean; deferred?: boolean;
  actionRef?: Ref<HTMLButtonElement>;
}) {
  return <aside className="myc-update-notice" aria-label={label} data-failed={failed || undefined}>
    <div className="myc-update-notice__row">
      <p role="status" aria-live="polite" className="myc-update-notice__label" title={label}>{label}</p>
      <button ref={actionRef} type="button" className="myc-update-notice__action" aria-label={actionLabel}
        aria-busy={busy || undefined} disabled={disabled} onClick={onAction}>
        {typeof progress === "number" && <span aria-hidden="true" className="myc-update-notice__fill" style={{ width: `${progress}%` }} />}
        <span className="myc-update-notice__action-content">
          {busy ? <LoaderCircle className="myc-update-notice__spinner" size={13} aria-hidden="true" />
            : deferred ? <Clock3 size={13} aria-hidden="true" />
            : ready || failed ? <RotateCw size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
          <span>{action}</span>
        </span>
      </button>
    </div>
    {progress !== undefined && <progress className="sr-only" aria-label={progressLabel} max={100} value={progress ?? undefined} />}
  </aside>;
}
