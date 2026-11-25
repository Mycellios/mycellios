import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Copies a value and reports the result next to the button; the value is never logged. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useLingui();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState("copied"); }
    catch { setState("failed"); }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2_500);
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-live="polite">
      {state === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      {state === "copied" ? t`Copied` : state === "failed" ? t`Select and copy it manually` : label}
    </Button>
  );
}
