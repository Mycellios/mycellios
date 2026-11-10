import type { Bot } from "@rakazo/contracts";

/** A model connection owns execution; unrelated profile edits keep its selection. */
export function agentEngineForProviderSelection(selection: {
  agentEngine?: Bot["agentEngine"];
  modelProvider?: string | null;
  modelId?: string | null;
}): Bot["agentEngine"] {
  if (selection.agentEngine !== undefined) return selection.agentEngine;
  if (selection.modelProvider !== undefined || selection.modelId !== undefined) return "pi";
  return undefined;
}
