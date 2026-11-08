import { readBoundedJsonResponse } from "@rakazo/core";
import { z } from "zod";

const registryUrl = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const entry = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,128}$/),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
});
const index = z.object({ agents: z.array(z.unknown()).max(256) });

/** Registry metadata is public and never supplies executable commands to the application. */
export function createAcpRegistry(fetcher: typeof fetch = fetch) {
  let cached: { data: z.infer<typeof entry>[]; expiresAt: number } | undefined;
  let loading: Promise<z.infer<typeof entry>[]> | undefined;
  async function load() {
    const signal = AbortSignal.timeout(8000);
    const response = await fetcher(registryUrl, { redirect: "error", credentials: "omit", signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error("ACP registry unavailable");
    }
    const body = index.parse(await readBoundedJsonResponse<unknown>(response, 512 * 1024, signal));
    const agents = new Map<string, z.infer<typeof entry>>();
    for (const candidate of body.agents) {
      const result = entry.safeParse(candidate);
      if (result.success) agents.set(result.data.id, result.data);
    }
    const data = [...agents.values()];
    cached = { data, expiresAt: Date.now() + 5 * 60_000 };
    return data;
  }
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    loading ??= load().finally(() => { loading = undefined; });
    return loading;
  };
}
