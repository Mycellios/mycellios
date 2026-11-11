import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

/** A server address only. Signing in on the phone still owns authentication. */
export function ServerLinkCode({ url }: { url: string }) {
  const { t } = useLingui();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReady(false);
    void import("qrcode-generator").then(({ default: qrcode }) => {
      if (!live || !canvas.current) return;
      const code = qrcode(0, "M");
      code.addData(url);
      code.make();
      const count = code.getModuleCount();
      const scale = Math.max(2, Math.floor(256 / (count + 8)));
      const size = (count + 8) * scale;
      const element = canvas.current;
      element.width = size;
      element.height = size;
      const context = element.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#141a16";
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (code.isDark(row, col)) context.fillRect((col + 4) * scale, (row + 4) * scale, scale, scale);
        }
      }
      setReady(true);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url]);
  return <div className="flex flex-col items-center gap-3">
    <canvas ref={canvas} role="img" aria-label={t`Scan to open Mycellios on your phone`}
      hidden={!ready} className="size-60 max-w-full rounded-lg" />
    {!ready && !failed && <p role="status" className="text-sm text-muted-foreground">{t`Preparing code…`}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">{t`Could not show the code. Use the link below.`}</p>}
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline underline-offset-4">{url}</a>
  </div>;
}
