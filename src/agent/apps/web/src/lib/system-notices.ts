/**
 * Server-written chat notes arrive as fixed English text (packages/adapters
 * offline-cloud-workspace.ts). Recognise the known ones so the chat can show them in the
 * person's language, including notes already saved in old conversations.
 */
export type SystemNotice =
  | { kind: "offline-cloud" }
  | { kind: "offline-engine"; engine: string };

const OFFLINE_CLOUD = "This PC is offline, so this message runs on the server, without this PC's files.";
const OFFLINE_ENGINE =
  /^This PC is offline, so this message runs on the server with this Mico's saved model instead of (.+), without this PC's files\.$/;

export function parseSystemNotice(text: string): SystemNotice | null {
  if (text === OFFLINE_CLOUD) return { kind: "offline-cloud" };
  const engine = OFFLINE_ENGINE.exec(text)?.[1];
  return engine ? { kind: "offline-engine", engine } : null;
}
