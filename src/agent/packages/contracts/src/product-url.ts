/** Join a product-owned route without discarding the deployment namespace. */
export function productAppUrl(base: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Expected a product route");
  const root = new URL(base);
  if (root.protocol !== "https:" && root.protocol !== "http:")
    throw new Error("Expected a web URL");
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  const target = new URL(`.${path}`, root);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname))
    throw new Error("Product route escaped its deployment namespace");
  return target.href;
}
