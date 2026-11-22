/** Decode only the exact backend Pi namespace shape, never an arbitrary provider ID. */
function piToolExecution(executionId: string): { agent: string; callId: string } | undefined {
  try {
    const value: unknown = JSON.parse(executionId);
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value[0] === "pi-tool" &&
      typeof value[1] === "string" &&
      value[1].length > 0 &&
      typeof value[2] === "string" &&
      value[2].length > 0
    )
      return { agent: value[1], callId: value[2] };
  } catch {
    // Other runtimes keep their existing opaque execution IDs.
  }
  return undefined;
}

export function legacyPiToolCallId(executionId: string): string | undefined {
  return piToolExecution(executionId)?.callId;
}

/** A call a helper made: Pi namespaces helper calls by the run_subagent call that started them. */
export function isSubagentToolExecution(executionId: string): boolean {
  const agent = piToolExecution(executionId)?.agent;
  return agent !== undefined && agent !== "main";
}
