import type { ServerDirectory } from "./server-directory.js";
import { normalizeServerUrl } from "./setup-config.js";

/** Only the owned main renderer can read or edit local connection labels. */
export function registerServerDirectoryIpc<E>(ipc: { handle(name: string, handler: (event: E, ...args: unknown[]) => unknown): void }, options: {
  directory: ServerDirectory; fromMain(event: E): boolean; current(): string | null;
}) {
  ipc.handle("desktop.servers.list", event => {
    if (!options.fromMain(event)) throw Error("Servers require the main app window");
    const current = options.current();
    return { servers: options.directory.list(), current: current === null ? null : normalizeServerUrl(current) };
  });
  ipc.handle("desktop.servers.updateIdentity", async (event, url, identity) => {
    if (!options.fromMain(event) || typeof url !== "string") throw Error("Servers require the main app window");
    await options.directory.updateIdentity(url, identity);
  });
}
