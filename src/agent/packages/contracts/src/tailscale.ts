import * as z from "zod";

export const TailnetSuffix = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/);
export const TailnetConnectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["personal", "company"]),
  dnsSuffix: TailnetSuffix,
  allowedBotIds: z.array(z.string().min(1).max(100)).max(100),
});
export const TailnetConnectionSchema = TailnetConnectionInput.extend({
  id: z.string(),
  enabled: z.boolean(),
  status: z.enum(["disconnected", "needs_auth", "needs_approval", "connected", "unavailable", "wrong_tailnet"]),
  authUrl: z.string().url().nullable(),
  deviceName: z.string().nullable(),
});
export type TailnetConnection = z.infer<typeof TailnetConnectionSchema>;

/** Only names resolved inside the selected device's own tailnet are routable. */
export function assertTailnetUrl(value: string, dnsSuffix: string): URL {
  const suffix = TailnetSuffix.parse(dnsSuffix);
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hash || value.endsWith('#') || !host.endsWith(`.${suffix}`) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host.slice(0, -(suffix.length + 1)))) {
    throw new Error("Use a full MCP hostname inside the selected Tailscale network");
  }
  return url;
}

export function safeTailscaleAuthUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'login.tailscale.com' &&
      !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}
