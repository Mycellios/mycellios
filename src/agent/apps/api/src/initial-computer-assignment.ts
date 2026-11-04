/** An idle native binding is not ongoing work by the automatic introduction. */
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
  const idle = !computer.controlBotId && !computer.executionRunId &&
    !computer.executionBotId && !computer.executionLeaseExpiresAt;
  const unusedPlaceholder = computer.kind === "none" && !computer.providerRef &&
    computer.controlHolder === "none";
  // Connecting Desktop can provision the shared placeholder before its greeting is
  // answered. A legacy bot holder without a controlBotId is not active control.
  // Moving this bot never destroys the shared computer; the route still rejects
  // real user/running work and separately checks explicit computer control.
  const idleDesktop = computer.kind === "desktop" &&
    ["none", "bot"].includes(computer.controlHolder);
  const initial = mode === "dedicated" && computer.scope === "team" && idle &&
    (unusedPlaceholder || idleDesktop);
  return initial ? { NOT: { status: "waiting_input", trigger: "created" } } : {};
}
