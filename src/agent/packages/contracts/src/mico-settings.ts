import { z } from "zod";

export const MicoBehaviorKey = z.enum(["localScripts", "agentNewChat", "showPlan"]);
export type MicoBehaviorKey = z.infer<typeof MicoBehaviorKey>;
export const MicoOverrides = z.object({
  localScripts: z.boolean().optional(),
  agentNewChat: z.boolean().optional(),
  showPlan: z.boolean().optional(),
}).strict();
export type MicoOverrides = z.infer<typeof MicoOverrides>;
export const MicoDefaults = z.object({
  localScripts: z.boolean().default(false),
  agentNewChat: z.boolean().default(false),
  showPlan: z.boolean().default(false),
  gitCoauthor: z.boolean().default(true),
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
  z.object({ kind: z.literal("defaults"), patch: MicoOverrides.extend({ gitCoauthor: z.boolean().optional() }) }),
  z.object({ kind: z.literal("bot"), botId: z.string().min(1), key: MicoBehaviorKey, value: z.boolean().nullable() }),
  z.object({ kind: z.literal("all"), key: MicoBehaviorKey, value: z.boolean().nullable() }),
]));
export type MicoSettingsUpdate = z.infer<typeof MicoSettingsUpdate>;
