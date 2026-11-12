// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const playback = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("motion/mini", () => ({ animate: vi.fn(() => ({ cancel: playback.cancel })) }));
import { startContributionGrowth, stopContributionGrowth } from "./contribution-growth";
afterEach(() => { stopContributionGrowth(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function control() {
 const button=document.createElement("button");document.body.append(button);
 vi.spyOn(button,"getBoundingClientRect").mockReturnValue({left:100,top:window.innerHeight-60,width:40,height:40} as DOMRect);
 return button;
}
it("removes the entire flourish and its deadline immediately when paused",()=>{
 vi.useFakeTimers();startContributionGrowth(control());
 expect(document.querySelectorAll(".rk-contribution-growth")).toHaveLength(1);
 stopContributionGrowth();
 expect(document.querySelectorAll(".rk-contribution-growth")).toHaveLength(0);
 expect(vi.getTimerCount()).toBe(0);
 expect(playback.cancel).toHaveBeenCalledTimes(5);
 vi.runAllTimers();expect(document.querySelector(".rk-contribution-growth")).toBeNull();
});
it("never accumulates effects on repeated activation and clears naturally",()=>{
 vi.useFakeTimers();const button=control();startContributionGrowth(button);startContributionGrowth(button);
 expect(document.querySelectorAll(".rk-contribution-growth")).toHaveLength(1);
 vi.advanceTimersByTime(2100);expect(document.querySelector(".rk-contribution-growth")).toBeNull();
 expect(vi.getTimerCount()).toBe(0);
});
it("honors reduced motion without leaving a timer or overlay",()=>{
 vi.useFakeTimers();vi.stubGlobal("matchMedia",()=>({matches:true}));startContributionGrowth(control());
 expect(document.querySelector(".rk-contribution-growth")).toBeNull();expect(vi.getTimerCount()).toBe(0);
});
