import { useLingui } from "@lingui/react/macro";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { DocxPreviewError, docxPreviewHtml } from "../lib/docx-preview";
import { LoadingSkeleton } from "./LoadingSkeleton";

const DOCUMENT_CLASS = [
  "mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-foreground break-words sm:px-12 sm:py-12",
  "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-[28px] [&_h1]:leading-tight [&_h1]:font-semibold",
  "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-[22px] [&_h2]:leading-snug [&_h2]:font-semibold",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[18px] [&_h3]:font-semibold",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
  "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:ps-6",
  "[&_li]:my-1 [&_a[href]]:underline [&_a[href]]:underline-offset-2 [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full",
  "[&_table]:my-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td_p]:my-0 [&_th_p]:my-0",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-start",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground",
].join(" ");

/** Word document preview: converted and sanitized in the browser, styled with the app tokens. */
export function DocxViewer({ bytes }: { bytes: Uint8Array }) {
  const { t } = useLingui();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; html: string }
    | { status: "error"; tooLarge: boolean }
  >({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    docxPreviewHtml(bytes, { signal: controller.signal }).then(
      (html) => {
        if (!controller.signal.aborted) setState({ status: "ready", html });
      },
      (error) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          tooLarge: error instanceof DocxPreviewError && error.reason === "too_large",
        });
      },
    );
    return () => controller.abort();
  }, [bytes]);

  if (state.status === "loading") {
    return (
      <LoadingSkeleton
        label={t`Loading preview…`}
        layout="detail"
        className="mx-auto max-w-xl p-6"
      />
    );
  }
  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="m-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
      >
        {state.tooLarge ? t`This file is too large.` : t`Could not load this file.`}
      </p>
    );
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: delegated from the document's links, which keyboards activate with a click.
    <article
      className={DOCUMENT_CLASS}
      onClick={followInDocumentLink}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by sanitizeDocxHtml (allowlisted tags, embedded images only).
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
}

/** Footnote and bookmark links scroll inside the preview instead of changing the app URL. */
function followInDocumentLink(event: MouseEvent<HTMLElement>) {
  const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
  if (!link) return;
  event.preventDefault();
  const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
  event.currentTarget.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
}
