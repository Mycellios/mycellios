export class ComputerBusyError extends Error {
  constructor() {
    super("Computer is busy");
    this.name = "ComputerBusyError";
  }
}

/** Only the authenticated native transport may signal a planned interruption. */
export class ComputerUpdatingError extends ComputerBusyError {
  constructor(readonly dispatched = true) {
    super();
    this.name = "ComputerUpdatingError";
    this.message = "The PC is updating; pending work will resume after reconnecting.";
  }
}
