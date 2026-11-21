import type { RakazoDesktop } from "@rakazo/contracts";

type Computer = NonNullable<RakazoDesktop["computer"]>;
type Fetch = typeof globalThis.fetch;

/** A Desktop turn must obtain its native execution binding before the API can start it. */
export function nativeComputerFetch(
  send: Fetch,
  computer: Computer,
  origin: string,
  basePath: string,
  admit = nativeComputerAdmission(computer),
): Fetch {
  const prefix = basePath.replace(/\/$/, "");
  return async (input, init) => {
    const request = new Request(input instanceof Request ? input.clone() : input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.origin === origin &&
      url.pathname === `${prefix}/rpc/threads/send` &&
      computer.connect &&
      computer.connected &&
      computer.projectAvailable
    ) {
      // Invalid RPC input remains the API's responsibility. Never consume the original body.
      const payload = await request
        .clone()
        .json()
        .catch(() => null);
      const botId = payload?.json?.botId;
      if (typeof botId === "string" && botId.length > 0 && botId.length <= 256) {
        const native = await admit(botId);
        request.signal.throwIfAborted();
        const taskThreadId = payload?.json?.taskThreadId;
        if (native && typeof taskThreadId === "string" && computer.prepareTask) {
          await computer.prepareTask({ botId, taskThreadId });
          request.signal.throwIfAborted();
        }
      }
    }
    return send(input, init);
  };
}

/** Account/session checks stay in native main; these promises only serialize admission. */
export function nativeComputerAdmission(
  computer: Computer,
  // false: the Mico runs on its own server computer, so the PC is not bound for it.
  prepareWorkspace: (botId: string) => Promise<boolean | void> = async () => undefined,
) {
  const connecting = new Map<string, Promise<boolean>>();
  let admission: Promise<unknown> = Promise.resolve();
  /** Resolves whether the turn uses this PC. */
  return (botId: string): Promise<boolean> => {
    let pending = connecting.get(botId);
    if (!pending) {
      pending = admission.then(async () => {
        if (!(await computer.projectAvailable?.()))
          throw new Error("Local computer access is unavailable. Reconnect Desktop first.");
        if (!(await computer.requestAccess()))
          throw new Error("Local computer access was not allowed. The message was not sent.");
        // Prepare owned instructions before native provisioning. This admission
        // preserves the saved Team/dedicated assignment.
        if ((await prepareWorkspace(botId)) === false) return false;
        await computer.connect!(botId);
        if (!(await computer.connected!(botId)))
          throw new Error("The local computer is disconnected. The message was not sent.");
        return true;
      });
      admission = pending.catch(() => undefined);
      pending = pending.finally(() => connecting.delete(botId));
      connecting.set(botId, pending);
    }
    return pending;
  };
}
