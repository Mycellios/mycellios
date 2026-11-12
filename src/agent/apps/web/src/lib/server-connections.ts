/** Saved connection metadata only. Authentication remains in each origin's session. */
export type SavedServer = { mode: "existing" | "new"; serverUrl: string; name: string; color?: string };
export type ServerView = "menu" | "rail";
export const SERVER_CONNECTIONS_CHANGED = "mycellios:server-connections";
export const SERVER_VIEW_CHANGED = "mycellios:server-view";
const key = "mycellios.servers.v1";
export function safeServerUrl(value: string): string | null {
  try {
    if (value.length > 2048 || /[%\\\s]/.test(value)) return null;
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash || /[\\\s]/.test(value) || url.pathname.includes("%")) return null;
    return url.href.replace(/\/+$/, "");
  } catch { return null; }
}
export function serverDisplayName(entry: SavedServer): string {
  const url = new URL(entry.serverUrl);
  if (entry.name && entry.name !== url.host) return entry.name;
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "Mycellios local";
  return ["mycellios.com", "www.mycellios.com"].includes(url.hostname) ? "Mycellios" : url.host;
}
export function readBrowserServers(currentUrl: string): SavedServer[] {
  const current = safeServerUrl(currentUrl);
  const entries: SavedServer[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(raw)) for (const item of raw.slice(0, 50)) {
      const url = typeof item?.serverUrl === "string" ? safeServerUrl(item.serverUrl) : null;
      if (!url || entries.some(e => e.serverUrl === url)) continue;
      entries.push({ mode: "existing", serverUrl: url, name: typeof item.name === "string" ? item.name.trim().slice(0, 80) : new URL(url).host,
        ...(typeof item.color === "string" && /^#[0-9a-f]{6}$/i.test(item.color) ? { color: item.color } : {}) });
    }
  } catch { /* Keep the current connection usable after corrupt storage. */ }
  if (current && !entries.some(e => e.serverUrl === current)) entries.unshift({ mode: "existing", serverUrl: current, name: new URL(current).host });
  return entries;
}
export function saveBrowserServer(entry: SavedServer, currentUrl: string): void {
  const url = safeServerUrl(entry.serverUrl);
  if (!url || !entry.name.trim() || entry.name.length > 80 || (entry.color && !/^#[0-9a-f]{6}$/i.test(entry.color))) throw Error("Invalid connection");
  const next = readBrowserServers(currentUrl).filter(e => e.serverUrl !== url);
  if (next.length >= 50) throw Error("Connection limit reached");
  next.push({ mode: "existing", serverUrl: url, name: entry.name.trim(), ...(entry.color ? { color: entry.color } : {}) });
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new Event(SERVER_CONNECTIONS_CHANGED));
}
export function forgetBrowserServer(url: string, currentUrl: string): void {
  const normalized = safeServerUrl(url);
  if (!normalized || normalized === safeServerUrl(currentUrl)) throw Error("Cannot remove the current connection");
  localStorage.setItem(key, JSON.stringify(readBrowserServers(currentUrl).filter(e => e.serverUrl !== normalized)));
  window.dispatchEvent(new Event(SERVER_CONNECTIONS_CHANGED));
}
export function readServerView(): ServerView {
  try { return localStorage.getItem("mycellios.server-view") === "rail" ? "rail" : "menu"; } catch { return "menu"; }
}
export function saveServerView(view: ServerView): void {
  localStorage.setItem("mycellios.server-view", view);
  window.dispatchEvent(new Event(SERVER_VIEW_CHANGED));
}
