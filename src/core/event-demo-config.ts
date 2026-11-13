import { z } from "zod";

export const eventDemoConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{8,64}$/),
  title: z.string().min(1).max(80),
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive(),
  maxGuests: z.number().int().min(1).max(50).default(50),
  grantMicrounits: z.literal(200_000).default(200_000),
  model: z.literal("mycellios/managed/antseed/deepseek-v4-flash"),
  cookieSecret: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  presenterSecret: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  publicOrigin: z.string().url(),
}).strict().superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt || value.endsAt - value.startsAt > 48 * 60 * 60_000)
    ctx.addIssue({ code: "custom", message: "Demo must last at most 48 hours" });
  const url = new URL(value.publicOrigin);
  if (url.origin !== value.publicOrigin || (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    ctx.addIssue({ code: "custom", message: "Demo requires a canonical HTTPS or loopback origin" });
  if (value.cookieSecret === value.presenterSecret)
    ctx.addIssue({ code: "custom", message: "Presenter and guest capabilities must be separate" });
});
export type EventDemoConfig = z.infer<typeof eventDemoConfigSchema>;
export function readEventDemoConfig(env: NodeJS.ProcessEnv): EventDemoConfig | undefined {
  if (env.MYCELLIOS_EVENT_DEMO_ENABLED !== "true") return undefined;
  return eventDemoConfigSchema.parse(JSON.parse(env.MYCELLIOS_EVENT_DEMO_CONFIG_JSON ?? "null"));
}
