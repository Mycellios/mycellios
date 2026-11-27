import { useLingui } from "@lingui/react/macro";
import { Cloud } from "lucide-react";
import { parseSystemNotice } from "../lib/system-notices";

/**
 * A system note in the transcript. A reply that the server answered because the Mico's PC was
 * offline says so in the person's language, with a cloud mark and how to get the PC back;
 * other notes keep their own text.
 */
export function SystemNoticeLine({ text }: { text: string }) {
  const { t } = useLingui();
  const notice = parseSystemNotice(text);
  if (!notice) {
    return <div className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground">
      <span className="text-warning">◷</span>
      <span>{text}</span>
    </div>;
  }
  const engine = notice.kind === "offline-engine" ? notice.engine : "";
  const lead = notice.kind === "offline-engine"
    ? t`This PC is offline, so the server answers this message with the Mico's saved model instead of ${engine}, without this PC's files.`
    : t`This PC is offline, so the server answers this message, without this PC's files.`;
  return <div data-system-notice={notice.kind} className="flex justify-center py-1">
    <div className="flex max-w-xl items-start gap-2 text-[13.5px] text-muted-foreground">
      <Cloud size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        {lead}{" "}
        <span className="text-foreground/80">{t`Open Mycellios Desktop on that PC to work there again.`}</span>
      </span>
    </div>
  </div>;
}
