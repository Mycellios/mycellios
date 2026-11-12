import type { DesktopSetup } from "@rakazo/contracts";
import { normalizeServerUrl, parseSetupInput } from "./setup-config.js";
export type ServerEntry = DesktopSetup & { name: string; color?: string };
export class ServerDirectory {
  private entries: ServerEntry[] = [];
  private pending = Promise.resolve();
  constructor(private io: { read(): Promise<string | null>; write(raw: string): Promise<void> }) {}
  async load() { try { const data = JSON.parse(await this.io.read() ?? "null");
    if (data?.schema !== 1 || !Array.isArray(data.servers)) return;
    for (const item of data.servers.slice(0,50)) { const setup = parseSetupInput(item);
      if (setup && !this.entries.some(e => e.serverUrl === setup.serverUrl)) this.entries.push({ ...setup, name: typeof item.name === "string" ? item.name.trim().slice(0,80) || new URL(setup.serverUrl).host : new URL(setup.serverUrl).host,
        ...(typeof item.color === "string" && /^#[0-9a-f]{6}$/i.test(item.color) ? { color: item.color } : {}) }); }
  } catch { /* A corrupt directory never changes the selected connection. */ } }
  list() { return this.entries.map(entry => ({ ...entry })); }
  remember(setup: DesktopSetup, name?: string) { return this.change(entries => {
    const normalized = parseSetupInput(setup); if (!normalized) throw Error("Invalid server");
    const previous = entries.find(e => e.serverUrl === normalized.serverUrl);
    return [...entries.filter(e => e.serverUrl !== normalized.serverUrl), { ...normalized, name: name?.trim().slice(0,80) || previous?.name || new URL(normalized.serverUrl).host, ...(previous?.color ? {color:previous.color} : {}) }].slice(-50);
  }); }
  updateIdentity(url: string, input: unknown) {
    const normalized = normalizeServerUrl(url);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid connection identity");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => k !== "name" && k !== "color") || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color)) throw Error("Invalid connection identity");
    const name = value.name.trim(), color = value.color;
    return this.change(entries => {
      if (!entries.some(e => e.serverUrl === normalized)) throw Error("Unknown server");
      return entries.map(entry => entry.serverUrl === normalized ? {...entry, name, color} : entry);
    });
  }
  remove(url: string) { const normalized = normalizeServerUrl(url); return this.change(entries => entries.filter(e => e.serverUrl !== normalized)); }
  private change(edit: (entries: ServerEntry[]) => ServerEntry[]) {
    const run = this.pending.then(async () => { const next = edit(this.list()); await this.io.write(JSON.stringify({schema:1,servers:next})); this.entries = next; });
    this.pending = run.catch(() => {}); return run;
  }
}
