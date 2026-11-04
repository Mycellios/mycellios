/** Router basenames omit the asset base trailing slash so the bare entry also matches. */
export function appBasePath(base = import.meta.env.BASE_URL): string {
  return base.replace(/\/$/, "") || "/";
}

/** Deployment namespace; root installs retain their existing URLs. */
export function appPath(path: string, base = import.meta.env.BASE_URL): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const prefix = base === "/" ? "" : base.replace(/\/$/, "");
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) return path;
  return `${prefix}${path}`;
}

export function appRoute(pathname: string, base = import.meta.env.BASE_URL): string {
  const prefix = base === "/" ? "" : base.replace(/\/$/, "");
  return prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? pathname.slice(prefix.length) || "/"
    : pathname;
}
