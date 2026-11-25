import { DESKTOP_UNREACHABLE_ERROR } from "@mycellios/core";

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
    super(DESKTOP_UNREACHABLE_ERROR, options);
    this.name = "DesktopUnreachableError";
  }
}
