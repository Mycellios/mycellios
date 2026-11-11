import { expect, it, vi } from "vitest";
import type { Actor } from "@rakazo/contracts";
import type { VoiceDeps } from "./voice.js";
import { transcribeVoice } from "./voice.js";

const actor = { userId: "owner", spaceId: "space" } as Actor;
it("refuses a different account before reading its saved key or making any paid request", async () => {
  const findFirst = vi.fn(), load = vi.fn();
  const deps = { prisma: { bot: { findFirst } }, secrets: { load } } as unknown as VoiceDeps;
  await expect(transcribeVoice(deps, actor, { audio: new Uint8Array([1]), mimeType: "audio/wav", networkAccountId: "other", botId: "mico" })).rejects.toThrow();
  expect(findFirst).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
});
it("requires a Mico owned by the authenticated account and Space", async () => {
  const findFirst = vi.fn(async () => null), load = vi.fn();
  const deps = { prisma: { bot: { findFirst } }, secrets: { load } } as unknown as VoiceDeps;
  await expect(transcribeVoice(deps, actor, { audio: new Uint8Array([1]), mimeType: "audio/wav", networkAccountId: "owner", botId: "foreign" })).rejects.toThrow();
  expect(findFirst).toHaveBeenCalledWith({ where: { id: "foreign", userId: "owner", spaceId: "space", archivedAt: null }, select: { id: true } });
  expect(load).not.toHaveBeenCalled();
});
