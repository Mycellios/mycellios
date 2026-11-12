/** Only embed the deployed app's own static images, never API or other-origin URLs. */
export function companionImageUrl(source: string, documentBase: string, appBase: string, origin: string): URL {
  const page = new URL(documentBase);
  const deployment = new URL(appBase, page);
  const url = new URL(source, page);
  if (!/^https?:$/.test(url.protocol) || page.origin !== origin || url.origin !== origin ||
    deployment.origin !== origin || url.username || url.password ||
    !deployment.pathname.endsWith("/") || !url.pathname.startsWith(deployment.pathname) ||
    !/^(?:assets|@fs|src|packages)\//.test(url.pathname.slice(deployment.pathname.length))) {
    throw new Error("Unsupported companion image");
  }
  return url;
}
