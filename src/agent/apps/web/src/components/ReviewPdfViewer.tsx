import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;

/** Render pages ourselves: embedded Chromium does not always provide a native PDF plugin. */
export function ReviewPdfViewer({ bytes, title, onPage }: {
  bytes: Uint8Array;
  title: string;
  onPage: (page: number) => void;
}) {
  const { t } = useLingui();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(320);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, (entries[0]?.contentRect.width ?? 320) - 24)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("pdfjs-dist").then(pdf => {
      if (cancelled) return;
      pdf.GlobalWorkerOptions.workerSrc = workerUrl;
      const task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: true });
      dispose = () => { void task.destroy(); };
      return task.promise.then(value => { if (!cancelled) setDocument(value); });
    }).catch(() => { if (!cancelled) { setError(t`Could not open this PDF. It may be encrypted or damaged.`); setLoading(false); } });
    return () => { cancelled = true; dispose?.(); };
  }, [bytes, t]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    setLoading(true);
    void document.getPage(page).then(value => {
      if (cancelled || !canvas.current) return;
      const viewport = value.getViewport({ scale: width / value.getViewport({scale:1}).width });
      const surface = canvas.current;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.ceil(viewport.width * scale);
      surface.height = Math.ceil(viewport.height * scale);
      surface.style.width = `${viewport.width}px`;
      surface.style.height = "auto";
      const render = value.render({ canvas: surface, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      cancelRender = () => render.cancel();
      return render.promise.then(() => { if (!cancelled) setLoading(false); });
    }).catch(() => { if (!cancelled) { setError(t`Could not render this PDF page.`); setLoading(false); } });
    return () => { cancelled = true; cancelRender?.(); };
  }, [document, page, width, t]);
  return <div ref={host} className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border p-1 text-xs">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage(page-1); onPage(page-1); }}>{t`Previous page`}</Button>
      <span aria-live="polite">{page} / {document?.numPages ?? "—"}</span>
      <Button variant="ghost" size="sm" disabled={!document || page >= document.numPages} onClick={() => { setPage(page+1); onPage(page+1); }}>{t`Next page`}</Button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-auto bg-muted p-3">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <>
        {loading && <div role="status" className="absolute inset-0 grid place-items-center"><Spinner/></div>}
        <canvas ref={canvas} aria-label={title} role="img" className="mx-auto max-w-full bg-card"/>
      </>}
    </div>
  </div>;
}
