/** Native-owned RPC operations; no path or command comes from the page. */
export async function prepareDevelopmentAgent(
  botId: string,
  request: (operation: string, input: unknown) => Promise<unknown>,
) {
  const result = (await request("bots/get", { botId })) as {
    json?: { id?: string; status?: string };
  };
  if (result.json?.id !== botId || typeof result.json.status !== "string")
    throw new Error("The development agent is unavailable.");
  if (
    ["queued", "leased", "running", "waiting_input", "waiting_takeover"].includes(
      result.json.status ?? "",
    )
  )
    throw new Error("Wait for the agent to become idle before opening development.");
  await request("bots/setComputer", { botId, mode: "dedicated" });
}
