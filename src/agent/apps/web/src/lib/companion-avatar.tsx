import { BotAvatar } from "@rakazo/ui-web";
import { companionImageUrl } from "./companion-image-url.js";
const cache = new Map<string, Promise<string | undefined>>();
const assets = new Map<string, Promise<string>>();
/** SVG images loaded from a data URL cannot load sprite sheets over HTTP. */
function embeddedImage(source: string): Promise<string> {
  if (source.startsWith("data:image/")) return Promise.resolve(source);
  const url = companionImageUrl(source, document.baseURI, import.meta.env.BASE_URL, location.origin);
  const existing = assets.get(url.href); if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !/^image\/(png|webp|jpeg)$/.test(type) || !response.body) throw new Error("Unavailable companion image");
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length; if (size > 8_388_608) throw new Error("Companion image too large");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return new Promise<string>((resolve, reject) => {
      const file = new FileReader(); file.onload = () => resolve(String(file.result)); file.onerror = () => reject(file.error);
      file.readAsDataURL(new Blob(chunks, { type }));
    });
  })();
  assets.set(url.href, pending); void pending.catch(() => assets.delete(url.href));
  if (assets.size > 16) assets.delete(assets.keys().next().value!);
  return pending;
}
/** Render the canonical avatar, including its actual shape and eyes, once per choice. */
export function companionAvatar(color: string, identity: string) {
  const key = `${identity}:${color}`;
  if (cache.has(key)) return cache.get(key)!;
  const rendered = (async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(<BotAvatar color={color} identity={identity} size={64} />);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    // Image avatars have a decorative ring before their actual body. Capturing
    // that first SVG produced the empty/white tile in the native island.
    const svg = [...doc.querySelectorAll("svg")].find(node => !node.closest(".rakazo-bot-avatar-ring") && node.querySelector("path,rect,circle,ellipse,image,polygon"));
    if (svg) for (const image of svg.querySelectorAll("image")) {
      const href = image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href) {
        const embedded = await embeddedImage(href);
        image.removeAttributeNS("http://www.w3.org/1999/xlink", "href"); image.setAttribute("href", embedded);
      }
    }
    const source = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : doc.querySelector("img")?.src;
    if (!source?.startsWith("data:image/")) return;
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d"); if (!context) return;
    context.drawImage(image, 0, 0, 64, 64);
    const png = canvas.toDataURL("image/png"); return png.length < 32_000 ? png : undefined;
  })().catch(() => undefined);
  cache.set(key, rendered);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return rendered;
}
