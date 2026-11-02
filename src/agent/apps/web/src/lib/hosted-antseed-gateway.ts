import { productBrand } from "@rakazo/contracts";

/** A first-party preset, never a credential or an override of a saved connection. */
export function hostedAntseedGateway(
  origin = window.location.origin,
  base = import.meta.env.BASE_URL,
  development = false,
): string {
  try {
    const url = new URL(origin);
    // The owned preview uses the same public HTTPS gateway, never a local secret.
    if (base === "/" && (origin === "http://127.0.0.1:5188" ||
      (development && url.protocol === "http:" && url.origin === origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
      return "https://www.mycellios.com/agent/gateway/v1";
    if (
      base !== "/agent/" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !productBrand.apiHosts.some((host) => host === url.hostname)
    )
      return "";
    return `${url.origin}/agent/gateway/v1`;
  } catch {
    return "";
  }
}
