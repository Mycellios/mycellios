import { withNativeProjectInstructions } from "./native-project-instructions";

/** Preserve the account/Space boundary while assigning an individual native workspace. */
export async function prepareNativeWorkspace(
  send: typeof fetch,
  origin: string,
  base: string,
  spaceId: string | null,
  botId: string,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (spaceId) headers.set("x-rakazo-space-id", spaceId);
  async function call(method: string, input: Record<string, string>) {
    const response = await send(`${origin}${base}/rpc/bots/${method}`, {
      method: "POST", headers, credentials: "include", redirect: "error",
      body: JSON.stringify({ json: input }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not prepare this Mico's local workspace. The message was not sent.");
    const value = (await response.json()).json as { id?: unknown; computerMode?: unknown; instructions?: unknown } | undefined;
    if (value?.id !== botId || !["team", "dedicated"].includes(String(value?.computerMode)))
      throw new Error("The workspace response did not match this Mico.");
    return value;
  }
  const bot = await call("get", { botId });
  if (typeof bot?.instructions !== "string") throw new Error("Could not read this Mico's instructions. The message was not sent.");
  const instructions = withNativeProjectInstructions(bot.instructions);
  if (instructions.length > 20_000) throw new Error("This Mico's instructions are too long to add the project workflow without losing content. The message was not sent.");
  if (instructions !== bot.instructions) {
    // The server rejects concurrent instruction changes. Never overwrite or retry a stale snapshot.
    await call("update", { botId, instructions, expectedInstructions: bot.instructions });
  }
  if (bot.computerMode !== "dedicated") {
    const updated = await call("setComputer", { botId, mode: "dedicated" });
    if (updated?.computerMode !== "dedicated") throw new Error("The local workspace was not assigned.");
  }
}
