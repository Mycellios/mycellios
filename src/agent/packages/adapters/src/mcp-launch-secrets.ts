/** Collect explicitly configured launch credentials; ordinary ports and paths
 * remain useful in diagnostics. Never log the returned values. */
export function mcpLaunchSecrets(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  const values = new Set<string>();
  const sensitive = (key: string) =>
    /(?:^|[-_])(token|secret|password|passwd|credential|credentials|authorization|cookie|api[-_]?key|access[-_]?key|auth)(?:$|[-_])/i.test(
      key.replace(/([a-z0-9])([A-Z])/g, "$1-$2"),
    );
  const add = (value: string) => {
    if (!value) return;
    values.add(value);
    const bearer = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value);
    if (bearer) values.add(bearer[1]!);
  };
  const jsonCredentials = (value: unknown): void => {
    const pending = [value];
    while (pending.length) {
      const current = pending.pop();
      if (!current || typeof current !== "object") continue;
      for (const [key, child] of Object.entries(current)) {
        if (sensitive(key) && (typeof child === "string" || typeof child === "number"))
          add(String(child));
        else if (child && typeof child === "object") pending.push(child);
      }
    }
  };
  const strings = args.map(String);
  for (let index = 0; index < strings.length; index++) {
    const arg = strings[index]!;
    const flag = /^--?([^=]+)(?:=([\s\S]*))?$/.exec(arg);
    if (flag) {
      const name = flag[1]!;
      const value =
        flag[2] ?? (strings[index + 1]?.startsWith("-") ? undefined : strings[index + 1]);
      if (value !== undefined && sensitive(name)) add(value);
      if (value !== undefined && /^(?:h|headers?)$/i.test(name)) {
        const header = /^([^:]+):\s*([\s\S]*)$/.exec(value);
        if (header && sensitive(header[1]!.trim())) add(header[2]!);
        try {
          jsonCredentials(JSON.parse(value));
        } catch {
          /* Plain header. */
        }
      }
    }
    const assignment = /^([A-Za-z_][\w-]*)=([\s\S]*)$/.exec(arg);
    if (assignment && sensitive(assignment[1]!)) add(assignment[2]!);
    const candidate = flag?.[2] ?? arg;
    try {
      const url = new URL(candidate);
      if (url.password) {
        add(url.password);
        try {
          add(decodeURIComponent(url.password));
        } catch {
          /* Malformed escape. */
        }
      }
      for (const [key, value] of url.searchParams)
        if (sensitive(key)) {
          add(value);
          add(encodeURIComponent(value));
        }
    } catch {
      /* Not a URL. */
    }
  }
  return [...values];
}
