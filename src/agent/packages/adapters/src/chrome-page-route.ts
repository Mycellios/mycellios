import { ANTSEED_PROVIDER_ID, isMycelliosBaseUrl } from "@mycellios/contracts";

/**
 * Whose model reads the person's Chrome pages (specs/agent-chrome-tabs, owner decision of
 * 2026-11-26): page text from the person's logged-in browser goes only to their own provider
 * or to a Mycellios-managed provider with a contracted upstream. Unidentified sellers (the
 * free AntSeed route, any AntSeed seller) and the contributor network may still list tabs,
 * but never read pages.
 */
export type ChromePageRoute = "own" | "managed" | "third_party";

export function chromePageRoute(input: {
  agentEngine: string;
  provider?: string;
  modelId?: string;
  ownCredential?: boolean;
  baseUrl?: string;
  /** The deployment's own provider, served with the operator's key. */
  deploymentProvider?: string;
}): ChromePageRoute {
  // Codex and Claude run on the person's own sign-in. Other engines hide their upstream.
  if (input.agentEngine !== "pi") return input.agentEngine === "codex" || input.agentEngine === "claude" ? "own" : "third_party";
  if (!input.provider) return "third_party";
  if (input.provider === ANTSEED_PROVIDER_ID) return "third_party";
  if (isMycelliosBaseUrl(input.baseUrl)) {
    const id = input.modelId ?? "";
    if (id === "mycellios/managed/free" || id.startsWith("mycellios/managed/antseed/")) return "third_party";
    return id.startsWith("mycellios/managed/") ? "managed" : "third_party";
  }
  if (input.ownCredential) return "own";
  return input.provider === input.deploymentProvider ? "managed" : "third_party";
}
