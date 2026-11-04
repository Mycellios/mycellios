import { expect, it, vi } from "vitest";
import { admitMicoTaskComputer } from "./mico-task-computer.js";
const actor = { userId: "owner", spaceId: "space" } as never;
const target = {
  kind: "bot",
  botId: "mico",
  projectSessionId: "task-thread",
  bot: { computer: { id: "computer", kind: "desktop", providerRef: "native" } },
} as never;
it("refuses missing or mismatched native task bindings before creating model work", async () => {
  for (const environment of [undefined, { projectSessionId: "other-thread" }])
    await expect(
      admitMicoTaskComputer(
        { provisionKind: async () => "desktop", environment: async () => environment } as never,
        actor,
        target,
      ),
    ).rejects.toThrow("isolated worktree");
});
it("never routes task code to a remote computer as a fallback", async () => {
  const environment = vi.fn();
  await expect(
    admitMicoTaskComputer(
      { provisionKind: async () => "docker", environment } as never,
      actor,
      target,
    ),
  ).rejects.toThrow("local PC");
  expect(environment).not.toHaveBeenCalled();
});
it("checks the exact Mico and task thread while keeping ordinary chats unchanged", async () => {
  const environment = vi.fn(async () => ({ projectSessionId: "task-thread" }));
  await admitMicoTaskComputer(
    { provisionKind: async () => "desktop", environment } as never,
    actor,
    target,
  );
  expect(environment.mock.calls[0][1]).toMatchObject({
    botId: "mico",
    projectSessionId: "task-thread",
    userId: "owner",
    spaceId: "space",
  });
  await admitMicoTaskComputer({} as never, actor, {
    ...target,
    projectSessionId: undefined,
  } as never);
});
