const CHAT_ID = "[a-zA-Z0-9_-]{1,160}";
const CHAT_PATH = new RegExp(`^/app(?:/(?:g/)?${CHAT_ID})?$`);
const ID = new RegExp(`^${CHAT_ID}$`);

export function notificationTarget(value: unknown, origin: string, base: string): string | null {
  if (typeof value !== "string" || value.length > 800) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash ||
      !url.pathname.startsWith(`${base}/app`) || !CHAT_PATH.test(url.pathname.slice(base.length))) return null;
    for (const [key, id] of url.searchParams) {
      if (!["task", "noticeSpace", "m"].includes(key) || !ID.test(id) ||
        url.searchParams.getAll(key).length !== 1) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
