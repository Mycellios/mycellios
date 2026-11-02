import { setTimeout as delay } from "node:timers/promises";
import { AdapterError } from "./base.js";
import { nativeRequestCancellationSchema } from "../contracts/native-request-cancellation.js";

/** A closed HTTP stream does not acknowledge cancellation of native tensor work. */
export async function waitForNativePipelineCancellation(
  baseUrl: URL,
  identity: { model: string; modelDigest: string; activationId: string },
  requestId: string,
  timeoutMs = 40_000,
  pollMs = 100,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    const response = await fetch(new URL(`v1/native-requests/${encodeURIComponent(requestId)}/cancel`, baseUrl), {
      method: "POST",
      signal: AbortSignal.timeout(Math.min(5_000, remaining)), redirect: "manual",
    });
    if (!response.ok) throw unconfirmed();
    const parsed = nativeRequestCancellationSchema.safeParse(await response.json());
    if (!parsed.success) throw unconfirmed();
    const health = parsed.data;
    if (health.request_id !== requestId || health.model !== identity.model
      || health.artifact_identity !== identity.modelDigest
      || health.pipeline_snapshot_identity !== identity.activationId) throw unconfirmed();
    if (health.status === "cancelled") return;
    await delay(Math.min(pollMs, Math.max(1, deadline - performance.now())));
  }
  throw unconfirmed();
}

function unconfirmed(): AdapterError {
  return new AdapterError("Native pipeline cancellation has not drained execution",
    "mycellios_pipeline_cancellation_unconfirmed", false);
}
