import { z } from "zod";

export const MicoBehaviorKey = z.enum(["localScripts", "agentNewChat", "showPlan"]);
export type MicoBehaviorKey = z.infer<typeof MicoBehaviorKey>;
export const MicoOverrides = z.object({
  localScripts: z.boolean().optional(),
  agentNewChat: z.boolean().optional(),
  showPlan: z.boolean().optional(),
}).strict();
export type MicoOverrides = z.infer<typeof MicoOverrides>;
export const ResponseStyle = z.enum(["natural", "classic"]);
export const LocalMemoryReviewPolicy = z.object({
  enabled: z.boolean(), interval: z.union([z.literal(10), z.literal(20), z.literal(40)]),
  dailyLimitMicrounits: z.number().int().min(0).max(100_000),
}).strict();
export const DEFAULT_MEMORY_REVIEW_POLICY = {enabled:true, interval:20, dailyLimitMicrounits:10_000} as const;
/** Seconds before a plan card starts by itself; null waits for a person. Unset means 10. */
export const PlanAutoStartSeconds = z.union([z.literal(5), z.literal(10), z.literal(30), z.literal(60)]).nullable();
export const DEFAULT_PLAN_AUTO_START_SECONDS = 10;
export const DesktopToolCreditLimit = z.number().int().min(0).max(100_000);
export const MicoDefaults = z.object({
  desktopToolCreditLimitMicros: DesktopToolCreditLimit.optional(),
  localScripts: z.boolean().default(false),
  agentNewChat: z.boolean().default(false),
  showPlan: z.boolean().default(false),
  gitCoauthor: z.boolean().default(true),
  responseStyle: ResponseStyle.optional(),
  memoryReview: LocalMemoryReviewPolicy.optional(),
  planAutoStartSeconds: PlanAutoStartSeconds.optional(),
}).strict();
export type MicoDefaults = z.infer<typeof MicoDefaults>;
export function readMicoDefaults(value: unknown): MicoDefaults {
  return MicoDefaults.parse(MicoDefaults.safeParse(value).success ? value : {});
}
export function readMicoOverrides(value: unknown): MicoOverrides {
  const parsed = MicoOverrides.safeParse(value);
  return parsed.success ? parsed.data : {};
}
export function effectiveMicoSettings(defaults: unknown, overrides: unknown): MicoDefaults {
  return { ...readMicoDefaults(defaults), ...readMicoOverrides(overrides) };
}
export const MicoSettingsState = z.object({
  ownerId: z.string(),
  spaceId: z.string(),
  revision: z.number().int().nonnegative(),
  defaults: MicoDefaults,
  bots: z.array(z.object({ id: z.string(), preferences: MicoOverrides })),
});
export type MicoSettingsState = z.infer<typeof MicoSettingsState>;
export const MicoSettingsUpdate = z.object({ revision: z.number().int().nonnegative() }).and(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("defaults"), patch: MicoOverrides.extend({ desktopToolCreditLimitMicros: DesktopToolCreditLimit.optional(), gitCoauthor: z.boolean().optional(), responseStyle: ResponseStyle.optional(), memoryReview: LocalMemoryReviewPolicy.optional(), planAutoStartSeconds: PlanAutoStartSeconds.optional() }) }),
  z.object({ kind: z.literal("bot"), botId: z.string().min(1), key: MicoBehaviorKey, value: z.boolean().nullable() }),
  z.object({ kind: z.literal("all"), key: MicoBehaviorKey, value: z.boolean().nullable() }),
]));
export type MicoSettingsUpdate = z.infer<typeof MicoSettingsUpdate>;
