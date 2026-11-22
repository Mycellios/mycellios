import type {
  AgentRunRequest,
  AgentSteeringMessage,
  AgentToolResultContent,
} from "@mycellios/adapter-kit";
import { framedSteeringText } from "@mycellios/core";

/** How often a running tool checks whether the person's message waits for this turn. */
export const STEERING_POLL_MS = 2_000;

/**
 * While one tool runs, watch for a message the person sent into this turn. When one waits,
 * the returned signal aborts: a running shell command then moves to the background (it keeps
 * running and its output arrives later) so the turn reaches its next step and takes the message.
 * Other tools finish normally. A failed check only means no early yield.
 */
export function watchSteeringDuringTool(
  request: Pick<AgentRunRequest, "steeringPending">,
  signal?: AbortSignal,
  intervalMs = STEERING_POLL_MS,
): { signal?: AbortSignal; stop: () => void } {
  const check = request.steeringPending;
  if (!check) return { stop: () => undefined };
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped || signal?.aborted) return;
    const waiting = await check().catch(() => false);
    if (stopped) return;
    if (waiting) {
      controller.abort();
      return;
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };
  timer = setTimeout(() => void tick(), intervalMs);
  return {
    signal: controller.signal,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Messages the person sent into a running turn, as content added after a tool result: the
 * engine reads them at its next step, before it continues. Each carries the framing note.
 */
export function steeringToolContent(
  steering: readonly AgentSteeringMessage[],
): AgentToolResultContent[] {
  return steering.flatMap((item) => [
    { type: "text" as const, text: framedSteeringText(item.text) },
    // Tool results carry only PNG and JPEG images; other formats are left out of this step.
    ...(item.images ?? []).flatMap((image) =>
      image.mimeType === "image/png" || image.mimeType === "image/jpeg"
        ? [
            {
              type: "image" as const,
              data: Buffer.from(image.data).toString("base64"),
              mimeType: image.mimeType,
            },
          ]
        : [],
    ),
  ]);
}
