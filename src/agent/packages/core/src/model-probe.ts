export type ModelProbeState = {
  models: string[];
  baseUrl: string | null;
  probing: boolean;
};

export const initialModelProbeState: ModelProbeState = {
  models: [],
  baseUrl: null,
  probing: false,
};

/** Keep only the latest probe, including when its connection changes or its screen closes. */
export function createModelProbe(onChange: (state: ModelProbeState) => void) {
  let revision = 0;
  return {
    invalidate() {
      revision += 1;
    },
    reset() {
      revision += 1;
      onChange(initialModelProbeState);
    },
    async probe(options: {
      baseUrl: string;
      apiKey: string;
      request: (input: { baseUrl: string; apiKey?: string }) => Promise<{ models: string[] }>;
      onSuccess: (models: string[]) => void;
      onError: (error: unknown) => void;
    }) {
      const baseUrl = options.baseUrl.trim();
      if (!baseUrl) return;
      const requestRevision = ++revision;
      onChange({ models: [], baseUrl: null, probing: true });
      // Catalog lookup is read-only. Retry one timed-out lookup without
      // requiring another key edit, but never loop or retry a rejected key.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const { models } = await options.request({
            baseUrl,
            apiKey: options.apiKey.trim() || undefined,
          });
          if (requestRevision !== revision) return;
          onChange({ models, baseUrl, probing: false });
          options.onSuccess(models);
          return;
        } catch (error) {
          if (requestRevision !== revision) return;
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          const timeout = message.includes("timed out") || message.includes("timeout");
          if (attempt === 0 && timeout) continue;
          onChange(initialModelProbeState);
          options.onError(error);
          return;
        }
      }
    },
  };
}
