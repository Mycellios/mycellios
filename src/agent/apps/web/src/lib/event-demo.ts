import type { EventDemoMetadata, EventDemoNetwork, EventDemoSession } from "../../../../../contracts/event-demo";
export type { EventDemoMetadata, EventDemoNetwork, EventDemoSession };
export type DemoMessage = { role: "user" | "assistant"; content: string };
export type DemoPending = { key: string; messages: DemoMessage[] };
export type DemoResult = { status: string; response?: { choices?: Array<{ message?: { content?: string } }> } };
const enrolled = new Map<string, string>();
export function eventDemoRoute(path: string) {
  const match = /^\/demo\/([a-z0-9-]{8,64})(\/present)?\/?$/.exec(path);
  return match ? { id: match[1]!, presenter: Boolean(match[2]) } : null;
}
function nonce(id: string) {
  const key = "mycellios:demo:" + id + ":enrollment";
  let value = enrolled.get(id);
  try { value ??= localStorage.getItem(key) ?? undefined; } catch { /* Restricted storage: cookie still preserves this visit. */ }
  if (!value || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    try { localStorage.setItem(key, value); } catch { /* Memory fallback keeps StrictMode idempotent. */ }
  }
  enrolled.set(id, value); return value;
}
export function demoApi(id: string) {
  if (!/^[a-z0-9-]{8,64}$/.test(id)) throw new Error("demo_closed");
  const base = "/mobile/v1/demo/" + id;
  async function read<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(base + path, { credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15_000), ...init,
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
    const value = await response.json();
    if (!response.ok) throw new Error(value?.error?.code ?? "demo_temporarily_unavailable");
    return value as T;
  }
  return {
    metadata: () => read<EventDemoMetadata>(""),
    session: () => read<EventDemoSession>("/session"),
    enter: () => read<EventDemoSession>("/enter", { method: "POST", body: JSON.stringify({ nonce: nonce(id) }) }),
    link: (proof: { workerId: string; token: string }) => read<{ linked: true }>("/contribute", { method: "POST", body: JSON.stringify(proof) }),
    pause: () => read("/pause", { method: "POST", body: "{}" }),
    recover: (key: string) => read<DemoResult>("/chat/" + encodeURIComponent(key)),
    network: (secret: string) => read<EventDemoNetwork>("/network", { headers: { authorization: "DemoView " + secret } }),
    networkQuote: () => read<{ maximumMicrounits: number; modelName: string }>("/network-quote"),
    networkStatus: (key: string) => read<{ status: string } | null>("/network-test/" + encodeURIComponent(key)),
    networkTest: (key: string, maximumMicrounits: number) => read<{ status: string }>("/network-test", {
      method: "POST", body: JSON.stringify({ key, maximumMicrounits }), signal: AbortSignal.timeout(120_000) }),
    async chat(input: DemoPending, onText: (text: string) => void, signal: AbortSignal): Promise<DemoResult> {
      const response = await fetch(base + "/chat", { method: "POST", credentials: "same-origin", cache: "no-store",
        redirect: "error", signal, headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(input) });
      if (!response.ok) { const error = await response.json(); throw new Error(error?.error?.code ?? "demo_request_unconfirmed"); }
      if (!response.body) throw new Error("demo_request_unconfirmed");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", text = "", bytes = 0, result: DemoResult | undefined;
      try {
        while (true) {
          const value = await reader.read(); if (value.done) break;
          bytes += value.value.length; if (bytes > 1_048_576) throw new Error("demo_request_unconfirmed");
          buffer += decoder.decode(value.value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === "delta") {
              const content = event.chunk?.choices?.[0]?.delta?.content;
              if (typeof content === "string") { text += content; onText(text); }
            } else if (event.type === "result") result = event.result;
            else if (event.type === "error") throw new Error(event.code);
          }
        }
      } finally { reader.releaseLock(); }
      if (!result) throw new Error("demo_request_unconfirmed");
      return result;
    },
  };
}
export function demoCache(id: string) {
  const key = "mycellios:demo:" + id + ":chat";
  return {
    load(): { messages: DemoMessage[]; pending: DemoPending | null } {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw || raw.length > 100_000) return { messages: [], pending: null };
        const value = JSON.parse(raw);
        if (!Array.isArray(value.messages) || value.messages.some((m: DemoMessage) =>
          !["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || m.content.length > 16_384)) throw new Error();
        if (value.pending && (typeof value.pending.key !== "string" || !/^[a-f0-9-]{36}$/i.test(value.pending.key)
          || !Array.isArray(value.pending.messages) || !value.pending.messages.length || value.pending.messages.length > 12
          || value.pending.messages.some((m: DemoMessage) => !["user", "assistant"].includes(m?.role)
            || typeof m.content !== "string" || m.content.length > 2000))) throw new Error();
        return { messages: value.messages.slice(-40), pending: value.pending ?? null };
      } catch { return { messages: [], pending: null }; }
    },
    save(messages: DemoMessage[], pending: DemoPending | null) {
      try { sessionStorage.setItem(key, JSON.stringify({ messages: messages.slice(-40), pending })); } catch { /* The live conversation remains usable. */ }
    },
  };
}
