import { expect, it, vi } from "vitest";
import { startDesktopExecutor } from "./executor-startup.js";
it("recovers a transient startup lock without changing consent or replaying a Mico",async()=>{
 const start=vi.fn().mockRejectedValueOnce(Object.assign(Error("private path"),{code:"EBUSY"})).mockResolvedValue({ready:true});
 const report=vi.fn(),delay=vi.fn(async()=>{});
 expect(await startDesktopExecutor(start,{report,delay})).toEqual({ready:true});
 expect(start).toHaveBeenCalledTimes(2);expect(report).toHaveBeenCalledWith("EBUSY");expect(report).not.toHaveBeenCalledWith("private path");
});
it("surfaces a persistent failure and never reports a missing executor as started",async()=>{
 const start=vi.fn().mockRejectedValue(Object.assign(Error("blocked"),{code:"EPERM"}));
 await expect(startDesktopExecutor(start,{report:vi.fn(),delay:async()=>{}})).rejects.toThrow("blocked");expect(start).toHaveBeenCalledTimes(3);
});
