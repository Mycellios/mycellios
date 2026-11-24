import { t } from "@lingui/core/macro";
import type { MycelliosDesktop } from "@mycellios/contracts";

type Computer = NonNullable<MycelliosDesktop["computer"]>;
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
        if (!(await requestAccess(computer)))
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

/**
 * The bridge rejects (rather than refusing) when native main could not confirm the
 * account with the server in time, for example while the server restarts. Say so
 * plainly: the draft stays, so sending again retries once the server answers.
 */
async function requestAccess(computer: Computer): Promise<boolean> {
  try {
    return await computer.requestAccess();
  } catch (cause) {
    if (!isTransientBridgeFailure(cause)) throw cause;
    throw new Error(t`Mycellios did not respond while checking access to this computer. The message was not sent. Try again in a moment.`, { cause });
  }
}

/** Electron flattens main-process errors into the message text, so only that survives. */
function isTransientBridgeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /TimeoutError|aborted due to timeout|temporarily unavailable|net::ERR_|Failed to fetch/i.test(message);
}
