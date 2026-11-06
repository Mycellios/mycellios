import { readPrivateFile, writePrivateFile } from "./setup-store.js";
import path from "node:path";

export type UpdateResumeBinding = {
  base: string; userId: string; spaceId: string; connectionId: string;
  deviceId: string; generation: string; botId?: string;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TTL = 2 * 60 * 60_000;
const file = (profile: string) => path.join(profile, "desktop-update-resume.json");

/** Continuity metadata, never a credential or a substitute for fresh account consent. */
export async function saveUpdateResume(profile: string, current: string, target: string, bindings: UpdateResumeBinding[]) {
  if (bindings.length > 256) throw new Error("Too many update bindings");
  await writePrivateFile(file(profile), JSON.stringify({ schema: 1, current, target, expires: Date.now() + TTL, bindings }));
}

export async function restoreUpdateBinding(profile: string, version: string, base: string,
  identity: { userId: string; spaceId: string; connectionId: string }, botId?: string): Promise<UpdateResumeBinding | undefined> {
  try {
    const saved = JSON.parse(await readPrivateFile(file(profile), 256_000) ?? "null");
    if (saved?.schema !== 1 || ![saved.current, saved.target].includes(version) ||
        !Number.isSafeInteger(saved.expires) || saved.expires <= Date.now() || saved.expires > Date.now() + TTL ||
        !Array.isArray(saved.bindings) || saved.bindings.length > 256) return;
    const matches = saved.bindings.filter((b: UpdateResumeBinding) => b && b.base === base &&
      b.userId === identity.userId && b.spaceId === identity.spaceId && b.connectionId === identity.connectionId &&
      b.botId === botId && UUID.test(b.deviceId) && UUID.test(b.generation));
    if (matches.length === 1) return matches[0];
  } catch { /* Missing, expired and invalid continuity never restore access. */ }
}
