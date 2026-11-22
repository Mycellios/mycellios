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

/**
 * A Desktop availability check got no answer: it timed out, lost its connection or found
 * the relay too busy. The PC may still be online, so this is never read as "offline"; the
 * check runs before anything is sent to the PC, so the run can wait and try again.
 */
export class DesktopUnreachableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "Your PC did not answer in time. Check that Mycellios Desktop is open and online, then try again.",
      options,
    );
    this.name = "DesktopUnreachableError";
  }
}
