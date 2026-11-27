import { ORPCError } from "@orpc/server";
import { getLogger } from "@mycellios/logging";

export const PC_COPY_FAILED =
  "Could not copy this PC's files before switching computers. Check that Mycellios Desktop is open and connected, then try again.";

/**
 * Leaving This PC first copies the Mico's files from the PC. A PC that cannot hand them over (closed,
 * disconnected or interrupted) is something the person can fix, so say so instead of failing with
 * an internal error. Other computers, and errors that already explain themselves, pass through.
 */
export async function copyBeforeComputerSwitch<T>(kind: string, copy: () => Promise<T>): Promise<T> {
  try {
    return await copy();
  } catch (error) {
    if (kind !== "desktop" || error instanceof ORPCError) throw error;
    // The person sees what to do; the log keeps why, without file contents.
    getLogger().warn("computer switch PC copy failed", error);
    throw new ORPCError("BAD_REQUEST", { message: PC_COPY_FAILED, cause: error });
  }
}
