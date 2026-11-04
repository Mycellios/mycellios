import { ComputerCommandSchema, type MessageBlock } from "@rakazo/contracts";
export type ToolObservation = NonNullable<
  Extract<MessageBlock, { kind: "steps" }>["tools"]
>[number];
export function observedTools(blocks: readonly MessageBlock[]): ToolObservation[] {
  const tools = new Map<string, ToolObservation>();
  for (const block of blocks)
    if (block.kind === "steps") for (const item of block.tools ?? []) tools.set(item.id, item);
  return [...tools.values()].slice(-16);
}
export function withObservedTools(
  blocks: readonly MessageBlock[],
  tools: ToolObservation[],
): MessageBlock[] {
  if (!tools.length) return [...blocks];
  const next: MessageBlock[] = blocks.map((block) => {
    if (block.kind !== "steps" || !block.tools) return block;
    const { tools: _tools, ...rest } = block;
    return rest;
  });
  const index = next.findLastIndex((block) => block.kind === "steps");
  if (index < 0) next.unshift({ kind: "steps", steps: [], tools: tools.slice(-16) });
  else
    next[index] = {
      ...(next[index] as Extract<MessageBlock, { kind: "steps" }>),
      tools: tools.slice(-16),
    };
  return next;
}
/** Consume redacted audit metadata and the existing redacted computer-command stream. */
export function observeToolEvent(
  blocks: readonly MessageBlock[],
  event: { type: string; payload: Record<string, unknown>; createdAt: string },
): MessageBlock[] {
  const payload = event.payload,
    tools = observedTools(blocks);
  if (event.type === "computer.command") {
    const parsed = ComputerCommandSchema.safeParse(payload);
    if (!parsed.success) return [...blocks];
    const command = parsed.data,
      id = command.executionId.slice(0, 256);
    const index = tools.findIndex((tool) => tool.id === id),
      previous = tools[index];
    if (previous?.commandStatus === "done" && command.status === "running") return [...blocks];
    if (
      previous?.commandStatus === command.status &&
      Date.parse(previous.updatedAt ?? "") > Date.parse(event.createdAt)
    )
      return [...blocks];
    const item: ToolObservation = {
      ...previous,
      id,
      name: previous?.name ?? command.kind,
      outcome:
        command.status === "running"
          ? "running"
          : command.exitCode === null
            ? "succeeded"
            : command.exitCode === 0
              ? "succeeded"
              : "error",
      updatedAt: event.createdAt,
      command: command.command.slice(0, 2000),
      cwd: command.cwd.slice(0, 1000),
      output: command.output.slice(-12000),
      exitCode: command.exitCode,
      commandStatus: command.status,
      ...(command.output.length > 12000 ? { outputTruncated: true } : {}),
      ...(previous?.commandStartedAt
        ? {}
        : command.status === "running"
          ? { commandStartedAt: event.createdAt }
          : {}),
      ...(command.status === "done" ? { commandFinishedAt: event.createdAt } : {}),
    };
    if (index < 0) tools.push(item);
    else tools[index] = item;
  } else if (event.type === "thread.progress") {
    const index = tools.findLastIndex((tool) => tool.outcome === "running");
    if (payload.activity !== true || typeof payload.text !== "string" || index < 0)
      return [...blocks];
    const running = tools[index];
    if (!running) return [...blocks];
    tools[index] = { ...running, detail: payload.text.slice(0, 2000), updatedAt: event.createdAt };
  } else {
    if (
      typeof payload.executionId !== "string" ||
      !payload.executionId ||
      typeof payload.name !== "string"
    )
      return [...blocks];
    const id = payload.executionId.slice(0, 256),
      index = tools.findIndex((tool) => tool.id === id);
    const previous = index < 0 ? undefined : tools[index];
    // Returning a tool result may only yield control while its shell continues.
    const outcome = previous?.commandStatus
      ? previous.outcome
      : event.type === "agent.tool.called"
        ? "running"
        : payload.outcome;
    if (!["running", "succeeded", "error", "paused"].includes(String(outcome))) return [...blocks];
    // A repeated call notification must not turn an already finished tool back into running.
    if (outcome === "running" && previous && previous.outcome !== "running") return [...blocks];
    const item: ToolObservation = {
      ...previous,
      id,
      name: payload.name.slice(0, 200),
      outcome: outcome as ToolObservation["outcome"],
      updatedAt: event.createdAt,
    };
    if (
      typeof payload.durationMs === "number" &&
      Number.isFinite(payload.durationMs) &&
      payload.durationMs >= 0
    )
      item.durationMs = payload.durationMs;
    if (typeof payload.error === "string") item.error = payload.error.slice(0, 500);
    if (index < 0) tools.push(item);
    else tools[index] = item;
  }
  return withObservedTools(blocks, tools);
}
