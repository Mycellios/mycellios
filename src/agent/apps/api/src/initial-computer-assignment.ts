/** Only an unused placeholder can move while its automatic introduction awaits an answer. */
export function initialComputerAssignmentFilter(computer: {
  scope: string;
  kind: string;
  providerRef: string | null;
  controlHolder: string;
  controlBotId: string | null;
  executionRunId: string | null;
  executionBotId: string | null;
  executionLeaseExpiresAt: Date | null;
}, mode: string) {
  const unused = mode === "dedicated" && computer.scope === "team" && computer.kind === "none" &&
    !computer.providerRef && computer.controlHolder === "none" && !computer.controlBotId &&
    !computer.executionRunId && !computer.executionBotId && !computer.executionLeaseExpiresAt;
  return unused ? { NOT: { status: "waiting_input", trigger: "created" } } : {};
}
