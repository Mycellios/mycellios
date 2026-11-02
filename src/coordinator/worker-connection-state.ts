import type WebSocket from "ws";
import type { StoredWorker } from "../storage/store.js";
import { parseWorkerEnvelope } from "../contracts/worker-protocol.js";

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

const WORKER_HEARTBEAT_GRACE_MS = 10_000;

export function workerConnectionIsHeartbeatStale(
  worker: Pick<StoredWorker, "status" | "lastSeenAt"> | null,
  now = Date.now(),
  lastValidatedHeartbeatAt?: number,
): boolean {
  if (!worker) return true;
  if (lastValidatedHeartbeatAt !== undefined && Number.isFinite(lastValidatedHeartbeatAt)
    && lastValidatedHeartbeatAt <= now && now - lastValidatedHeartbeatAt <= WORKER_HEARTBEAT_GRACE_MS) return false;
  if (worker.status !== "suspect" && worker.status !== "offline") return false;
  return worker.lastSeenAt < now - WORKER_HEARTBEAT_GRACE_MS;
}

export function workerHeartbeatArrival(
  state: ConnectionState,
  raw: string,
  current: ConnectionState | undefined,
  now = Date.now(),
): number | undefined {
  if (!connectionIsReady(state) || !state.workerId || current !== state
    || Buffer.byteLength(raw, "utf8") > 2_200_000 || !raw.includes('"worker.heartbeat"')) return;
  try {
    const envelope = parseWorkerEnvelope(JSON.parse(raw));
    if (envelope?.type === "worker.heartbeat" && envelope.workerId === state.workerId) return now;
  } catch { /* Invalid frames never extend an authenticated worker's liveness. */ }
}
