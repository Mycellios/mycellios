import { ATTACHMENT_DOCX_MIME_TYPE } from "@mycellios/contracts";

/** Largest .docx the preview reads, matching the review workspace's local file limit. */
export const DOCX_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
/** Uncompressed bytes an archive may declare before it is refused (zip-bomb guard). */
export const DOCX_PREVIEW_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const DOCX_PREVIEW_MAX_HTML_LENGTH = 8 * 1024 * 1024;
const DOCX_PREVIEW_TIMEOUT_MS = 20_000;

export type DocxPreviewFailure = "too_large" | "unreadable";

export class DocxPreviewError extends Error {
  constructor(readonly reason: DocxPreviewFailure) {
    super(reason === "too_large" ? "Document too large to preview" : "Document could not be read");
    this.name = "DocxPreviewError";
  }
}

export function isDocxMimeType(mimeType: string): boolean {
  return mimeType === ATTACHMENT_DOCX_MIME_TYPE;
}

/**
 * Sums the uncompressed sizes the ZIP central directory declares, without inflating anything.
 * Word never writes ZIP64 for ordinary documents, so ZIP64 markers are refused as too large.
 */
export function declaredExpandedSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unreadable = () => new DocxPreviewError("unreadable");
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
  let end = -1;
  for (
    let offset = bytes.byteLength - 22;
    offset >= Math.max(0, bytes.byteLength - 65_557);
    offset--
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw unreadable();
  const entries = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (entries === 0xffff || directoryOffset === 0xffffffff) throw new DocxPreviewError("too_large");
  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw unreadable();
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new DocxPreviewError("too_large");
    total += size;
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return total;
}

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "a",
  "img",
  "blockquote",
  "pre",
  "code",
];
const ALLOWED_ATTR = ["href", "src", "alt", "id", "colspan", "rowspan"];
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const EXTERNAL_LINK = /^(?:https?:|mailto:)/i;

/**
 * Keeps only document structure and inline emphasis. Images must be embedded rasters from the
 * file itself; links keep only in-document anchors and web/mail addresses, which open in a new tab.
 */
export async function sanitizeDocxHtml(html: string): Promise<string> {
  const { default: createPurifier } = await import("dompurify");
  // A private instance, so these hooks never touch other sanitizers in the app.
  const purifier = createPurifier(window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IMG") {
      if (!EMBEDDED_IMAGE.test(node.getAttribute("src") ?? "")) node.remove();
      return;
    }
    if (node.nodeName !== "A") return;
    const href = node.getAttribute("href") ?? "";
    if (href.startsWith("#")) return;
    if (EXTERNAL_LINK.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else node.removeAttribute("href");
  });
  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export type DocxConverter = (bytes: Uint8Array, signal?: AbortSignal) => Promise<string>;

/** Converts in a dedicated worker, which is terminated on cancel, timeout or failure. */
export const convertDocxInWorker: DocxConverter = (bytes, signal) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./docx-preview.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const fail = (reason: DocxPreviewFailure) => {
      finish();
      reject(new DocxPreviewError(reason));
    };
    const cancel = () => {
      finish();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => fail("too_large"), DOCX_PREVIEW_TIMEOUT_MS);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    worker.onmessage = (event: MessageEvent<{ html?: string }>) => {
      if (typeof event.data?.html !== "string") return fail("unreadable");
      finish();
      resolve(event.data.html);
    };
    worker.onerror = () => fail("unreadable");
    const copy = bytes.slice();
    worker.postMessage(copy.buffer, [copy.buffer]);
  });

/**
 * Turns .docx bytes into sanitized HTML for the in-app preview. The document is parsed as data
 * only; nothing in it runs, and nothing outside the file is fetched.
 */
export async function docxPreviewHtml(
  bytes: Uint8Array,
  { signal, convert = convertDocxInWorker }: { signal?: AbortSignal; convert?: DocxConverter } = {},
): Promise<string> {
  if (bytes.byteLength > DOCX_PREVIEW_MAX_BYTES) throw new DocxPreviewError("too_large");
  if (declaredExpandedSize(bytes) > DOCX_PREVIEW_MAX_EXPANDED_BYTES) {
    throw new DocxPreviewError("too_large");
  }
  let html: string;
  try {
    html = await convert(bytes, signal);
  } catch (error) {
    if (error instanceof DocxPreviewError || signal?.aborted) throw error;
    throw new DocxPreviewError("unreadable");
  }
  if (html.length > DOCX_PREVIEW_MAX_HTML_LENGTH) throw new DocxPreviewError("too_large");
  return sanitizeDocxHtml(html);
}
