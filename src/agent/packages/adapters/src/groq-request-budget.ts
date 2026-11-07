const GROQ_GPT_OSS_BASELINE_TPM = 8_000;

function requestWindow(limit: number): number {
  // Allow for differences between local estimates and Groq's tokenizer.
  return Math.floor(limit * 0.85);
}

/** Direct Groq keys have no known tier at admission; use the published free-tier floor. */
export function groqInitialRequestWindow(provider: string, modelId: string): number | undefined {
  if (provider === "groq" && (modelId === "openai/gpt-oss-20b" || modelId === "openai/gpt-oss-120b"))
    return requestWindow(GROQ_GPT_OSS_BASELINE_TPM);
}

/** An oversized-request rejection can reveal a lower per-request ceiling for this run. */
export function groqRequestContextWindow(
  provider: string,
  errorMessage: string | undefined,
  currentWindow: number,
): number | undefined {
  if (
    provider !== "groq" ||
    !errorMessage ||
    errorMessage.length > 16_384 ||
    !/^413\b/.test(errorMessage)
  )
    return;
  try {
    const start = errorMessage.indexOf("{");
    let message = errorMessage;
    if (start >= 0) {
      const parsed = JSON.parse(errorMessage.slice(start)) as {
        code?: string;
        type?: string;
        message?: string;
        error?: { code?: string; type?: string; message?: string };
      };
      const error = parsed.error ?? parsed;
      if (error.code !== "rate_limit_exceeded" || error.type !== "tokens" || typeof error.message !== "string")
        return;
      message = error.message;
    } else if (!/^413\s*:?\s*Request too large\b/i.test(message)) {
      return;
    }
    const match = message.match(
      /on tokens per minute \(TPM\): Limit (\d+), Requested (\d+)(?=[,.\s]|$)/,
    );
    if (!match) return;
    const limit = Number(match[1]);
    const requested = Number(match[2]);
    if (
      !Number.isSafeInteger(limit) ||
      !Number.isSafeInteger(requested) ||
      requested <= limit ||
      limit < 1
    )
      return;
    const window = requestWindow(limit);
    return window > 0 && window < currentWindow ? window : undefined;
  } catch {
    return;
  }
}
