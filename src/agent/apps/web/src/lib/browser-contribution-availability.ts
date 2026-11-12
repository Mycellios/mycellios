/** Uses the worker's own origin/proxy. Never sends Agent cookies or wallet credentials. */
export async function browserContributionAvailability(request: typeof fetch = fetch): Promise<"ready" | "unavailable" | "offline"> {
  try {
    const response = await request("/mobile/v1/contribution-capabilities", { credentials: "omit", cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) { await response.body?.cancel(); return [404, 501].includes(response.status) ? "unavailable" : "offline"; }
    if (!response.body) return "offline";
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > 4096) return "offline"; chunks.push(value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object") return "offline";
    const status = value as Record<string, unknown>;
    return status.schema === "mycellios-browser-contribution/1" && status.accountLinking === true && status.paidInference === true
      ? "ready" : "unavailable";
  } catch { return "offline"; }
}
