import type WebSocket from "ws";

export interface AuthorizedWorkerSession {
  workerId: string;
  identityKind: "device" | "cell";
  identityId: string;
  credentialFingerprint: string;
  generation: number | null;
}

export interface ConnectionState {
  socket: WebSocket;
  workerId: string | null;
  authorizedWorkerId?: string | null;
  authorizedSession?: AuthorizedWorkerSession | null;
  recoveryDenied?: boolean;
  ready: boolean;
  closed?: boolean;
  helloTimer: NodeJS.Timeout;
  pending: boolean;
  messageWindowStartedAt: number;
  messagesInWindow: number;
  sessionId: string;
}


export interface WorkerDisconnectDetails { recoverable: boolean; nodeId?: string; }

export function connectionIsReady(state: ConnectionState | undefined): state is ConnectionState {
  return state?.ready === true && !state.closed && state.socket.readyState === state.socket.OPEN;
}
export function connectedWorkerIdentifiers(connections: ReadonlyMap<string, ConnectionState>): ReadonlySet<string> {
  return new Set([...connections].filter(([, state]) => connectionIsReady(state)).map(([id]) => id));
}
export async function authenticatedConnectionAuthority(connections: ReadonlyMap<string, ConnectionState>, workerId: string,
  check?: (session: AuthorizedWorkerSession) => boolean | Promise<boolean>): Promise<AuthorizedWorkerSession | null> {
  const state = connections.get(workerId), session = state?.authorizedSession;
  try {
    if (!connectionIsReady(state) || !session) return null;
    if (check && !(await check(session))) return null;
    return connections.get(workerId) === state && connectionIsReady(state) && state.authorizedSession === session ? { ...session } : null;
  } catch { return null; }
}
