import { z } from "zod";

export const DesktopCompanionPreferencesSchema = z.object({
  island: z.object({ shown: z.boolean(), idle: z.boolean(), additionalDisplays: z.boolean(),
    width: z.number().int().min(75).max(150), height: z.number().int().min(75).max(150) }).strict(),
  dock: z.object({ shown: z.boolean(), edge: z.enum(["left", "right", "bottom"]),
    display: z.union([z.literal("primary"), z.number().int()]), autoHide: z.boolean(),
    edgeStrip: z.boolean(), results: z.boolean(), agents: z.record(z.string().min(1).max(128), z.boolean()).refine(value => Object.keys(value).length <= 256) }).strict(),
}).strict();
export type DesktopCompanionPreferences = z.infer<typeof DesktopCompanionPreferencesSchema>;
export const DEFAULT_DESKTOP_COMPANIONS: DesktopCompanionPreferences = {
  island: { shown: false, idle: true, additionalDisplays: false, width: 100, height: 100 },
  dock: { shown: false, edge: "right", display: "primary", autoHide: false, edgeStrip: true, results: false, agents: {} },
};
export const DesktopCompanionSnapshotSchema = z.object({
  scope: z.string().max(256), theme: z.enum(["light", "dark"]),
  palette: z.object({
    surface: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    foreground: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    hover: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    muted: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
  }).strict().optional(),
  agents: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().max(120),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/), status: z.string().max(120), result: z.string().max(300),
    working: z.boolean(), unread: z.boolean(), avatar: z.string().max(32_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).optional() }).strict()).max(100),
}).strict();
export type DesktopCompanionSnapshot = z.infer<typeof DesktopCompanionSnapshotSchema>;
