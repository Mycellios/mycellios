import { eventAgentContext, eventAgentSpace, withEventAgentHeaders } from "./event-demo-agent";
import { getGeneralPreferences } from "./general-preferences";
import { shouldRestoreSavedSpace } from "./startup-space";
import { createORPCClient, RECURSIVE_CLIENT_UNWRAP_KEYS } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract, ProductEvent } from "@rakazo/contracts";
import { CLIENT_BUILD_HEADER, formatClientBuild } from "@rakazo/contracts";
import { displayIdentityEvent, displayIdentityResult } from "@rakazo/core";
import { clientCorrelationHeaders, responseCorrelation } from "@rakazo/logging/monitoring";
import { appPath } from "./app-path";
import { authClient } from "./auth";
import { CLIENT_BUILD } from "./client-build";
import { i18n } from "./i18n";
import { identityLabels } from "./identity-display";
import { reportClientError } from "./monitoring";
import { taskThreadInput, taskThreadResult, type TaskThreadScope } from "./task-thread-scope";

const SPACE_STORAGE_KEY = "rakazo:space-id";
// Read once: changing this preference never changes the active Space.
let restoreSavedSpace = shouldRestoreSavedSpace(getGeneralPreferences().restoreLastWorkspace,
  typeof window === "undefined" ? "" : window.location?.pathname ?? "");

type RpcClientContext = { spaceId?: string | null };

export function selectedSpaceId(): string | null {
  if (eventAgentContext()) return eventAgentSpace();
  const floatingSpace = typeof window === "undefined" ? undefined : window.rakazoDesktop?.chatWindow?.spaceId;
  if (floatingSpace) return floatingSpace;
  if (typeof window === "undefined" || !restoreSavedSpace) return null;
  try {
    return window.localStorage.getItem(SPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function selectSpace(id: string): boolean {
  if (eventAgentContext()) { eventAgentSpace(id); return true; }
  const floatingSpace = typeof window === "undefined" ? undefined : window.rakazoDesktop?.chatWindow?.spaceId;
  if (floatingSpace) return id === floatingSpace;
  restoreSavedSpace = true;
  try {
    window.localStorage.setItem(SPACE_STORAGE_KEY, id);
    return true;
  } catch {
    try {
      // Write failed but the desired selection is already durable — treat as success.
      return window.localStorage.getItem(SPACE_STORAGE_KEY) === id;
    } catch {
      return false;
    }
  }
}

export function clearSpaceSelection(): void {
  if (eventAgentContext()) return;
  if (typeof window !== "undefined" && window.rakazoDesktop?.chatWindow) return;
  try {
    window.localStorage.removeItem(SPACE_STORAGE_KEY);
  } catch {
    // Ignore storage failures on sign-out / reset paths.
  }
}

/** Adds `x-rakazo-space-id` when a space is selected. */
export function withSpaceHeaders(
  init?: HeadersInit,
  spaceId: string | null = selectedSpaceId(),
): Headers {
  const headers = withEventAgentHeaders(init);
  if (spaceId) headers.set("x-rakazo-space-id", spaceId);
  else headers.delete("x-rakazo-space-id");
  return headers;
}

const responseListeners = new Set<(response: Response) => void>();

/** Every API reply, for the build handshake; RPC callers still get their own result. */
export function onRpcResponse(listener: (response: Response) => void): () => void {
  responseListeners.add(listener);
  return () => {
    responseListeners.delete(listener);
  };
}

const link = new RPCLink<RpcClientContext>({
  url: () =>
    typeof window === "undefined"
      ? "http://127.0.0.1:5173/rpc"
      : `${window.location.origin}${appPath("/rpc")}`,
  fetch: async (input, init, options) => {
    const request = new Request(input, init);
    const spaceId =
      options.context.spaceId === undefined ? selectedSpaceId() : options.context.spaceId;
    const correlation = clientCorrelationHeaders();
    const headers = withSpaceHeaders(request.headers, spaceId);
    if (i18n.locale) headers.set("x-mycellios-ui-locale", i18n.locale);
    if (CLIENT_BUILD) headers.set(CLIENT_BUILD_HEADER, formatClientBuild("web", CLIENT_BUILD));
    for (const [key, value] of Object.entries(correlation)) headers.set(key, value);
    let response: Response;
    try {
      response = await fetch(request, {
        headers,
        credentials: "include",
        // Keep cancellation attached directly to fetch rather than only a cloned Request.
        signal: options.signal,
      });
    } catch (error) {
      if (!options.signal?.aborted)
        reportClientError(error, "rpc.transport", responseCorrelation(new Headers(correlation)));
      throw error;
    }
    // Server exceptions are reported by the API; do not report every HTTP failure twice.
    recheckSessionOnUnauthorized(response.status);
    if (response.status === 401 && spaceId && spaceId === selectedSpaceId())
      void leaveUnavailableSpace(spaceId);
    for (const listener of responseListeners) listener(response);
    return response;
  },
});

/**
 * A 401 means the session behind the app's last known user may be gone, but Better Auth only
 * rechecks it on focus or a timer, so a backgrounded window would keep its stale user (and every
 * screen that polls) indefinitely. Recheck now: a signed-out answer routes to sign-in.
 */
export function recheckSessionOnUnauthorized(status: number): void {
  if (status === 401) authClient.$store.notify("$sessionSignal");
}

let leavingSpace: Promise<void> | null = null;

/**
 * The server answers 401 when the selected space is no longer one of the user's, for instance
 * after they are removed from it, and every request would keep failing. Ask without a space which
 * spaces the user has; if the selected one is not among them, reload into their default space.
 */
export function leaveUnavailableSpace(spaceId: string): Promise<void> {
  if (typeof window !== "undefined" && window.rakazoDesktop?.chatWindow) return Promise.resolve();
  leavingSpace ??= (async () => {
    try {
      const { spaces } = await rpc.spaces.list(undefined, { context: { spaceId: null } });
      if (spaces.some((space) => space.id === spaceId) || selectedSpaceId() !== spaceId) return;
      clearSpaceSelection();
      window.location.reload();
    } catch {
      // Signed out or unreachable: leave the selection for the next request to try again.
    } finally {
      leavingSpace = null;
    }
  })();
  return leavingSpace;
}

export type RpcClient = ContractRouterClient<AppContract, RpcClientContext>;

// React's development performance track reads function names from changed props.
// Keep that read on the callable itself rather than treating it as an RPC path.
if (import.meta.env.DEV) RECURSIVE_CLIENT_UNWRAP_KEYS.add("name");

const displayLink = {
  call: async (...args: Parameters<typeof link.call>) => {
    const [path, input, options] = args;
    const result = await link.call(path, input, options);
    if (path.join("/") === "threads/subscribe") {
      return (async function* () {
        for await (const event of result as AsyncIterable<ProductEvent>) {
          yield displayIdentityEvent(event, identityLabels());
        }
      })();
    }
    // Bootstrap can be prefetched before the locale catalog is ready. Its consumer projects it.
    return i18n.locale ? displayIdentityResult(path, result, identityLabels()) : result;
  },
};

export const rpc: RpcClient = createORPCClient(displayLink);

/** Keep late async follow-up requests in the shell's original auth boundary. */
export function createSpaceRpc(spaceId: string | null, taskScope?: TaskThreadScope): typeof rpc {
  const boundTask = taskScope ? { ...taskScope } : undefined;
  let taskAdmitted = false;
  return createORPCClient({
    call: async (path, input, options) => {
      const boundInput = taskThreadInput(path, input, boundTask);
      const privateRequest = Boolean(boundTask && boundInput && typeof boundInput === "object" &&
        "taskThreadId" in boundInput && boundInput.taskThreadId === boundTask.taskThreadId);
      const admissionRead = privateRequest && (path[0] === "bootstrap" ||
        (path[0] === "threads" && ["get", "head", "messages"].includes(path[1] ?? "")));
      if (privateRequest && options.context.spaceId !== undefined && options.context.spaceId !== spaceId)
        throw new Error("This task request belongs to a different Space.");
      if (privateRequest && !admissionRead && !taskAdmitted)
        throw new Error("Load this task conversation before sending changes. Update the server if it does not support tasks.");
      const result = await displayLink.call(path, boundInput, {
        ...options,
        // A call that names its own space (e.g. renaming another space's section) keeps it.
        context: {
          ...options.context,
          spaceId: options.context.spaceId === undefined ? spaceId : options.context.spaceId,
        },
      });
      try {
        const validated = taskThreadResult(path, boundInput, result, boundTask);
        if (admissionRead) taskAdmitted = true;
        return validated;
      } catch (error) {
        if (admissionRead) taskAdmitted = false;
        throw error;
      }
    },
  });
}

const spaceClients = new Map<string, RpcClient>();

/** Reuse a client for settings without changing the selected space. */
export function rpcForSpace(spaceId: string): RpcClient {
  let client = spaceClients.get(spaceId);
  if (!client) {
    client = createSpaceRpc(spaceId);
    spaceClients.set(spaceId, client);
  }
  return client;
}
