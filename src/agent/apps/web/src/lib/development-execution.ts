import { desktopBridge } from "./desktop";

const startsWork = new Set([
  "threads/send",
  "threads/retry",
  "onboarding/start",
  "onboarding/promptFocus",
]);
const connecting = new Map<string, Promise<void>>();
/** Run admission is code, not a reminder in the model prompt. Stable sessions are unaffected. */
export async function beforeDevelopmentExecution(
  operation: readonly string[],
  input: unknown,
  setDedicated: (botId: string) => Promise<unknown>,
) {
  const bridge = desktopBridge()?.development;
  if (!bridge?.isDevelopment || !startsWork.has(operation.join("/"))) return;
  const value = input as { botId?: unknown; groupId?: unknown };
  if (typeof value?.botId !== "string" || !bridge.connect)
    throw new Error(
      "Open an individual development chat with the current Desktop version before starting work.",
    );
  const botId = value.botId;
  let pending = connecting.get(botId);
  if (!pending) {
    pending = (async () => {
      await setDedicated(botId);
      await bridge.connect!(botId);
    })().finally(() => connecting.delete(botId));
    connecting.set(botId, pending);
  }
  await pending;
}
