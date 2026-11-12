import { createHash } from "node:crypto";
import type { AgentRunRequest } from "@rakazo/adapter-kit";

/** A saved server checkpoint starts one continuation, never a fresh run replay. */
export function desktopAgentSegmentId(request: Pick<AgentRunRequest, "turnCheckpoint" | "resumeFromCheckpoint">): string | undefined {
  const checkpoint = request.turnCheckpoint ? ["turn", request.turnCheckpoint]
    : request.resumeFromCheckpoint ? ["takeover", request.resumeFromCheckpoint] : undefined;
  return checkpoint ? createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex") : undefined;
}
