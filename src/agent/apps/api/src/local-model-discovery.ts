const SERVERS = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

/** Fixed loopback destinations only; never scan addresses supplied by a remote caller. */
export async function discoverLocalModels(signal?: AbortSignal, fetcher = fetch) {
  const results = await Promise.all(
    SERVERS.map(async (server) => {
      try {
        const response = await fetcher(`${server.baseUrl}/models`, {
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(1500)])
            : AbortSignal.timeout(1500),
        });
        if (!response.ok || !response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 256_000) return null;
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data))
          return null;
        const modelIds = [
          ...new Set(
            body.data.flatMap((model: unknown) =>
              model &&
              typeof model === "object" &&
              "id" in model &&
              typeof model.id === "string" &&
              model.id.length <= 200
                ? [model.id]
                : [],
            ),
          ),
        ].slice(0, 200);
        return { ...server, modelIds };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((result) => result !== null);
}
