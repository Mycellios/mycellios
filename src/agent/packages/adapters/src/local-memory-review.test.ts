import {expect,it,vi} from "vitest";
import { memoryReviewJob } from "@mycellios/adapter-kit";
import {boundedReviewItems,reviewDue,reviewPath,sanitizeReviewText,reviewLocalMemory,scheduleLocalMemoryReview} from "./local-memory-review.js";
it("reviews after the interval or enough new turns and an idle pause",()=>{
 const at=new Date(1000000);expect(reviewDue(20,at,20,1000000)).toBe(true);
 expect(reviewDue(3,at,20,1900000)).toBe(true);expect(reviewDue(2,at,20,9999999)).toBe(false);
 expect(reviewDue(3,at,20,1100000)).toBe(false);
 expect(reviewDue(3,at,20,1100000,true)).toBe(true);
 expect(reviewDue(2,at,20,1100000,true)).toBe(false);
});

it("advances an eligible archived conversation's existing review job", async () => {
  const enqueue = vi.fn();
  const conversation = {
    id: "task", userId: "user", taskBotId: "mico", archivedAt: new Date(),
    historyCompactionGeneration: 1, contextStartSeq: 4, deleteAfter: null as Date | null,
  };
  const count = vi.fn().mockResolvedValue(3);
  const prisma = {
    thread: { findUnique: vi.fn().mockResolvedValue(conversation) },
    user: { findUnique: vi.fn().mockResolvedValue({ micoDefaults: {
      memoryReview: { enabled: true, interval: 20, dailyLimitMicrounits: 10000 },
    } }) },
    localMemoryReview: { findFirst: vi.fn().mockResolvedValue({ lastSeq: 6 }) },
    message: { count },
  };
  const deps = { prisma: prisma as never, jobs: { enqueue } as never };
  await scheduleLocalMemoryReview(deps, "task");
  expect(count).toHaveBeenCalledWith({ where: { threadId: "task", role: "user", seq: { gt: 6 } } });
  expect(enqueue).toHaveBeenCalledWith(memoryReviewJob("task"));

  count.mockResolvedValueOnce(2);
  await scheduleLocalMemoryReview(deps, "task");
  conversation.deleteAfter = new Date();
  await scheduleLocalMemoryReview(deps, "task");
  expect(enqueue).toHaveBeenCalledTimes(1);
});
it("keeps task paths tied to the actual conversation",()=>{
 expect(reviewPath("task","railway","thread-a")).toBe("tasks/thread-a/reviews/railway.md");
 expect(reviewPath("mico","railway","thread-a")).toBe("reviews/railway.md");
});
it("removes known and recognizable credentials before review or persistence",()=>{
 expect(sanitizeReviewText("key sk-abcdefghijklmnopqrst token Bearer qwerty123456 credential123",["credential123"])).not.toContain("abcdefghijkl");
 expect(sanitizeReviewText("Bearer qwerty123456")).not.toContain("qwerty123456");
});
it("does not call a provider for a revoked member",async()=>{
 const resolveModel=vi.fn();const transport=vi.fn();const prisma={thread:{findUnique:vi.fn(async()=>({id:"thread",botId:"bot",spaceId:"space",userId:"user"}))},spaceMember:{findFirst:vi.fn(async()=>null)}};
 await reviewLocalMemory({prisma:prisma as never,memory:{} as never,jobs:{} as never,resolveModel,transport},"thread");expect(resolveModel).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
});
it("a disabled or zero-budget policy cannot start a paid review",async()=>{
 for(const memoryReview of [{enabled:false,interval:20,dailyLimitMicrounits:10000},{enabled:true,interval:20,dailyLimitMicrounits:0}]){
  const transport=vi.fn(),resolveModel=vi.fn();const prisma={thread:{findUnique:vi.fn(async()=>({id:"thread",botId:"bot",spaceId:"space",userId:"user"}))},spaceMember:{findFirst:vi.fn(async()=>({userId:"user"}))},user:{findUnique:vi.fn(async()=>({micoDefaults:{memoryReview}}))}};
  await reviewLocalMemory({prisma:prisma as never,memory:{} as never,jobs:{} as never,resolveModel,transport},"thread");expect(resolveModel).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
 }
});

it("keeps recent context available when a long conversation exceeds the prompt budget",()=>{
 const rows=Array.from({length:100},(_,i)=>({id:i,text:"long conversation ".repeat(90)}));
 const selected=boundedReviewItems(rows,18000,true);
 expect(selected.length).toBeGreaterThan(3);expect(selected.length).toBeLessThan(100);
 expect(selected.at(-1)?.id).toBe(99);expect(JSON.stringify(selected).length).toBeLessThanOrEqual(18000);
});
