import { productBrand } from "@rakazo/contracts";

/** Service-owned origins; saved credentials must not widen this trust boundary. */
export const MYCELLIOS_API_HOSTS = productBrand.apiHosts;

export function mycelliosApiBaseUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !MYCELLIOS_API_HOSTS.some((host) => host === url.hostname) ||
    !["/v1", "/v1/"].includes(url.pathname)
  )
    return null;
  return url;
}
