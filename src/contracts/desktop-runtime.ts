import type { NodeEnrollmentBundle } from "./node-control.js";

/** Native capability used by the same contribution screen in browser and Desktop. */
export interface DesktopRuntimeStatus {
  supported: boolean;
  installed: boolean;
  enrolled: boolean;
  nodeId: string | null;
  version: string | null;
  installing: boolean;
}

export interface DesktopRuntimeBridge {
  status(): Promise<DesktopRuntimeStatus>;
  /** Explicit, privileged read of an existing identity; never enrollment or ownership transfer. */
  identify?(): Promise<DesktopRuntimeStatus>;
  /** A short-lived account grant; never a filesystem path supplied by a page. */
  enroll(bundle: NodeEnrollmentBundle): Promise<DesktopRuntimeStatus>;
}
