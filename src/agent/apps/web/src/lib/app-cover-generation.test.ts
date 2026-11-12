import { expect, it, vi } from "vitest";
import { coverPrompt, submitCoverGeneration } from "./app-cover-generation";
import type { CoverGeneration } from "./app-cover-generation";
it("binds the app information and style without switching the Mico's provider", () => {
  const prompt = coverPrompt({ id: "video-studio", title: "Estudio de vídeos", description: "Vídeos con voz" }, "terciopelo verde");
  expect(prompt).toContain('"id":"video-studio"'); expect(prompt).toContain("terciopelo verde");
  expect(prompt).toContain("No cambies de proveedor"); expect(prompt).toContain("herramientas de imagen autorizadas");
});
it("recovers an uncertain admission with the same thread and nonce", async () => {
  const open = vi.fn().mockResolvedValue({ threadId: "thread" });
  const send = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValue({ runId: "run" });
  const rpc = { development: { open }, threads: { send } } as unknown as Parameters<typeof submitCoverGeneration>[0];
  let saved: CoverGeneration = { botId: "selected-mico", nonce: crypto.randomUUID(), prompt: "draw" };
  const persist = (value: CoverGeneration) => { saved = value; };
  await expect(submitCoverGeneration(rpc, "video-studio", saved, persist)).rejects.toThrow();
  await submitCoverGeneration(rpc, "video-studio", saved, persist);
  expect(open).toHaveBeenCalledOnce(); expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
  expect(send.mock.calls[1]?.[0]).toMatchObject({ botId: "selected-mico", taskThreadId: "thread" });
  await submitCoverGeneration(rpc, "video-studio", saved, persist);
  expect(send).toHaveBeenCalledTimes(2);
});
it("does not start a run if the recoverable request cannot be persisted", async () => {
  const open = vi.fn(), send = vi.fn();
  const rpc = { development: { open }, threads: { send } } as unknown as Parameters<typeof submitCoverGeneration>[0];
  await expect(submitCoverGeneration(rpc, "video-studio", { nonce: crypto.randomUUID(), botId: "mico", prompt: "draw" }, () => { throw new Error("quota"); })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
