import { productBrand } from "@rakazo/contracts";

type HostSessionOptions = {
  hostname: string;
  base: string;
  storage: Pick<Storage, "getItem" | "removeItem">;
  fetch: typeof fetch;
};

/** The hosted module shares the first-party sign-out; standalone installs stay independent. */
export async function signOutMycelliosHost(options?: HostSessionOptions): Promise<void> {
  const hostname = options?.hostname ?? window.location.hostname;
  const base = options?.base ?? import.meta.env.BASE_URL;
  if (base !== "/agent/" || !productBrand.apiHosts.some((host) => host === hostname)) return;
  const request = options?.fetch ?? fetch;
  const key = "mycellios.auth.session";
  let token: unknown;
  try {
    const storage = options?.storage ?? window.localStorage;
    const session = JSON.parse(storage.getItem(key) ?? "null");
    token = session?.accessToken;
    storage.removeItem(key);
  } catch {
    return;
  }
  if (typeof token !== "string" || !token) return;
  try {
    const response = await request("/public/v1/auth-config", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.enabled || typeof config.url !== "string" || typeof config.anonKey !== "string")
      return;
    const endpoint = new URL(config.url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return;
    endpoint.pathname = "/auth/v1/logout";
    endpoint.search = "";
    endpoint.hash = "";
    await request(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
    });
  } catch {
    // Match the native client: local sign-out completes even if the provider is unreachable.
  }
}
