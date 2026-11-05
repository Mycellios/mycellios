/** Classify structured provider refusals without exposing prompts, paths or credentials. */
export function nativeAgentProtocolError(value: unknown, fallback = "Native agent rejected the protocol request"): Error {
  const observations: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 4 || observations.length >= 24) return;
    if (typeof item === "string") {
      const text = item.slice(0, 8192);
      observations.push(text);
      if (text.startsWith("{")) {
        try { visit(JSON.parse(text), depth + 1); } catch { /* An ordinary provider message. */ }
      }
    } else if (typeof item === "number") observations.push(String(item));
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const fields = item as Record<string, unknown>;
      for (const key of ["code", "status", "type", "message", "details", "detail", "error", "data", "errors"])
        visit(fields[key], depth + 1);
    } else if (Array.isArray(item)) {
      for (const child of item.slice(0, 4)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  const details = observations.join("\n").toLowerCase();
  const message = /insufficient_quota|free-usage-exhausted|quota.{0,30}(exhaust|exceed)|usage limit|subscription.{0,30}limit/.test(details)
    ? "The native agent account has reached its usage limit. Check its plan or wait for the allowance to reset."
    : /rate.?limit|too many requests|\b429\b/.test(details)
      ? "The native agent provider is rate limiting requests. Wait before retrying."
      : /unauthenticated|authentication|invalid.{0,15}(api.?key|token)|not logged in|sign.?in required|\b401\b/.test(details)
        ? "The native agent needs you to sign in again. Check its account connection."
        : /model_not_found|model.{0,40}(unavailable|not found|not supported)|unknown model/.test(details)
          ? "The configured native agent model is unavailable for this account. Select an available model."
          : /permission.?denied|access.?denied|not authorized|forbidden|\b403\b/.test(details)
            ? "The native agent refused access. Check the account and tool permissions."
            : /context.{0,25}(window|length|limit)|maximum.{0,15}tokens|input.{0,15}too long/.test(details)
              ? "The native agent request exceeds the model context limit."
              : fallback;
  return new Error(message);
}
