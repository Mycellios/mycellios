import { BotAvatar } from "@rakazo/ui-web";
const cache = new Map<string, Promise<string | undefined>>();
/** Render the canonical avatar, including its actual shape and eyes, once per choice. */
export function companionAvatar(color: string, identity: string) {
  const key = `${identity}:${color}`;
  if (cache.has(key)) return cache.get(key)!;
  const rendered = (async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(<BotAvatar color={color} identity={identity} size={64} />);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const svg = doc.querySelector("svg");
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
