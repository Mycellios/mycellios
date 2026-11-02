import { z } from "zod";

export const nativeRequestCancellationSchema = z.object({
  schema: z.literal("mycellios-native-request-cancellation/1"),
  status: z.enum(["cancelling", "cancelled"]),
  request_id: z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),
  model: z.string().min(1).max(256),
  artifact_identity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pipeline_snapshot_identity: z.string().min(1).max(256),
}).strict();
