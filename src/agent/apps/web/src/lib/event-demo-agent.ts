const key = "mycellios:event-agent-tab";
export type EventAgentContext = { id: string; spaceId: string; botId: string; endsAt: number };
/** Only a tab selector, never an authentication or balance credential. */
export function eventAgentContext(): EventAgentContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && /^[a-z0-9-]{8,64}$/.test(value.id) && typeof value.spaceId === "string"
      && typeof value.botId === "string" && Number.isSafeInteger(value.endsAt) ? value : null;
  } catch { return null; }
}
export function saveEventAgentContext(value: EventAgentContext) { sessionStorage.setItem(key, JSON.stringify(value)); }
export function withEventAgentHeaders(input?: HeadersInit) {
  const headers = new Headers(input), demo = eventAgentContext();
  if (demo) headers.set("x-mycellios-demo-event", demo.id);
  return headers;
}
export const eventAgentFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, headers: withEventAgentHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
});
export function eventAgentSpace(next?: string | null): string | null {
  const context = eventAgentContext();
  if (!context) return null;
  if (typeof next === "string") saveEventAgentContext({ ...context, spaceId: next });
  return next ?? context.spaceId;
}
