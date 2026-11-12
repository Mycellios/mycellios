const KEY="mycellios.analyticsInstallation";
let fallback: string | undefined;
/** Created only after measurement opt-in. Never contains account data. */
export function analyticsInstallationId(): string {
  try {
    const saved=localStorage.getItem(KEY);
    if(saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))return saved;
    const id=fallback ??= crypto.randomUUID();localStorage.setItem(KEY,id);return id;
  } catch {return fallback ??= crypto.randomUUID();}
}
