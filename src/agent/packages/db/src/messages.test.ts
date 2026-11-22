import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "./client.js";
import {
  loadRunHistoryMessages,
  createThreadMessage,
  createThreadMessageInTransaction,
  RunHistoryWriteError,
} from "./messages.js";

function transaction() {
  return {
    thread: { update: vi.fn().mockResolvedValue({ nextMessageSeq: 1 }), updateMany: vi.fn().mockResolvedValue({count:1}) },
    run: { findUnique: vi.fn().mockResolvedValue({ status: "running" }) },
    message: { create: vi.fn().mockResolvedValue({ id: "message-1" }) },
  };
}

describe("createThreadMessageInTransaction", () => {
  it("names an untitled Mico conversation from the first line of its first message in the same transaction", async () => {
    const tx=transaction();
    tx.thread.update.mockResolvedValue({nextMessageSeq:1,title:null,taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:one"} as never);
    await createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient,{threadId:"task",role:"user",blocks:[{kind:"text",text:"\n  Preparar   mi presupuesto  \n  con detalle"}]});
    expect(tx.thread.updateMany).toHaveBeenCalledWith({where:{id:"task",title:null},data:{title:"Preparar mi presupuesto",titleSource:"auto"}});
    expect(tx.thread.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.message.create.mock.invocationCallOrder[0]!);
  });

  it.each([
    {title:"Elegido por mí",taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:one",role:"user"},
    {title:null,taskBotId:null,projectKey:null,taskKey:null,role:"user"},
    {title:null,taskBotId:"mico",projectKey:"routine:one",taskKey:"routine:one",role:"user"},
    {title:null,taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:one",role:"bot"},
  ] as const)("preserves named, main, routine and bot-only conversations: %o",async ({role,...thread}) => {
    const tx=transaction(); tx.thread.update.mockResolvedValue({nextMessageSeq:2,...thread} as never);
    await createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient,{threadId:"task",role,blocks:[{kind:"text",text:"Otro mensaje"}]});
    expect(tx.thread.updateMany).not.toHaveBeenCalled();
  });

  it("bounds Unicode titles and names attachment-only conversations without a model",async () => {
    const tx=transaction();
    tx.thread.update.mockResolvedValue({nextMessageSeq:1,title:null,taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:one"} as never);
    await createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient,{threadId:"task",role:"user",blocks:[{kind:"text",text:"🍄".repeat(200)}]});
    const title=tx.thread.updateMany.mock.calls[0]![0].data.title;
    expect(Array.from(title)).toHaveLength(120); expect(title.endsWith("…")).toBe(true);
    await createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient,{threadId:"task",role:"user",blocks:[{kind:"file",name:"Presupuesto.pdf",artifactId:"file",mimeType:"application/pdf",size:12}]});
    expect(tx.thread.updateMany).toHaveBeenLastCalledWith({where:{id:"task",title:null},data:{title:"Presupuesto.pdf",titleSource:"auto"}});
  });
  it("refuses new history in a conversation that is being deleted, before writing the message", async () => {
    const tx=transaction();
    tx.thread.update.mockResolvedValue({nextMessageSeq:3,title:"Plan",taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:one",deleteAfter:new Date()} as never);
    await expect(createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient,{threadId:"task",role:"user",blocks:[{kind:"text",text:"Hola"}]}))
      .rejects.toMatchObject({name:"ThreadLifecycleError",code:"deleting"});
    expect(tx.message.create).not.toHaveBeenCalled();
  });
  it("allows an automated bot message to opt out of unread without changing the default", async () => {
    const silent = transaction();
    await createThreadMessageInTransaction(silent as unknown as Prisma.TransactionClient, {
      threadId: "thread-1",
      role: "bot",
      blocks: [{ kind: "steps", steps: [{ label: "Checked status", count: 1 }] }],
      markUnread: false,
    });
    expect(silent.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unread: undefined }) }),
    );

    const visible = transaction();
    await createThreadMessageInTransaction(visible as unknown as Prisma.TransactionClient, {
      threadId: "thread-1",
      role: "bot",
      blocks: [{ kind: "text", text: "Daily report ready" }],
    });
    expect(visible.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unread: true }) }),
    );
  });

  it("rejects a cancelled run unless the terminal echo opts in", async () => {
    const tx = transaction();
    tx.run.findUnique.mockResolvedValue({ status: "cancelled", startedAt: new Date() });
    const input = {
      threadId: "thread-1",
      role: "bot" as const,
      blocks: [{ kind: "text" as const, text: "Stopped. This stayed queued without starting." }],
      runId: "run-1",
    };
    await expect(
      createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient, input),
    ).rejects.toBeInstanceOf(RunHistoryWriteError);
    await createThreadMessageInTransaction(tx as unknown as Prisma.TransactionClient, {
      ...input,
      allowCancelledRun: true,
    });
    expect(tx.message.create).toHaveBeenCalledOnce();
  });
});

describe("createThreadMessage", () => {
  it("reruns the whole transaction after a mid-write deadlock", async () => {
    const deadlock = Object.assign(new Error("write conflict or a deadlock"), { code: "P2034" });
    const tx = transaction();
    // The sequence already advanced when the insert deadlocks; Postgres rolls both back.
    tx.message.create.mockRejectedValueOnce(deadlock);
    const run = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(
      createThreadMessage({ $transaction: run } as unknown as PrismaClient, {
        threadId: "thread-1",
        role: "bot",
        blocks: [{ kind: "text", text: "Done" }],
      }),
    ).resolves.toEqual({ id: "message-1" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(tx.thread.update).toHaveBeenCalledTimes(2);
    expect(tx.message.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const run = vi.fn().mockRejectedValue(new Error("unique constraint"));

    await expect(
      createThreadMessage({ $transaction: run } as unknown as PrismaClient, {
        threadId: "thread-1",
        role: "user",
        blocks: [{ kind: "text", text: "hi" }],
      }),
    ).rejects.toThrow("unique constraint");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

it("keeps another turn's pending queue out of the model history", async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  await loadRunHistoryMessages({ message: { findMany } } as unknown as PrismaClient, { id: "current", threadId: "owned-thread" }, 20);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    threadId: "owned-thread", NOT: { steeringMessages: { some: { originTrigger: "queued_user", claimedAt: null, OR: [{ runId: null }, { runId: { not: "current" } }] } } },
  }) }));
});

it("limits model history to messages after the new-chat boundary while leaving display paging alone", async () => {
 const findMany = vi.fn().mockResolvedValue([]);
 await loadRunHistoryMessages({ message: { findMany } } as unknown as PrismaClient, { id: "run", threadId: "thread" }, 20, undefined, 42);
 expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ threadId: "thread", seq: { gte: 42 } }) }));
});
